'use strict';

/**
 * Room view — meeting with WebRTC mesh + OpenAI Realtime interpreter.
 *
 * Design:
 *   - ONE single "My language" selector (seeded from user.native_language).
 *     Each participant hears EVERYTHING in their own language because their
 *     own browser runs a Realtime interpreter session that translates all
 *     incoming peer audio into that language.
 *   - Peer-to-peer audio/video over a WebRTC mesh, signaled via Socket.IO.
 *     Server protocol (defined in sockets/index.js):
 *       client → server: room:join, lang:update, webrtc:offer/answer/ice,
 *                         media:state, room:leave
 *       server → client: room:joined {room, peers}, peer:joined, peer:left,
 *                         peer:lang, webrtc:offer/answer/ice, media:state,
 *                         room:error
 *     Each peer object includes { userId, displayName, socketId,
 *     sourceLang, targetLang }. The newcomer creates offers for every
 *     existing peer to avoid glare.
 */

(function () {
  const PREF_KEY = 'bilingo.myLang';
  const ICE_SERVERS = [{ urls: ['stun:stun.l.google.com:19302'] }];

  function getBase() {
    return (window.__APP_BASE__) ||
      (document.querySelector('base')?.getAttribute('href')) ||
      '';
  }

  function getMyLang(user) {
    try {
      const stored = localStorage.getItem(PREF_KEY);
      if (stored) return stored;
    } catch (_) {}
    if (user && user.native_language) return String(user.native_language).toLowerCase().split('-')[0];
    return 'en';
  }
  function setMyLang(code) {
    try { localStorage.setItem(PREF_KEY, code); } catch (_) {}
  }

  const LANGS = [
    ['es', 'Español'], ['en', 'English'], ['pt', 'Português'],
    ['fr', 'Français'], ['de', 'Deutsch'], ['it', 'Italiano'],
    ['zh', '中文'], ['ja', '日本語'], ['ko', '한국어'],
    ['ar', 'العربية'], ['ru', 'Русский'], ['nl', 'Nederlands'],
    ['pl', 'Polski'], ['tr', 'Türkçe'], ['hi', 'हिन्दी']
  ];

  function el(tag, attrs, children) {
    const n = document.createElement(tag);
    if (attrs) Object.entries(attrs).forEach(([k, v]) => {
      if (k === 'class') n.className = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(n.style, v);
      else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2).toLowerCase(), v);
      else if (v !== false && v != null) n.setAttribute(k, v);
    });
    (Array.isArray(children) ? children : [children]).forEach(c => {
      if (c == null) return;
      n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return n;
  }

  function injectCss() {
    if (document.getElementById('roomViewInlineCss')) return;
    const css = el('style', { id: 'roomViewInlineCss' });
    css.textContent = `
      .room-view { display:flex; flex-direction:column; height:calc(100vh - 80px); gap:12px; padding:12px; }
      .room-topbar { display:flex; justify-content:space-between; align-items:center; padding:10px 14px; background:#fff; border:1px solid #e5e7eb; border-radius:12px; box-shadow:0 1px 2px rgba(0,0,0,.04); flex-wrap:wrap; gap:10px; }
      .room-title { display:flex; align-items:center; gap:10px; font-weight:700; color:#111827; }
      .room-tools { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
      .room-lang { display:flex; align-items:center; gap:6px; font-size:14px; color:#6b7280; }
      .lang-select { padding:6px 10px; border:1px solid #e5e7eb; border-radius:8px; background:#fff; font-size:14px; }
      .rv-btn { display:inline-flex; align-items:center; gap:6px; padding:8px 12px; border-radius:8px; border:1px solid #e5e7eb; background:#fff; cursor:pointer; font-size:14px; color:#111827; }
      .rv-btn:hover { background:#f9fafb; }
      .rv-btn.icon { width:38px; height:38px; padding:0; justify-content:center; }
      .rv-btn.primary { background:#2563eb; color:#fff; border-color:#2563eb; }
      .rv-btn.primary:hover { background:#1d4ed8; }
      .rv-btn.primary.on { background:#16a34a; border-color:#16a34a; }
      .rv-btn.danger  { background:#dc2626; color:#fff; border-color:#dc2626; }
      .rv-btn.danger:hover { background:#b91c1c; }
      .rv-btn.muted   { background:#fee2e2; color:#b91c1c; border-color:#fecaca; }
      .room-tiles { display:grid; gap:10px; grid-template-columns:repeat(auto-fit,minmax(280px,1fr)); flex:1; min-height:200px; }
      .tile { position:relative; background:#0b0f17; border-radius:12px; overflow:hidden; aspect-ratio:16/9; box-shadow:0 4px 16px rgba(0,0,0,.12); }
      .tile video { width:100%; height:100%; object-fit:cover; background:#000; }
      .tile .tile-label { position:absolute; left:8px; bottom:8px; background:rgba(0,0,0,.55); color:#fff; padding:3px 8px; border-radius:6px; font-size:12px; }
      .tile .tile-caption { position:absolute; left:8px; right:8px; bottom:36px; background:rgba(0,0,0,.6); color:#fff; padding:6px 10px; border-radius:6px; font-size:13px; line-height:1.3; max-height:40%; overflow:hidden; }
      .tile.local::after { display:none; }
      .room-captions { background:#fff; border:1px solid #e5e7eb; border-radius:12px; padding:10px 14px; min-height:60px; max-height:140px; overflow:auto; }
      .cap-empty { color:#9ca3af; font-size:13px; font-style:italic; }
      .cap-line { padding:4px 0; font-size:14px; border-bottom:1px dashed #eee; }
      .cap-line:last-child { border-bottom:0; }
      .cap-source { color:#6b7280; font-size:12px; }
      .cap-trans  { color:#111827; font-weight:500; }
      .room-status { color:#6b7280; font-size:12px; min-height:18px; padding:0 6px; }
    `;
    document.head.appendChild(css);
  }

  function buildLayout(container, ctx) {
    injectCss();
    container.innerHTML = '';

    const root = el('div', { class: 'room-view' });

    // ── Topbar ─────────────────────────────────────────────────────────
    const langSelect = el('select', { class: 'lang-select', id: 'myLangSel' });
    LANGS.forEach(([code, name]) => {
      const o = el('option', { value: code }, code.toUpperCase() + ' — ' + name);
      if (code === ctx.myLang) o.selected = true;
      langSelect.appendChild(o);
    });

    const topbar = el('div', { class: 'room-topbar' }, [
      el('div', { class: 'room-title' }, [
        el('i', { class: 'fa-solid fa-video' }),
        el('span', null, 'Sala ' + (ctx.roomCode || ''))
      ]),
      el('div', { class: 'room-tools' }, [
        el('label', { class: 'room-lang' }, [
          el('i', { class: 'fa-solid fa-language' }),
          el('span', null, ' Mi idioma '),
          langSelect
        ]),
        el('button', { class: 'rv-btn icon', id: 'btnMic', title: 'Mute / unmute' }, [
          el('i', { class: 'fa-solid fa-microphone' })
        ]),
        el('button', { class: 'rv-btn icon', id: 'btnCam', title: 'Camera on/off' }, [
          el('i', { class: 'fa-solid fa-video' })
        ]),
        el('button', { class: 'rv-btn primary', id: 'btnInterp', title: 'Activar traductor en vivo' }, [
          el('i', { class: 'fa-solid fa-language' }),
          el('span', null, ' Traductor: OFF')
        ]),
        el('button', { class: 'rv-btn danger', id: 'btnLeave', title: 'Salir' }, [
          el('i', { class: 'fa-solid fa-phone-slash' }),
          el('span', null, ' Salir')
        ])
      ])
    ]);

    const tiles    = el('div', { class: 'room-tiles', id: 'tiles' });
    const captions = el('div', { class: 'room-captions', id: 'captions' }, [
      el('div', { class: 'cap-empty' }, 'Activa el traductor para ver subtítulos en vivo en tu idioma.')
    ]);
    const status   = el('div', { class: 'room-status', id: 'roomStatus' }, '');

    root.appendChild(topbar);
    root.appendChild(tiles);
    root.appendChild(captions);
    root.appendChild(status);
    container.appendChild(root);

    return {
      tiles, captions, status,
      myLangSel: langSelect,
      btnMic:    root.querySelector('#btnMic'),
      btnCam:    root.querySelector('#btnCam'),
      btnInterp: root.querySelector('#btnInterp'),
      btnLeave:  root.querySelector('#btnLeave')
    };
  }

  function makeTile(label, isLocal) {
    const wrap = el('div', { class: 'tile' + (isLocal ? ' local' : '') });
    const video = el('video', { autoplay: true, playsinline: '' });
    if (isLocal) video.muted = true;
    const lbl = el('div', { class: 'tile-label' }, label + (isLocal ? ' (yo)' : ''));
    const cap = el('div', { class: 'tile-caption' });
    cap.style.display = 'none';
    wrap.appendChild(video);
    wrap.appendChild(cap);
    wrap.appendChild(lbl);
    return { wrap, video, cap, label };
  }

  async function render(container, params) {
    params = params || {};
    const roomCode = String(
      params.code || params.roomCode ||
      ((location.hash.match(/room\/([^/?]+)/) || [])[1] || '')
    ).trim().toLowerCase();

    if (!roomCode) {
      container.innerHTML = '<div class="alert alert-warning m-4">No se proporcionó código de sala.</div>';
      return;
    }

    const user = (window.AuthSession && window.AuthSession.getUser && window.AuthSession.getUser()) ||
                 (window.App && window.App.user) ||
                 (window.Auth && window.Auth.user) ||
                 {};
    const ctx  = { roomCode, user, myLang: getMyLang(user) };
    const ui   = buildLayout(container, ctx);

    // ── Local media ────────────────────────────────────────────────────
    let localStream = null;
    try {
      localStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
        video: { width: 1280, height: 720 }
      });
    } catch (e) {
      ui.status.textContent = 'No se pudo acceder a cámara: ' + (e.message || e) + ' — intentando solo audio…';
      try {
        localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch (e2) {
        ui.status.textContent = 'Sin permiso de micrófono/cámara. ' + (e2.message || e2);
        return;
      }
    }

    const meTile = makeTile(user.display_name || user.name || 'Yo', true);
    meTile.video.srcObject = localStream;
    ui.tiles.appendChild(meTile.wrap);

    // ── Peers map keyed by socketId ────────────────────────────────────
    /** @type {Map<string, {pc:RTCPeerConnection, tile:any, label:string, stream:MediaStream, userId:number, sourceLang:string}>} */
    const peers = new Map();
    let interpreter = null;
    let socket = null;
    let userToggledInterp = false; // tracks if user explicitly turned it ON

    function normLang(code) {
      return String(code || '').toLowerCase().split('-')[0];
    }

    // Returns true if at least one peer in the room speaks a different
    // language than mine. If everyone speaks my language, we don't need
    // the OpenAI Realtime translator and we just listen to the original
    // P2P audio (cheaper, lower latency, no quotas).
    function someoneNeedsTranslation() {
      const me = normLang(ctx.myLang);
      for (const p of peers.values()) {
        if (p.sourceLang && normLang(p.sourceLang) !== me) return true;
      }
      return false;
    }

    function pipeAudioToInterpreter(peerEntry, peerSocketId) {
      const me = normLang(ctx.myLang);
      const them = normLang(peerEntry.sourceLang);

      // PRE-LIVE GUARD: if the interpreter is still connecting but we
      // already know this peer speaks a DIFFERENT language than ours, mute
      // their raw <video> so the user doesn't hear them untranslated while
      // OpenAI is finishing the handshake. Once the interpreter goes live,
      // startInterpreter's onStatus will call this function again for every
      // peer and the audio will be routed through the mixer.
      if (interpreter && interpreter.state !== 'live') {
        if (them && them !== me) {
          try { peerEntry.tile.video.muted = true; } catch (_) {}
        }
        return;
      }
      if (!interpreter) {
        // No interpreter at all — keep raw P2P audio audible.
        try { peerEntry.tile.video.muted = false; } catch (_) {}
        return;
      }

      // CRITICAL ANTI-ECHO GUARD:
      // 1. If we don't yet KNOW the peer's language (sourceLang empty), DO NOT
      //    feed them to OpenAI. But ALSO keep the <video> muted so the user
      //    doesn't hear the raw peer while we wait. Otherwise the peer plays
      //    untranslated for a fraction of a second, and worse, the model can
      //    later echo the same audio.
      // 2. If the peer speaks MY language, never feed them — keep the original
      //    P2P audio. No translation needed.
      if (!them) {
        console.log('[room] pipe SKIP peer=' + peerSocketId +
                    ' reason=no-lang-yet (keeping video muted) me=' + me);
        try { peerEntry.tile.video.muted = true; } catch (_) {}
        try { interpreter.removePeerAudio(peerSocketId); } catch (_) {}
        return;
      }
      if (them === me) {
        console.log('[room] pipe SKIP peer=' + peerSocketId +
                    ' reason=same-lang me=' + me + ' them=' + them +
                    ' (unmuting raw P2P audio)');
        try { peerEntry.tile.video.muted = false; } catch (_) {}
        try { interpreter.removePeerAudio(peerSocketId); } catch (_) {}
        return;
      }

      // Different language confirmed → mute original audio and route to OpenAI.
      const feedStream = peerEntry.audioStream || peerEntry.stream;
      if (!feedStream || !feedStream.getAudioTracks().length) {
        console.log('[room] no audio yet for peer ' + peerSocketId + ' — will retry on ontrack');
        try { peerEntry.tile.video.muted = true; } catch (_) {}
        return;
      }

      // ABSOLUTE SAFETY: make sure we are NEVER feeding our own microphone
      // into the interpreter mixer. If even one track in `feedStream` matches
      // a track from `localStream`, that's a bug somewhere upstream (browser
      // loopback, mis-routed addTrack, etc) and would cause the user to hear
      // themselves echoed back by OpenAI in their own language.
      const localTrackIds = new Set(
        (localStream ? localStream.getAudioTracks() : []).map(t => t.id)
      );
      const safeStream = new MediaStream();
      let droppedLocal = 0;
      feedStream.getAudioTracks().forEach(t => {
        if (localTrackIds.has(t.id)) {
          droppedLocal++;
        } else {
          safeStream.addTrack(t);
        }
      });
      if (droppedLocal > 0) {
        console.warn('[room] SAFETY: dropped ' + droppedLocal +
                     ' LOCAL audio track(s) from peer feed ' + peerSocketId +
                     ' — this would have caused self-echo through OpenAI');
      }
      if (!safeStream.getAudioTracks().length) {
        console.warn('[room] peer ' + peerSocketId + ' had only local tracks!? skipping');
        try { peerEntry.tile.video.muted = true; } catch (_) {}
        return;
      }

      console.log('[room] pipe FEED peer=' + peerSocketId +
                  ' me=' + me + ' them=' + them +
                  ' tracks=' + safeStream.getAudioTracks().length);
      try { peerEntry.tile.video.muted = true; } catch (_) {}
      try { interpreter.addPeerAudio(safeStream, peerSocketId); } catch (_) {}
    }

    // Re-evaluate auto-routing whenever peers or languages change.
    function refreshInterpreterRouting() {
      // If no peer needs translation and the user didn't explicitly turn the
      // interpreter on, make sure it's OFF — even if it's still connecting.
      // We never want a session open with OpenAI when nobody needs it,
      // because the model can otherwise re-emit same-language audio (echo).
      if (!someoneNeedsTranslation() && !userToggledInterp) {
        if (interpreter) {
          ui.status.textContent = 'Todos hablan tu idioma — traductor desactivado.';
          stopInterpreter();
        }
        return;
      }
      // Auto-start: somebody needs translation but the interpreter isn't on.
      if (!interpreter) {
        ui.status.textContent = 'Detecté otro idioma en la sala — activando traductor automáticamente…';
        startInterpreter();
        return;
      }
      if (interpreter.state !== 'live') return;
      peers.forEach((p, id) => pipeAudioToInterpreter(p, id));
    }

    function createPeer(peerSocketId, label, userId, sourceLang) {
      const tile = makeTile(label || ('Peer ' + peerSocketId.slice(0, 4)), false);
      ui.tiles.appendChild(tile.wrap);
      const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
      localStream.getTracks().forEach(t => pc.addTrack(t, localStream));
      const remoteStream = new MediaStream();
      tile.video.srcObject = remoteStream;
      // We keep the AUDIO of this peer in a SEPARATE MediaStream so the
      // interpreter's MediaStreamAudioSourceNode is created against a stream
      // that already has the audio track (createMediaStreamSource takes a
      // snapshot of the tracks at creation time and does NOT pick up tracks
      // added later — that was the cause of "I don't hear them but they hear
      // themselves"). Whenever a new audio track arrives we rebuild this
      // dedicated audio stream and re-feed the interpreter.
      let audioOnlyStream = null;
      pc.ontrack = (ev) => {
        const tracks = (ev.streams && ev.streams[0])
          ? ev.streams[0].getTracks()
          : (ev.track ? [ev.track] : []);
        let audioChanged = false;
        tracks.forEach(t => {
          if (!remoteStream.getTracks().includes(t)) {
            remoteStream.addTrack(t);
            if (t.kind === 'audio') audioChanged = true;
          }
        });
        const entry = peers.get(peerSocketId);
        if (!entry) return;
        // (Re)build the audio-only stream so we can feed it to the
        // interpreter mixer at the right moment, with the audio track
        // already attached.
        if (audioChanged) {
          audioOnlyStream = new MediaStream();
          remoteStream.getAudioTracks().forEach(t => audioOnlyStream.addTrack(t));
          entry.audioStream = audioOnlyStream;
          console.log('[room] peer ' + peerSocketId + ' audio track attached — feeding interpreter');
        } else if (!entry.audioStream && remoteStream.getAudioTracks().length) {
          // Edge case: ontrack fired only for video, but the audio sneaked
          // into remoteStream another way. Rebuild from what we have.
          audioOnlyStream = new MediaStream();
          remoteStream.getAudioTracks().forEach(t => audioOnlyStream.addTrack(t));
          entry.audioStream = audioOnlyStream;
        }
        pipeAudioToInterpreter(entry, peerSocketId);
      };
      pc.onicecandidate = (ev) => {
        if (ev.candidate && socket) {
          socket.emit('webrtc:ice', { to: peerSocketId, candidate: ev.candidate });
        }
      };
      pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
          // Will be cleaned up by peer:left or our own removePeer
        }
      };
      const entry = {
        pc, tile,
        label: label || peerSocketId.slice(0, 6),
        stream: remoteStream,
        audioStream: null,    // built lazily on ontrack(kind=audio)
        userId,
        sourceLang: normLang(sourceLang) || ''
      };
      peers.set(peerSocketId, entry);
      return entry;
    }

    function removePeer(peerSocketId) {
      const p = peers.get(peerSocketId);
      if (!p) return;
      try { p.pc.close(); } catch (_) {}
      if (p.tile.wrap.parentNode) p.tile.wrap.parentNode.removeChild(p.tile.wrap);
      if (interpreter) {
        try { interpreter.removePeerAudio(peerSocketId); } catch (_) {}
      }
      peers.delete(peerSocketId);
    }

    // ── Socket.IO signaling ────────────────────────────────────────────
    if (typeof io !== 'function') {
      ui.status.textContent = 'Socket.IO no cargado.';
      return;
    }
    const base = getBase();
    const ioPath = (base.endsWith('/') ? base.slice(0, -1) : base) + '/socket.io';
    const token = (function () { try { return localStorage.getItem('token'); } catch (_) { return null; } })();

    // The PUBLIC proxy (/project-<u>/<p>/) does NOT support the
    // HTTP→WebSocket upgrade for socket.io: handshake works on polling,
    // but the WS upgrade is refused and the next long-poll returns 502.
    // Detect that case and stay on long-polling. Inside /run/<id>/ the
    // upgrade works fine, so we keep websocket as an upgrade target.
    const isPublicProxy = /^\/project-/.test(base);
    const ioTransports = isPublicProxy ? ['polling'] : ['polling', 'websocket'];
    const ioUpgrade = !isPublicProxy;

    socket = io({
      path: ioPath,
      transports: ioTransports,
      upgrade: ioUpgrade,
      auth: token ? { token } : undefined,
      query: token ? { token } : undefined
    });

    socket.on('connect', () => {
      ui.status.textContent = 'Conectado. Entrando a la sala…';
      socket.emit('room:join', {
        roomCode: ctx.roomCode,
        sourceLang: ctx.myLang,
        targetLang: ctx.myLang
      });
    });

    socket.on('disconnect', () => { ui.status.textContent = 'Desconectado del servidor.'; });
    socket.on('connect_error', (err) => {
      ui.status.textContent = 'Error de conexión: ' + (err && err.message || err);
    });
    socket.on('room:error', (err) => {
      ui.status.textContent = 'Error de sala: ' + (err && err.message || 'desconocido');
    });

    // I joined → server sends list of peers already in the room.
    // I create offers to each of them (avoids glare: late joiner always offers).
    socket.on('room:joined', async ({ room, peers: existing }) => {
      ui.status.textContent = 'En la sala. ' + (existing.length === 0
        ? 'Esperando participantes…'
        : (existing.length + ' participante(s) en línea.'));
      for (const p of (existing || [])) {
        const peer = createPeer(
          p.socketId,
          p.displayName || ('Peer'),
          p.userId,
          p.sourceLang || p.targetLang
        );
        try {
          const offer = await peer.pc.createOffer();
          await peer.pc.setLocalDescription(offer);
          socket.emit('webrtc:offer', { to: p.socketId, sdp: offer });
        } catch (e) {
          ui.status.textContent = 'Error al crear oferta: ' + (e.message || e);
        }
      }
      refreshInterpreterRouting();
    });

    // New peer joined AFTER me → they will send the offer to me.
    socket.on('peer:joined', (p) => {
      ui.status.textContent = (p.displayName || 'Alguien') + ' se unió.';
      // Don't pre-create the peer here; we'll create it on webrtc:offer.
      // But we can pre-create to show the tile sooner — let's NOT,
      // because we don't know yet if they'll connect.
    });

    socket.on('peer:left', ({ socketId }) => {
      removePeer(socketId);
      ui.status.textContent = 'Un participante salió.';
    });

    socket.on('peer:lang', ({ socketId, sourceLang, targetLang }) => {
      const p = peers.get(socketId);
      if (!p) return;
      const prevLang = p.sourceLang;
      p.sourceLang = normLang(sourceLang || targetLang) || p.sourceLang;
      console.log('[room] peer:lang update — socketId=' + socketId +
                  ' prev=' + (prevLang || '(none)') +
                  ' new=' + p.sourceLang +
                  ' myLang=' + ctx.myLang);
      // First, re-evaluate whether we need the interpreter at all (may
      // auto-start it). This is async, so we cannot rely on it having
      // finished routing this specific peer.
      refreshInterpreterRouting();
      // Explicitly (re)route THIS peer's audio now that we know its
      // language. This is the critical step for the "joined second"
      // peer whose lang we only learn AFTER the WebRTC offer/answer
      // has already fired ontrack. Without this, the peer's audio
      // stays glued to the original (untranslated) <video> element.
      if (interpreter && interpreter.state === 'live') {
        pipeAudioToInterpreter(p, socketId);
      } else if (interpreter && interpreter.state === 'connecting') {
        // Queue a one-shot retry once the session goes live.
        const tryAgain = () => {
          if (interpreter && interpreter.state === 'live') {
            pipeAudioToInterpreter(p, socketId);
          } else {
            setTimeout(tryAgain, 300);
          }
        };
        setTimeout(tryAgain, 300);
      }
    });

    // WebRTC signaling
    socket.on('webrtc:offer', async ({ from, sdp, user: peerUser }) => {
      let entry = peers.get(from);
      if (!entry) {
        entry = createPeer(
          from,
          (peerUser && peerUser.displayName) || 'Peer',
          peerUser && peerUser.id,
          peerUser && (peerUser.sourceLang || peerUser.targetLang)
        );
      } else if (peerUser && (peerUser.sourceLang || peerUser.targetLang)) {
        // Update sourceLang in case we learn it now from the offer payload.
        const newLang = normLang(peerUser.sourceLang || peerUser.targetLang);
        if (newLang) entry.sourceLang = newLang;
      }
      console.log('[room] webrtc:offer received from=' + from +
                  ' peerLang=' + (entry.sourceLang || '(unknown)') +
                  ' myLang=' + ctx.myLang);
      try {
        await entry.pc.setRemoteDescription(sdp);
        const answer = await entry.pc.createAnswer();
        await entry.pc.setLocalDescription(answer);
        socket.emit('webrtc:answer', { to: from, sdp: answer });
      } catch (e) {
        ui.status.textContent = 'Error procesando oferta: ' + (e.message || e);
      }
      refreshInterpreterRouting();
      // If the interpreter is already live AND we now know the peer's lang,
      // make sure their audio is routed (ontrack may have fired before we
      // knew the lang).
      if (interpreter && interpreter.state === 'live') {
        pipeAudioToInterpreter(entry, from);
      }
    });

    socket.on('webrtc:answer', async ({ from, sdp, user: peerUser }) => {
      const entry = peers.get(from);
      if (!entry) return;
      // If we learn the peer's language from the answer (it can arrive
      // before the `peer:lang` broadcast), update it now and re-evaluate
      // routing — same fix as for offers, but for the symmetric case
      // where I was the OFFERER and didn't yet know the answerer's lang.
      if (peerUser && (peerUser.sourceLang || peerUser.targetLang)) {
        const newLang = normLang(peerUser.sourceLang || peerUser.targetLang);
        if (newLang && newLang !== entry.sourceLang) {
          console.log('[room] learned peer lang from answer — socketId=' + from +
                      ' lang=' + newLang);
          entry.sourceLang = newLang;
        }
      }
      try { await entry.pc.setRemoteDescription(sdp); }
      catch (e) { ui.status.textContent = 'Error procesando respuesta: ' + (e.message || e); }
      refreshInterpreterRouting();
      if (interpreter && interpreter.state === 'live') {
        pipeAudioToInterpreter(entry, from);
      }
    });

    socket.on('webrtc:ice', async ({ from, candidate }) => {
      const entry = peers.get(from);
      if (!entry || !candidate) return;
      try { await entry.pc.addIceCandidate(candidate); } catch (_) {}
    });

    socket.on('media:state', () => { /* could toggle mute icons */ });

    // ── Captions ───────────────────────────────────────────────────────
    function appendCaption({ kind, text, final }) {
      const stripEmpty = ui.captions.querySelector('.cap-empty');
      if (stripEmpty) stripEmpty.remove();
      const cls = kind === 'translation' ? 'cap-trans' : 'cap-source';
      let live = ui.captions.querySelector('.cap-line[data-live="' + cls + '"]');
      if (!live) {
        live = el('div', { class: 'cap-line', 'data-live': cls }, [
          el('span', { class: cls }, text)
        ]);
        ui.captions.appendChild(live);
      } else {
        live.querySelector('span').textContent = text;
      }
      if (final) live.removeAttribute('data-live');
      ui.captions.scrollTop = ui.captions.scrollHeight;

      // Mirror translation into a generic "everyone speaks" caption on all peer tiles
      if (kind === 'translation') {
        peers.forEach((p) => {
          p.tile.cap.style.display = 'block';
          p.tile.cap.textContent = text;
          if (final) {
            setTimeout(() => {
              if (p.tile.cap.textContent === text) p.tile.cap.style.display = 'none';
            }, 4000);
          }
        });
      }
    }

    // ── Interpreter (OpenAI Realtime) ──────────────────────────────────
    async function startInterpreter() {
      if (interpreter && (interpreter.state === 'live' || interpreter.state === 'connecting')) return;
      if (typeof RealtimeInterpreter !== 'function') {
        ui.status.textContent = 'Cliente Realtime no cargado.';
        return;
      }
      ui.btnInterp.disabled = true;
      ui.btnInterp.querySelector('span').textContent = ' Conectando…';
      try {
        interpreter = new RealtimeInterpreter({
          basePath: base,
          nativeLang: ctx.myLang,
          onCaption: appendCaption,
          onStatus: (s) => {
            ui.status.textContent = 'Traductor: ' + s;
            if (s === 'live') {
              ui.btnInterp.classList.add('on');
              ui.btnInterp.querySelector('span').textContent = ' Traductor: ON';
              ui.btnInterp.disabled = false;
              peers.forEach((p, id) => pipeAudioToInterpreter(p, id));
            } else if (s === 'closed' || s === 'error') {
              ui.btnInterp.classList.remove('on');
              ui.btnInterp.querySelector('span').textContent = ' Traductor: OFF';
              ui.btnInterp.disabled = false;
              peers.forEach((p) => { try { p.tile.video.muted = false; } catch (_) {} });
            }
          },
          onError: (err) => {
            ui.status.textContent = 'Error del traductor: ' + (err.message || err);
            console.error('[interpreter]', err);
          }
        });
        await interpreter.start();
      } catch (err) {
        ui.btnInterp.disabled = false;
        ui.btnInterp.classList.remove('on');
        ui.btnInterp.querySelector('span').textContent = ' Traductor: OFF';
        ui.status.textContent = 'No se pudo activar el traductor: ' + (err.message || err);
      }
    }

    function stopInterpreter() {
      if (interpreter) {
        try { interpreter.stop(); } catch (_) {}
        interpreter = null;
      }
      peers.forEach((p) => { try { p.tile.video.muted = false; } catch (_) {} });
      ui.btnInterp.classList.remove('on');
      ui.btnInterp.querySelector('span').textContent = ' Traductor: OFF';
    }

    ui.btnInterp.addEventListener('click', () => {
      if (interpreter && (interpreter.state === 'live' || interpreter.state === 'connecting' || interpreter.state === 'reconnecting')) {
        userToggledInterp = false;
        stopInterpreter();
      } else {
        // Explicit user request — start regardless of room language mix.
        userToggledInterp = true;
        if (!someoneNeedsTranslation()) {
          ui.status.textContent = 'Todos hablan tu idioma — no se necesita traducción, pero activo igual.';
        }
        startInterpreter();
      }
    });

    // ── Mic / Cam toggles ──────────────────────────────────────────────
    ui.btnMic.addEventListener('click', () => {
      const tracks = localStream.getAudioTracks();
      const newState = !(tracks[0] && tracks[0].enabled);
      tracks.forEach(t => (t.enabled = newState));
      ui.btnMic.classList.toggle('muted', !newState);
      ui.btnMic.querySelector('i').className = newState ? 'fa-solid fa-microphone' : 'fa-solid fa-microphone-slash';
      if (socket) socket.emit('media:state', { muted: !newState });
    });
    ui.btnCam.addEventListener('click', () => {
      const tracks = localStream.getVideoTracks();
      const newState = !(tracks[0] && tracks[0].enabled);
      tracks.forEach(t => (t.enabled = newState));
      ui.btnCam.classList.toggle('muted', !newState);
      ui.btnCam.querySelector('i').className = newState ? 'fa-solid fa-video' : 'fa-solid fa-video-slash';
      if (socket) socket.emit('media:state', { videoOff: !newState });
    });

    // ── Language change ────────────────────────────────────────────────
    ui.myLangSel.addEventListener('change', async () => {
      ctx.myLang = ui.myLangSel.value;
      setMyLang(ctx.myLang);
      if (socket) socket.emit('lang:update', { sourceLang: ctx.myLang, targetLang: ctx.myLang });
      // If the interpreter is running, the OpenAI session is tied to the
      // OLD nativeLang — we must tear it down so refreshInterpreterRouting
      // can spin up a fresh one in the new language (if still needed).
      if (interpreter) {
        try { interpreter.stop(); } catch (_) {}
        interpreter = null;
        ui.btnInterp.classList.remove('on');
        ui.btnInterp.querySelector('span').textContent = ' Traductor: OFF';
        peers.forEach((p) => { try { p.tile.video.muted = false; } catch (_) {} });
      }
      // Re-evaluate: this will auto-start the interpreter again if any peer
      // still speaks a different language than the new "myLang", or shut it
      // down if everyone now matches.
      refreshInterpreterRouting();
    });

    // ── Leave ──────────────────────────────────────────────────────────
    let leaving = false;
    function leave() {
      if (leaving) return;
      leaving = true;
      try { if (socket) socket.emit('room:leave'); } catch (_) {}
      try { if (socket) socket.disconnect(); } catch (_) {}
      try { stopInterpreter(); } catch (_) {}
      try { localStream.getTracks().forEach(t => t.stop()); } catch (_) {}
      Array.from(peers.keys()).forEach(id => removePeer(id));
      if (window.Router && typeof window.Router.go === 'function') window.Router.go('dashboard');
      else if (window.Router && typeof window.Router.navigate === 'function') window.Router.navigate('dashboard');
      else window.location.hash = 'dashboard';
    }
    ui.btnLeave.addEventListener('click', leave);
    window.addEventListener('beforeunload', leave);

    ui.status.textContent = 'Conectando al servidor…';
  }

  window.Views = window.Views || {};
  window.Views.room = { render };
  window.RoomView = { render };

  // Register with the SPA router so navigating to #/room/<code> renders this view.
  // The router passes the second hash segment as params.id.
  if (window.Router && typeof window.Router.register === 'function') {
    window.Router.register('room', function (container, params) {
      params = params || {};
      // Map router's `id` param to what render() expects.
      if (params.id && !params.code) params.code = params.id;
      return render(container, params);
    });
  }
})();
