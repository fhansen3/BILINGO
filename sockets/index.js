'use strict';

const { verify } = require('../utils/jwt');
const db = require('../config/db');
const roomsService = require('../services/rooms.service');
const { translate } = require('../utils/translate');
const { processSegment } = require('../services/translationPipeline');

function parseCookies(cookieHeader) {
  const out = {};
  if (!cookieHeader) return out;
  cookieHeader.split(';').forEach(p => {
    const idx = p.indexOf('=');
    if (idx === -1) return;
    out[p.slice(0, idx).trim()] = decodeURIComponent(p.slice(idx + 1).trim());
  });
  return out;
}

function attachSockets(io) {
  io.use(async (socket, next) => {
    try {
      const cookies = parseCookies(socket.handshake.headers.cookie || '');
      const token = cookies.token || socket.handshake.auth?.token;
      if (!token) return next(new Error('No token'));
      const payload = verify(token);
      if (!payload) return next(new Error('Invalid token'));
      const users = await db.query('SELECT id, display_name, avatar_color, role FROM users WHERE id = ?', [payload.id]);
      if (!users.length) return next(new Error('User not found'));
      socket.user = users[0];
      // Per-socket language prefs (set/updated by the client)
      socket.data.sourceLang = 'en';
      socket.data.targetLang = 'en';
      next();
    } catch (err) {
      next(err);
    }
  });

  io.on('connection', async (socket) => {
    const user = socket.user;
    await db.query('UPDATE users SET is_online = 1, last_seen = NOW() WHERE id = ?', [user.id]);
    io.emit('presence:update', { userId: user.id, online: true });

    // ---------------------------------------------------------------------
    // WAITING ROOM FLOW
    //
    //  Guest opens /m/:code/waiting → client emits 'waiting' with the
    //  participantId stashed in their session. Server:
    //    1. validates the participant row exists, belongs to this meeting,
    //       and is in status='waiting',
    //    2. joins this socket to two rooms:
    //         - 'waiting:<roomId>'  (so we can broadcast to all waiters)
    //         - 'wait:<participantId>'  (so admit/deny can target THIS user)
    //    3. notifies the host(s) watching this meeting via
    //       io.to('host:<roomId>').emit('waiting:join', { participant }).
    //
    //  Host opens /m/:code/host → client emits 'host:watch' with the room
    //  code. Server verifies the user is the host (or admin) and joins them
    //  to 'host:<roomId>'. Server then emits 'waiting:list' back to the
    //  host's socket with the current pending list.
    //
    //  When the HTTP admit/deny endpoint fires (routes/meetings.js), it
    //  emits 'host:admit' / 'host:deny' to 'wait:<participantId>' so only
    //  THAT waiting participant is notified, and also broadcasts
    //  'waiting:leave' to 'host:<roomId>' so the host UI updates.
    // ---------------------------------------------------------------------
    socket.on('waiting', async ({ roomCode, participantId }) => {
      try {
        if (!roomCode || !participantId) {
          return socket.emit('waiting:error', { message: 'roomCode and participantId required' });
        }
        const room = await roomsService.getRoomByCode(String(roomCode).trim().toLowerCase());
        if (!room) return socket.emit('waiting:error', { message: 'Room not found' });

        const rows = await db.query(
          `SELECT id, room_id, user_id, display_name, native_language, target_language, status
             FROM meeting_participants
            WHERE id = ? AND room_id = ?`,
          [Number(participantId), room.id]
        );
        if (!rows.length) return socket.emit('waiting:error', { message: 'Participant not found' });
        const p = rows[0];
        // Guard: the socket-authenticated user must own this participant row
        // (waiting flow is for the user themselves — not someone else).
        if (p.user_id && p.user_id !== user.id) {
          return socket.emit('waiting:error', { message: 'Forbidden' });
        }
        if (p.status === 'admitted') {
          return socket.emit('host:admit', { participantId: p.id, roomCode });
        }
        if (p.status === 'denied' || p.status === 'left') {
          return socket.emit('host:deny', { participantId: p.id, roomCode });
        }

        socket.join(`waiting:${room.id}`);
        socket.join(`wait:${p.id}`);
        socket.data.waitingRoomId = room.id;
        socket.data.waitingParticipantId = p.id;

        // Confirm to the waiting client.
        socket.emit('waiting:ack', { participantId: p.id, roomCode: room.room_code });

        // Notify host watchers.
        io.to(`host:${room.id}`).emit('waiting:join', {
          participant: {
            id: p.id,
            display_name: p.display_name,
            native_language: p.native_language,
            target_language: p.target_language
          }
        });
      } catch (err) {
        socket.emit('waiting:error', { message: err.message });
      }
    });

    socket.on('host:watch', async ({ roomCode }) => {
      try {
        if (!roomCode) return socket.emit('host:error', { message: 'roomCode required' });
        const room = await roomsService.getRoomByCode(String(roomCode).trim().toLowerCase());
        if (!room) return socket.emit('host:error', { message: 'Room not found' });

        // rule_host_only_actions: only the host (or an admin) may watch.
        const isHost = room.host_id === user.id;
        const isAdmin = user.role === 'admin';
        if (!isHost && !isAdmin) {
          return socket.emit('host:error', { message: 'Forbidden' });
        }

        socket.join(`host:${room.id}`);
        socket.data.hostRoomId = room.id;

        // Send current pending list as the initial snapshot.
        const pending = await db.query(
          `SELECT id, user_id, display_name, native_language, target_language, joined_at
             FROM meeting_participants
            WHERE room_id = ? AND status = 'waiting'
            ORDER BY id ASC`,
          [room.id]
        );
        socket.emit('waiting:list', { pending });
      } catch (err) {
        socket.emit('host:error', { message: err.message });
      }
    });

    socket.on('room:join', async ({ roomCode, sourceLang, targetLang }) => {
      try {
        const room = await roomsService.getRoomByCode(roomCode);
        if (!room) return socket.emit('room:error', { message: 'Room not found' });

        socket.join(`room:${room.id}`);
        socket.data.roomId = room.id;
        socket.data.roomCode = roomCode;
        if (sourceLang) socket.data.sourceLang = sourceLang;
        if (targetLang) socket.data.targetLang = targetLang;

        // Notify others in the room
        socket.to(`room:${room.id}`).emit('peer:joined', {
          userId: user.id,
          displayName: user.display_name,
          avatarColor: user.avatar_color,
          socketId: socket.id,
          sourceLang: socket.data.sourceLang,
          targetLang: socket.data.targetLang
        });

        // Send list of existing peers to the new joiner
        const sockets = await io.in(`room:${room.id}`).fetchSockets();
        const peers = sockets
          .filter(s => s.id !== socket.id)
          .map(s => ({
            userId: s.user.id,
            displayName: s.user.display_name,
            avatarColor: s.user.avatar_color,
            socketId: s.id,
            sourceLang: s.data.sourceLang,
            targetLang: s.data.targetLang
          }));
        socket.emit('room:joined', { room, peers });
      } catch (err) {
        socket.emit('room:error', { message: err.message });
      }
    });

    // Client updated its language preferences
    socket.on('lang:update', ({ sourceLang, targetLang }) => {
      if (sourceLang) socket.data.sourceLang = sourceLang;
      if (targetLang) socket.data.targetLang = targetLang;
      if (socket.data.roomId) {
        socket.to(`room:${socket.data.roomId}`).emit('peer:lang', {
          socketId: socket.id,
          userId: user.id,
          sourceLang: socket.data.sourceLang,
          targetLang: socket.data.targetLang
        });
      }
    });

    // WebRTC signaling — forward to specific peer
    socket.on('webrtc:offer', ({ to, sdp }) => {
      io.to(to).emit('webrtc:offer', { from: socket.id, sdp, user: { id: user.id, displayName: user.display_name, avatarColor: user.avatar_color } });
    });
    socket.on('webrtc:answer', ({ to, sdp }) => {
      io.to(to).emit('webrtc:answer', { from: socket.id, sdp });
    });
    socket.on('webrtc:ice', ({ to, candidate }) => {
      io.to(to).emit('webrtc:ice', { from: socket.id, candidate });
    });

    // Chat with per-recipient translation
    socket.on('chat:send', async ({ content, sourceLang, targetLang }) => {
      if (!socket.data.roomId || !content) return;
      const trimmed = String(content).slice(0, 2000);
      const senderSource = sourceLang || socket.data.sourceLang || 'en';
      const senderTargetFallback = targetLang || socket.data.targetLang || senderSource;

      try {
        // Collect every recipient's preferred target language (the language THEY want to read in)
        const sockets = await io.in(`room:${socket.data.roomId}`).fetchSockets();
        const targetLangs = new Set();
        targetLangs.add(senderSource); // sender sees their original
        sockets.forEach(s => {
          if (s.id === socket.id) return;
          // Peer wants to READ in their own sourceLang (the lang THEY speak)
          if (s.data.sourceLang) targetLangs.add(s.data.sourceLang);
        });

        // Translate once per unique target language
        const translations = {};
        translations[senderSource] = trimmed;
        for (const lang of targetLangs) {
          if (lang === senderSource) continue;
          const out = await translate(trimmed, senderSource, lang);
          translations[lang] = out || trimmed;
        }

        // Persist the message (store the sender's source language and a default translation
        // toward the fallback target — used for chat history rendering)
        const persistedTarget = senderTargetFallback !== senderSource ? senderTargetFallback : null;
        const persistedTranslation = persistedTarget ? (translations[persistedTarget] || null) : null;
        const msg = await roomsService.addMessage(
          socket.data.roomId,
          user.id,
          trimmed,
          { sourceLang: senderSource, targetLang: persistedTarget, translatedContent: persistedTranslation }
        );

        // Emit to each socket in the room with the right translation for THEM
        for (const s of sockets) {
          const isSender = s.id === socket.id;
          const recipientLang = isSender ? senderSource : (s.data.sourceLang || senderSource);
          const translated = translations[recipientLang] || trimmed;
          s.emit('chat:message', {
            ...msg,
            source_lang: senderSource,
            target_lang: isSender ? null : recipientLang,
            translated_content: isSender ? null : (recipientLang !== senderSource ? translated : null)
          });
        }
      } catch (err) {
        socket.emit('chat:error', { message: err.message });
      }
    });

    // Speak: a participant produced a spoken segment (audio blob OR pre-transcribed text).
    // Runs the translation pipeline stub and broadcasts the per-listener result.
    socket.on('speak', async (payload, ack) => {
      try {
        if (!socket.data.roomId) {
          if (typeof ack === 'function') ack({ ok: false, error: 'Not in a room' });
          return;
        }
        const meetingId = socket.data.roomId;
        const sourceLanguage = (payload && payload.sourceLanguage) || socket.data.sourceLang || 'en';
        const originalText = payload && payload.originalText;
        const audioBlob = payload && payload.audioBlob; // optional, opaque

        // Look up speaker participant id (best-effort).
        let speakerParticipantId = null;
        try {
          const sp = await db.query(
            `SELECT id FROM meeting_participants
             WHERE room_id = ? AND user_id = ? AND status = 'admitted'
             ORDER BY id DESC LIMIT 1`,
            [meetingId, user.id]
          );
          if (sp.length) speakerParticipantId = sp[0].id;
        } catch (_) { /* ignore */ }

        // Collect listeners (every OTHER socket in the room) with their preferred target language.
        const roomSockets = await io.in(`room:${meetingId}`).fetchSockets();
        const listeners = [];
        const seenParticipants = new Set();
        for (const s of roomSockets) {
          if (s.id === socket.id) continue;
          const listenerLang = s.data.sourceLang || s.data.targetLang || 'en';
          let participantId = null;
          try {
            const lp = await db.query(
              `SELECT id FROM meeting_participants
               WHERE room_id = ? AND user_id = ? AND status = 'admitted'
               ORDER BY id DESC LIMIT 1`,
              [meetingId, s.user.id]
            );
            if (lp.length) participantId = lp[0].id;
          } catch (_) { /* ignore */ }

          // Dedupe: same user on multiple sockets only logged once.
          const dedupeKey = participantId || `u:${s.user.id}`;
          if (seenParticipants.has(dedupeKey)) continue;
          seenParticipants.add(dedupeKey);

          listeners.push({
            socketId: s.id,
            userId: s.user.id,
            participantId,
            targetLanguage: listenerLang
          });
        }

        const result = await processSegment({
          meetingId,
          speakerParticipantId,
          speakerUserId: user.id,
          audioBlob,
          originalText,
          sourceLanguage,
          targetLanguages: listeners.map(l => ({
            participantId: l.participantId,
            userId: l.userId,
            targetLanguage: l.targetLanguage
          }))
        });

        // Build the canonical "caption" payload (the design's caption event).
        // Listeners use this to render the per-tile bilingual caption overlay.
        const baseCaption = {
          segmentId: result.segmentId,
          speakerSocketId: socket.id,
          speakerUserId: user.id,
          originalLanguage: result.sourceLanguage,
          originalText: result.originalText,
          translations: result.translations,
          startMs: result.startMs,
          endMs: result.endMs,
          confidence: result.confidence,
          audioDurationMs: result.audioDurationMs
        };

        // Broadcast to each listener with THEIR translation.
        for (const l of listeners) {
          const delivery = result.deliveries.find(d =>
            (d.participantId && d.participantId === l.participantId) ||
            (!d.participantId && d.userId === l.userId && d.targetLanguage === l.targetLanguage)
          );
          if (!delivery) continue;

          io.to(l.socketId).emit('speak:translated', {
            segmentId: result.segmentId,
            speakerSocketId: socket.id,
            speakerUserId: user.id,
            sourceLanguage: result.sourceLanguage,
            originalText: result.originalText,
            targetLanguage: delivery.targetLanguage,
            translatedText: delivery.translatedText,
            audioUrl: delivery.audioUrl,
            latency: {
              audioInMs: delivery.audioInLatencyMs,
              translationMs: delivery.translationLatencyMs,
              ttsMs: delivery.ttsLatencyMs,
              totalMs: delivery.totalLatencyMs
            },
            isDegraded: delivery.isDegraded
          });

          // The design's authoritative 'caption' event for the listener tile.
          io.to(l.socketId).emit('caption', Object.assign({}, baseCaption, {
            targetLanguage: delivery.targetLanguage,
            translatedText: delivery.translatedText,
            audioUrl: delivery.audioUrl,
            latencyMs: delivery.totalLatencyMs,
            isDegraded: delivery.isDegraded
          }));
        }

        // Echo back to the speaker (their own captions).
        socket.emit('speak:transcribed', {
          segmentId: result.segmentId,
          sourceLanguage: result.sourceLanguage,
          originalText: result.originalText,
          listenerCount: listeners.length
        });

        // Also emit a 'caption' to the speaker (own tile shows their own original).
        socket.emit('caption', Object.assign({}, baseCaption, {
          targetLanguage: result.sourceLanguage,
          translatedText: result.originalText,
          audioUrl: null,
          latencyMs: 0,
          isDegraded: false,
          isSelf: true
        }));

        // And broadcast the segment (without per-listener translation) to the
        // whole room so anyone listening can react to a new utterance.
        io.to(`room:${meetingId}`).emit('caption:segment', baseCaption);

        if (typeof ack === 'function') {
          ack({
            ok: true,
            segmentId: result.segmentId,
            listenerCount: listeners.length,
            translations: result.translations
          });
        }
      } catch (err) {
        console.error('[speak]', err);
        if (typeof ack === 'function') ack({ ok: false, error: err.message });
        socket.emit('speak:error', { message: err.message });
      }
    });

    // Media state (mute/camera)
    socket.on('media:state', (state) => {
      if (!socket.data.roomId) return;
      socket.to(`room:${socket.data.roomId}`).emit('media:state', {
        socketId: socket.id,
        userId: user.id,
        ...state
      });
    });

    socket.on('room:leave', () => {
      if (socket.data.roomId) {
        socket.to(`room:${socket.data.roomId}`).emit('peer:left', { socketId: socket.id, userId: user.id });
        socket.leave(`room:${socket.data.roomId}`);
        socket.data.roomId = null;
      }
    });

    socket.on('disconnect', async () => {
      if (socket.data.roomId) {
        socket.to(`room:${socket.data.roomId}`).emit('peer:left', { socketId: socket.id, userId: user.id });
      }
      const sockets = await io.fetchSockets();
      const stillOnline = sockets.some(s => s.user && s.user.id === user.id);
      if (!stillOnline) {
        await db.query('UPDATE users SET is_online = 0, last_seen = NOW() WHERE id = ?', [user.id]);
        io.emit('presence:update', { userId: user.id, online: false });
      }
    });
  });
}

module.exports = { attachSockets };
