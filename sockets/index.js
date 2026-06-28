'use strict';

const { verify } = require('../utils/jwt');
const db = require('../config/db');
const roomsService = require('../services/rooms.service');
const { translateText } = require('../services/openaiTranslate');

const MAX_PARTICIPANTS_PER_ROOM = Math.max(
  2,
  Math.min(50, parseInt(process.env.MAX_PARTICIPANTS_PER_ROOM || '10', 10) || 10)
);

function normalizeLang(code) {
  if (!code) return code;
  return String(code).toLowerCase().split('-')[0];
}

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

    // Personal channel — used for direct user notifications (e.g. room
    // invitations from other users). Anything emitted to 'user:<id>' reaches
    // every active socket the user has open.
    socket.join(`user:${user.id}`);

    // Push any pending room invitations to this socket on connect, so users
    // who reconnect or open a second tab don't miss in-flight invites.
    try {
      const invitationsService = require('../services/invitations.service');
      const pending = await invitationsService.listPendingForUser(user.id);
      if (pending && pending.length) {
        socket.emit('invite:pending', pending.map(inv => ({
          invitationId: inv.id,
          roomCode: inv.room_code,
          topic: inv.topic,
          message: inv.message,
          inviter: {
            id: inv.inviter_id,
            name: inv.inviter_name,
            avatarColor: inv.inviter_color
          },
          expiresAt: inv.expires_at,
          createdAt: inv.created_at
        })));
      }
    } catch (e) {
      console.error('[invite:pending]', e.message);
    }

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

        // Enforce max participants (default 10). Counts unique users currently
        // in the room. The same user on multiple sockets only counts once.
        const existing = await io.in(`room:${room.id}`).fetchSockets();
        const uniqueUsers = new Set(existing.map(s => s.user && s.user.id).filter(Boolean));
        const alreadyIn = uniqueUsers.has(user.id);
        if (!alreadyIn && uniqueUsers.size >= MAX_PARTICIPANTS_PER_ROOM) {
          return socket.emit('room:error', {
            code: 'room_full',
            message: `This room is full (max ${MAX_PARTICIPANTS_PER_ROOM} participants).`
          });
        }

        socket.join(`room:${room.id}`);
        socket.data.roomId = room.id;
        socket.data.roomCode = roomCode;
        // Normalize so 'en-US' and 'en' are treated as the same listener bucket.
        if (sourceLang) socket.data.sourceLang = normalizeLang(sourceLang);
        if (targetLang) socket.data.targetLang = normalizeLang(targetLang);

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
      if (sourceLang) socket.data.sourceLang = normalizeLang(sourceLang);
      if (targetLang) socket.data.targetLang = normalizeLang(targetLang);
      if (socket.data.roomId) {
        socket.to(`room:${socket.data.roomId}`).emit('peer:lang', {
          socketId: socket.id,
          userId: user.id,
          sourceLang: socket.data.sourceLang,
          targetLang: socket.data.targetLang
        });
      }
    });

    // WebRTC signaling — forward to specific peer.
    // CRITICAL: we include the sender's CURRENT sourceLang/targetLang in the
    // forwarded payload so the receiver knows what language the new peer
    // speaks BEFORE audio starts flowing. Without this, the "peer joined
    // second" case (B already in room when A joins) would receive an
    // offer from A without any language info, and the OpenAI interpreter
    // on B's side would refuse to route A's audio (anti-echo guard) until
    // a later `peer:lang` event fixed it — meanwhile A's audio plays
    // untranslated.
    socket.on('webrtc:offer', ({ to, sdp }) => {
      io.to(to).emit('webrtc:offer', {
        from: socket.id,
        sdp,
        user: {
          id: user.id,
          displayName: user.display_name,
          avatarColor: user.avatar_color,
          sourceLang: socket.data.sourceLang,
          targetLang: socket.data.targetLang
        }
      });
    });
    socket.on('webrtc:answer', ({ to, sdp }) => {
      io.to(to).emit('webrtc:answer', {
        from: socket.id,
        sdp,
        user: {
          id: user.id,
          displayName: user.display_name,
          avatarColor: user.avatar_color,
          sourceLang: socket.data.sourceLang,
          targetLang: socket.data.targetLang
        }
      });
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
        // Collect every recipient's NATIVE language (what they want to READ in).
        // Each unique native language = ONE OpenAI call. Listeners that share a
        // native language share the same translation.
        const sockets = await io.in(`room:${socket.data.roomId}`).fetchSockets();
        const normSenderSource = normalizeLang(senderSource);
        const targetLangs = new Set();
        targetLangs.add(normSenderSource); // sender always sees their original
        sockets.forEach(s => {
          if (s.id === socket.id) return;
          const peerLang = normalizeLang(s.data.sourceLang);
          if (peerLang) targetLangs.add(peerLang);
        });

        // Translate once per unique target language, in parallel.
        const translations = { [normSenderSource]: trimmed };
        const toTranslate = Array.from(targetLangs).filter(l => l !== normSenderSource);
        await Promise.all(toTranslate.map(async (lang) => {
          const out = await translateText(trimmed, normSenderSource, lang);
          translations[lang] = out || trimmed;
        }));

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
          const recipientLang = isSender
            ? normSenderSource
            : (normalizeLang(s.data.sourceLang) || normSenderSource);
          const translated = translations[recipientLang] || trimmed;
          s.emit('chat:message', {
            ...msg,
            source_lang: normSenderSource,
            target_lang: isSender ? null : recipientLang,
            translated_content: isSender ? null : (recipientLang !== normSenderSource ? translated : null)
          });
        }
      } catch (err) {
        socket.emit('chat:error', { message: err.message });
      }
    });

    // Speak: REALTIME mode.
    //
    // Each participant runs their OWN OpenAI Realtime session in the browser
    // (see public/js/realtime.js). That session both translates the audio
    // and produces transcript deltas. The client forwards each transcript
    // delta here so we can:
    //   1. Render captions on the speaker's tile for everyone else.
    //   2. Persist a transcript_segments row when isFinal=true.
    //
    // There is NO server-side STT, NO server-side TTS, and NO server-side
    // translation. Audio is handled browser ↔ OpenAI directly over WebRTC.
    socket.on('speak', async (payload, ack) => {
      try {
        if (!socket.data.roomId) {
          if (typeof ack === 'function') ack({ ok: false, error: 'Not in a room' });
          return;
        }
        const meetingId = socket.data.roomId;
        const originalText = (payload && payload.originalText) || '';
        const translatedText = (payload && payload.translatedText) || '';
        const sourceLanguage = (payload && payload.sourceLanguage) || socket.data.sourceLang || 'auto';
        const isFinal = !!(payload && payload.isFinal);

        if (!originalText && !translatedText) {
          if (typeof ack === 'function') ack({ ok: true, skipped: true });
          return;
        }

        // Persist the segment only on the final delta (avoid spamming the DB
        // with every partial). Best-effort — don't fail the broadcast if
        // the insert fails.
        let segmentId = null;
        if (isFinal && originalText) {
          try {
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

            const endMs = Date.now();
            const translations = translatedText
              ? { [normalizeLang(socket.data.sourceLang || 'en')]: { text: translatedText } }
              : {};

            const ins = await db.query(
              `INSERT INTO transcript_segments
                 (meeting_id, speaker_participant_id, speaker_user_id,
                  source_language, original_text, translations,
                  audio_duration_ms, start_ms, end_ms, confidence)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [
                meetingId,
                speakerParticipantId,
                user.id,
                normalizeLang(sourceLanguage) || 'auto',
                originalText,
                JSON.stringify(translations),
                1000,
                endMs - 1000,
                endMs,
                0.95
              ]
            );
            segmentId = ins.insertId;
          } catch (e) {
            console.warn('[speak] persist failed', e.message);
          }
        }

        // Broadcast caption to everyone in the room (including the speaker).
        const captionPayload = {
          segmentId,
          speakerSocketId: socket.id,
          speakerUserId: user.id,
          speakerName: user.display_name,
          originalLanguage: normalizeLang(sourceLanguage) || 'auto',
          originalText,
          translatedText,
          isFinal
        };
        io.to(`room:${meetingId}`).emit('caption', captionPayload);

        if (typeof ack === 'function') {
          ack({ ok: true, segmentId });
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
