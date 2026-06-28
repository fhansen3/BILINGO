(function () {
  'use strict';

  var ICE_CONFIG = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' }
    ]
  };

  // Common languages supported by MyMemory
  var LANGUAGES = [
    { code: 'en', label: 'Inglés' },
    { code: 'es', label: 'Español' },
    { code: 'fr', label: 'Francés' },
    { code: 'de', label: 'Alemán' },
    { code: 'it', label: 'Italiano' },
    { code: 'pt', label: 'Portugués' },
    { code: 'ru', label: 'Ruso' },
    { code: 'ja', label: 'Japonés' },
    { code: 'ko', label: 'Coreano' },
    { code: 'zh', label: 'Chino' },
    { code: 'ar', label: 'Árabe' },
    { code: 'nl', label: 'Holandés' },
    { code: 'pl', label: 'Polaco' },
    { code: 'tr', label: 'Turco' },
    { code: 'sv', label: 'Sueco' },
    { code: 'el', label: 'Griego' },
    { code: 'hi', label: 'Hindi' },
    { code: 'ca', label: 'Catalán' }
  ];

  function langOptions(selected) {
    return LANGUAGES.map(function (l) {
      return '<option value="' + l.code + '"' + (l.code === selected ? ' selected' : '') + '>' + l.label + '</option>';
    }).join('');
  }

  function langLabel(code) {
    var found = LANGUAGES.find(function (l) { return l.code === code; });
    return found ? found.label : code;
  }

  async function render(container, params) {
    var roomCode = (params.id || '').toUpperCase();
    if (!roomCode) { window.Router.navigate('dashboard'); return; }

    var user = window.Auth.getUser();
    var socket = null;
    var localStream = null;
    var peers = {}; // socketId -> { pc, user, videoEl }
    var audioOn = true;
    var videoOn = true;
    var ended = false;

    // Default language prefs — try to seed from the user's profile if available
    var sourceLang = (user && user.native_language) || localStorage.getItem('bl_source_lang') || 'es';
    var targetLang = (user && user.learning_language) || localStorage.getItem('bl_target_lang') || 'en';

    container.innerHTML =
      '<div class="app-shell">' +
        '<nav class="navbar-bl">' +
          '<a href="#/dashboard" class="brand" style="text-decoration:none"><span class="parrot">🦜</span> BiLingo Meet</a>' +
          '<div class="nav-links">' +
            '<span class="nav-link"><i class="fa-solid fa-door-open"></i> Sala <strong style="color:var(--green); margin-left:6px">' + window.UI.escapeHtml(roomCode) + '</strong></span>' +
          '</div>' +
        '</nav>' +
        '<main style="padding:16px; max-width:1400px; margin:0 auto; width:100%">' +
          '<div class="room-layout">' +
            '<div class="video-area">' +
              '<div class="video-grid solo" id="video-grid">' +
                '<div class="video-tile" id="local-tile">' +
                  '<video id="local-video" autoplay muted playsinline></video>' +
                  '<div class="tile-label"><i class="fa-solid fa-circle" style="color:var(--green); font-size:0.5rem"></i> Tú (' + window.UI.escapeHtml(user.display_name) + ')</div>' +
                '</div>' +
              '</div>' +
              '<div class="room-controls">' +
                '<button class="ctrl-btn" id="toggle-audio" title="Micrófono"><i class="fa-solid fa-microphone"></i></button>' +
                '<button class="ctrl-btn" id="toggle-video" title="Cámara"><i class="fa-solid fa-video"></i></button>' +
                '<button class="ctrl-btn leave" id="leave-btn"><i class="fa-solid fa-phone-slash"></i> Salir</button>' +
              '</div>' +
            '</div>' +
            '<div class="sidebar-panel">' +
              '<div class="sidebar-tabs">' +
                '<button class="sidebar-tab active" data-tab="info"><i class="fa-solid fa-circle-info"></i> Sala</button>' +
                '<button class="sidebar-tab" data-tab="chat"><i class="fa-solid fa-comments"></i> Chat</button>' +
              '</div>' +
              '<div class="sidebar-body">' +
                '<div id="tab-info" class="room-info-panel">' +
                  '<p class="muted" style="margin:0">Comparte este código con tu compañero:</p>' +
                  '<div class="room-code-display">' + window.UI.escapeHtml(roomCode) + '</div>' +
                  '<button class="btn-bl btn-blue btn-sm" id="copy-link" style="width:100%"><i class="fa-solid fa-copy"></i> Copiar enlace</button>' +
                  '<div style="margin-top:18px"><div style="font-weight:800; margin-bottom:6px">Participantes</div><div id="participants-list" class="muted">Cargando…</div></div>' +
                '</div>' +
                '<div id="tab-chat" style="display:none; flex-direction:column; flex:1; overflow:hidden">' +
                  '<div class="lang-bar">' +
                    '<div class="lang-bar-group">' +
                      '<label><i class="fa-solid fa-keyboard"></i> Hablo en</label>' +
                      '<select id="src-lang">' + langOptions(sourceLang) + '</select>' +
                    '</div>' +
                    '<i class="fa-solid fa-arrow-right lang-arrow"></i>' +
                    '<div class="lang-bar-group">' +
                      '<label><i class="fa-solid fa-language"></i> Quiero ver</label>' +
                      '<select id="tgt-lang">' + langOptions(targetLang) + '</select>' +
                    '</div>' +
                  '</div>' +
                  '<div class="chat-messages" id="chat-messages"></div>' +
                  '<form class="chat-input-bar" id="chat-form">' +
                    '<input type="text" id="chat-input" placeholder="Escribe en tu idioma…" maxlength="2000" autocomplete="off">' +
                    '<button type="submit" class="btn-bl btn-green btn-sm"><i class="fa-solid fa-paper-plane"></i></button>' +
                  '</form>' +
                '</div>' +
              '</div>' +
            '</div>' +
          '</div>' +
        '</main>' +
      '</div>';

    var grid = container.querySelector('#video-grid');
    var localVideo = container.querySelector('#local-video');
    var participantsList = container.querySelector('#participants-list');
    var chatMessages = container.querySelector('#chat-messages');
    var chatForm = container.querySelector('#chat-form');
    var chatInput = container.querySelector('#chat-input');
    var srcSelect = container.querySelector('#src-lang');
    var tgtSelect = container.querySelector('#tgt-lang');

    // Tabs
    container.querySelectorAll('.sidebar-tab').forEach(function (t) {
      t.addEventListener('click', function () {
        container.querySelectorAll('.sidebar-tab').forEach(function (x) { x.classList.remove('active'); });
        t.classList.add('active');
        var which = t.dataset.tab;
        container.querySelector('#tab-info').style.display = which === 'info' ? '' : 'none';
        container.querySelector('#tab-chat').style.display = which === 'chat' ? 'flex' : 'none';
      });
    });

    // Language selectors
    srcSelect.addEventListener('change', function () {
      sourceLang = srcSelect.value;
      localStorage.setItem('bl_source_lang', sourceLang);
      if (socket) socket.emit('lang:update', { sourceLang: sourceLang, targetLang: targetLang });
      window.UI.notify('Escribirás en ' + langLabel(sourceLang), 'info');
    });
    tgtSelect.addEventListener('change', function () {
      targetLang = tgtSelect.value;
      localStorage.setItem('bl_target_lang', targetLang);
      if (socket) socket.emit('lang:update', { sourceLang: sourceLang, targetLang: targetLang });
      window.UI.notify('Verás traducciones en ' + langLabel(targetLang), 'info');
    });

    // Copy link
    container.querySelector('#copy-link').addEventListener('click', function () {
      var link = window.location.origin + window.location.pathname + '#/room/' + roomCode;
      navigator.clipboard.writeText(link).then(function () {
        window.UI.notify('Enlace copiado al portapapeles', 'success');
      }).catch(function () {
        window.UI.notify('No se pudo copiar', 'error');
      });
    });

    // Get user media
    try {
      localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      localVideo.srcObject = localStream;
    } catch (err) {
      window.UI.notify('No se pudo acceder a la cámara/micrófono: ' + err.message, 'error');
      localStream = new MediaStream();
    }

    // Join room via API first
    try {
      await window.API.post('api/rooms/' + roomCode + '/join', {});
    } catch (err) {
      window.UI.notify(err.message || 'No se pudo unir a la sala', 'error');
      setTimeout(function () { window.Router.navigate('dashboard'); }, 1500);
      return;
    }

    // Load chat history
    try {
      var roomData = await window.API.get('api/rooms/' + roomCode);
      var msgs = await window.API.get('api/rooms/' + roomData.id + '/messages');
      msgs.forEach(addChatMessage);
    } catch (e) { /* ignore */ }

    // Connect socket
    var basePath = (document.querySelector('base') && document.querySelector('base').getAttribute('href')) || '/';
    if (!basePath.endsWith('/')) basePath += '/';
    socket = io({
      path: basePath + 'socket.io',
      transports: ['polling'],
      upgrade: false
    });

    socket.on('connect', function () {
      socket.emit('room:join', { roomCode: roomCode, sourceLang: sourceLang, targetLang: targetLang });
    });

    socket.on('room:error', function (data) {
      window.UI.notify(data.message || 'Error de sala', 'error');
    });

    socket.on('room:joined', function (data) {
      updateParticipants();
      data.peers.forEach(function (peer) { createPeer(peer, true); });
    });

    socket.on('peer:joined', function (peer) {
      createPeer({ socketId: peer.socketId, userId: peer.userId, displayName: peer.displayName, avatarColor: peer.avatarColor, sourceLang: peer.sourceLang, targetLang: peer.targetLang }, false);
      window.UI.notify(peer.displayName + ' se ha unido 👋', 'info');
    });

    socket.on('peer:left', function (data) {
      removePeer(data.socketId);
    });

    socket.on('peer:lang', function (data) {
      var peer = peers[data.socketId];
      if (peer) {
        peer.user.sourceLang = data.sourceLang;
        peer.user.targetLang = data.targetLang;
        updateParticipants();
      }
    });

    socket.on('webrtc:offer', async function (data) {
      var peer = peers[data.from];
      if (!peer) {
        peer = createPeer({ socketId: data.from, userId: data.user.id, displayName: data.user.displayName, avatarColor: data.user.avatarColor }, false);
      }
      try {
        await peer.pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
        var answer = await peer.pc.createAnswer();
        await peer.pc.setLocalDescription(answer);
        socket.emit('webrtc:answer', { to: data.from, sdp: answer });
      } catch (err) { console.error('offer handle err', err); }
    });

    socket.on('webrtc:answer', async function (data) {
      var peer = peers[data.from];
      if (!peer) return;
      try { await peer.pc.setRemoteDescription(new RTCSessionDescription(data.sdp)); } catch (e) { console.error(e); }
    });

    socket.on('webrtc:ice', async function (data) {
      var peer = peers[data.from];
      if (!peer || !data.candidate) return;
      try { await peer.pc.addIceCandidate(new RTCIceCandidate(data.candidate)); } catch (e) { /* ignore */ }
    });

    socket.on('chat:message', function (msg) {
      addChatMessage(msg);
    });

    // Caption overlay on the speaker's tile (per the in_meeting_room design).
    // Renders original (small) + translated (main) inside a fade-out bubble.
    socket.on('caption', function (cap) {
      try {
        var speakerSid = cap.speakerSocketId;
        var isSelf = cap.isSelf || (speakerSid === socket.id);
        var tile = isSelf ? document.getElementById('local-tile')
                          : document.getElementById('tile-' + speakerSid);
        if (!tile) return;
        var bubble = tile.querySelector('.caption-bubble');
        if (!bubble) {
          bubble = document.createElement('div');
          bubble.className = 'caption-bubble';
          bubble.style.cssText = 'position:absolute;left:8px;right:8px;bottom:32px;background:rgba(15,23,42,.78);color:#F8FAFC;border-radius:10px;padding:8px 12px;font-size:0.85rem;line-height:1.35;backdrop-filter:blur(8px);pointer-events:none;z-index:5';
          tile.style.position = 'relative';
          tile.appendChild(bubble);
        }
        var origHtml = '<div style="font-size:0.72rem;color:#94A3B8;margin-bottom:2px"><span class="lang-tag">' + window.UI.escapeHtml(cap.originalLanguage || '') + '</span> ' + window.UI.escapeHtml(cap.originalText || '') + '</div>';
        var translatedHtml = '';
        if (!isSelf && cap.translatedText && cap.translatedText !== cap.originalText) {
          translatedHtml = '<div style="font-weight:600">' + window.UI.escapeHtml(cap.translatedText) + '</div>';
        }
        var degraded = cap.isDegraded
          ? '<div style="margin-top:4px;font-size:0.65rem;color:#FCD34D"><i class="fa-solid fa-triangle-exclamation"></i> Traducción degradada</div>'
          : '';
        bubble.innerHTML = origHtml + translatedHtml + degraded;
        // Auto-hide after a short window so captions don't pile up.
        if (bubble._timer) clearTimeout(bubble._timer);
        bubble.style.opacity = '1';
        bubble._timer = setTimeout(function () {
          bubble.style.transition = 'opacity 0.4s';
          bubble.style.opacity = '0';
        }, 4500);
      } catch (e) { /* swallow render errors */ }
    });

    // Speaker echo — confirms our utterance was transcribed.
    socket.on('speak:transcribed', function (info) {
      console.log('[caption] transcribed', info.segmentId, '→', info.listenerCount, 'listeners');
    });

    function createPeer(info, initiator) {
      if (peers[info.socketId]) return peers[info.socketId];
      var pc = new RTCPeerConnection(ICE_CONFIG);
      var peer = { pc: pc, user: info, videoEl: null };
      peers[info.socketId] = peer;

      if (localStream) {
        localStream.getTracks().forEach(function (t) { pc.addTrack(t, localStream); });
      }

      pc.onicecandidate = function (e) {
        if (e.candidate) socket.emit('webrtc:ice', { to: info.socketId, candidate: e.candidate });
      };

      pc.ontrack = function (e) {
        attachRemoteStream(info, e.streams[0]);
      };

      pc.onconnectionstatechange = function () {
        if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
          removePeer(info.socketId);
        }
      };

      if (initiator) {
        pc.createOffer().then(function (offer) {
          return pc.setLocalDescription(offer).then(function () {
            socket.emit('webrtc:offer', { to: info.socketId, sdp: offer });
          });
        }).catch(function (err) { console.error('offer err', err); });
      }

      addPeerTile(info);
      updateParticipants();
      return peer;
    }

    function addPeerTile(info) {
      if (document.getElementById('tile-' + info.socketId)) return;
      var tile = document.createElement('div');
      tile.className = 'video-tile';
      tile.id = 'tile-' + info.socketId;
      tile.innerHTML =
        '<video autoplay playsinline></video>' +
        '<div class="tile-label"><i class="fa-solid fa-circle" style="color:' + info.avatarColor + '; font-size:0.5rem"></i> ' + window.UI.escapeHtml(info.displayName) + '</div>';
      grid.appendChild(tile);
      grid.classList.remove('solo');
      peers[info.socketId].videoEl = tile.querySelector('video');
    }

    function attachRemoteStream(info, stream) {
      var peer = peers[info.socketId];
      if (peer && peer.videoEl) peer.videoEl.srcObject = stream;
    }

    function removePeer(socketId) {
      var peer = peers[socketId];
      if (!peer) return;
      try { peer.pc.close(); } catch (e) {}
      delete peers[socketId];
      var tile = document.getElementById('tile-' + socketId);
      if (tile) tile.remove();
      if (Object.keys(peers).length === 0) grid.classList.add('solo');
      updateParticipants();
    }

    function updateParticipants() {
      var items = [
        '<div style="display:flex; align-items:center; gap:8px; padding:6px 0">' +
          window.UI.avatar(user.display_name, user.avatar_color, 'sm') +
          '<div>' +
            '<div style="font-weight:800; font-size:0.9rem">' + window.UI.escapeHtml(user.display_name) + ' (tú)</div>' +
            '<div class="muted" style="font-size:0.75rem">' + langLabel(sourceLang) + ' <i class="fa-solid fa-arrow-right" style="font-size:0.65rem"></i> ' + langLabel(targetLang) + '</div>' +
          '</div>' +
        '</div>'
      ];
      Object.keys(peers).forEach(function (sid) {
        var p = peers[sid].user;
        var langInfo = '';
        if (p.sourceLang) {
          langInfo = '<div class="muted" style="font-size:0.75rem">' + langLabel(p.sourceLang) + (p.targetLang ? ' <i class="fa-solid fa-arrow-right" style="font-size:0.65rem"></i> ' + langLabel(p.targetLang) : '') + '</div>';
        }
        items.push('<div style="display:flex; align-items:center; gap:8px; padding:6px 0">' +
          window.UI.avatar(p.displayName, p.avatarColor, 'sm') +
          '<div>' +
            '<div style="font-weight:800; font-size:0.9rem">' + window.UI.escapeHtml(p.displayName) + '</div>' +
            langInfo +
          '</div>' +
        '</div>');
      });
      participantsList.innerHTML = items.join('');
    }

    function addChatMessage(msg) {
      var own = msg.user_id === user.id;
      var el = document.createElement('div');
      el.className = 'chat-msg' + (own ? ' own' : '');

      var bubbleHtml = '';
      if (!own) {
        bubbleHtml += '<div class="sender" style="color:' + (msg.avatar_color || '#58CC02') + '">' + window.UI.escapeHtml(msg.display_name) + '</div>';
      }

      // Decide what to show:
      // - If we have a translation different from the original, show original (small) + translation (main)
      // - Otherwise just show the original
      var original = msg.content || '';
      var translated = msg.translated_content;
      var srcL = msg.source_lang;
      var tgtL = msg.target_lang;

      if (!own && translated && translated !== original) {
        bubbleHtml +=
          '<div class="msg-translated">' + window.UI.escapeHtml(translated) + '</div>' +
          '<div class="msg-original">' +
            '<span class="lang-tag">' + window.UI.escapeHtml(srcL || '') + '</span> ' +
            window.UI.escapeHtml(original) +
          '</div>';
      } else {
        bubbleHtml += '<div>' + window.UI.escapeHtml(original) + '</div>';
        if (!own && srcL && srcL !== sourceLang && !translated) {
          bubbleHtml += '<div class="msg-original" style="opacity:0.6"><span class="lang-tag">' + window.UI.escapeHtml(srcL) + '</span> (sin traducir)</div>';
        }
      }

      el.innerHTML =
        (!own ? window.UI.avatar(msg.display_name, msg.avatar_color, 'sm') : '') +
        '<div class="chat-msg-bubble">' + bubbleHtml + '</div>';
      chatMessages.appendChild(el);
      chatMessages.scrollTop = chatMessages.scrollHeight;
    }

    chatForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var content = chatInput.value.trim();
      if (!content) return;
      socket.emit('chat:send', { content: content, sourceLang: sourceLang, targetLang: targetLang });
      chatInput.value = '';
    });

    container.querySelector('#toggle-audio').addEventListener('click', function () {
      audioOn = !audioOn;
      localStream.getAudioTracks().forEach(function (t) { t.enabled = audioOn; });
      this.classList.toggle('off', !audioOn);
      this.innerHTML = '<i class="fa-solid ' + (audioOn ? 'fa-microphone' : 'fa-microphone-slash') + '"></i>';
      socket.emit('media:state', { audio: audioOn, video: videoOn });
    });

    container.querySelector('#toggle-video').addEventListener('click', function () {
      videoOn = !videoOn;
      localStream.getVideoTracks().forEach(function (t) { t.enabled = videoOn; });
      this.classList.toggle('off', !videoOn);
      this.innerHTML = '<i class="fa-solid ' + (videoOn ? 'fa-video' : 'fa-video-slash') + '"></i>';
      socket.emit('media:state', { audio: audioOn, video: videoOn });
    });

    async function leaveRoom() {
      if (ended) return;
      ended = true;
      try {
        var roomData = await window.API.get('api/rooms/' + roomCode);
        if (roomData) await window.API.post('api/rooms/' + roomData.id + '/end', {});
      } catch (e) {}
      cleanup();
      window.Router.navigate('dashboard');
    }

    container.querySelector('#leave-btn').addEventListener('click', leaveRoom);

    function cleanup() {
      Object.keys(peers).forEach(function (sid) { try { peers[sid].pc.close(); } catch (e) {} });
      peers = {};
      if (localStream) { localStream.getTracks().forEach(function (t) { t.stop(); }); }
      if (socket) { try { socket.disconnect(); } catch (e) {} }
    }

    return cleanup;
  }

  window.Router.register('room', render);
})();
