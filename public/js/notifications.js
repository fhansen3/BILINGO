(function () {
  'use strict';

  // Global notifications module:
  // - Maintains a single socket.io connection for the logged-in user.
  // - Listens for `invite:incoming`, `invite:pending`, `invite:cancelled`,
  //   `invite:response` and renders an interactive popup.
  // - Survives across SPA route changes (does NOT live inside a view).
  //
  // Public API:
  //   window.Notifications.start()  → call after successful login
  //   window.Notifications.stop()   → call on logout
  //   window.Notifications.getSocket() → returns the shared socket (or null)

  var socket = null;
  var shownInvites = {}; // invitationId -> DOM node

  function ensureContainer() {
    var c = document.getElementById('invite-popups');
    if (c) return c;
    c = document.createElement('div');
    c.id = 'invite-popups';
    c.style.cssText =
      'position:fixed; top:80px; right:20px; z-index:9999;' +
      'display:flex; flex-direction:column; gap:12px; max-width:360px;';
    document.body.appendChild(c);
    return c;
  }

  function avatarLetter(name) {
    return ((name || '?').trim().charAt(0) || '?').toUpperCase();
  }

  function escapeHtml(s) {
    return window.UI && window.UI.escapeHtml ? window.UI.escapeHtml(s) : String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function dismiss(invitationId) {
    var node = shownInvites[invitationId];
    if (node) {
      node.style.transition = 'opacity .25s, transform .25s';
      node.style.opacity = '0';
      node.style.transform = 'translateX(20px)';
      setTimeout(function () { node.remove(); }, 250);
      delete shownInvites[invitationId];
    }
  }

  function renderInvite(payload) {
    var id = payload.invitationId;
    if (!id || shownInvites[id]) return;
    var container = ensureContainer();

    var inviterName = (payload.inviter && payload.inviter.name) || 'Alguien';
    var avatarColor = (payload.inviter && payload.inviter.avatarColor) || '#58CC02';
    var topic = payload.topic || 'Reunión sin título';
    var msg  = payload.message || '';

    var node = document.createElement('div');
    node.className = 'invite-popup card-bl';
    node.style.cssText =
      'background:#fff; border:1px solid var(--border, #e5e7eb); border-left:4px solid #58CC02;' +
      'border-radius:12px; padding:14px 16px; box-shadow:0 8px 24px rgba(0,0,0,0.12);' +
      'animation: invite-slide-in .25s ease-out;';
    node.innerHTML =
      '<div style="display:flex; align-items:center; gap:10px; margin-bottom:10px;">' +
        '<div style="width:36px; height:36px; border-radius:50%; background:' + escapeHtml(avatarColor) +
        '; color:#fff; display:flex; align-items:center; justify-content:center; font-weight:700;">' +
        escapeHtml(avatarLetter(inviterName)) + '</div>' +
        '<div style="flex:1; min-width:0;">' +
          '<div style="font-weight:700; font-size:.95rem;">' + escapeHtml(inviterName) + '</div>' +
          '<div style="font-size:.8rem; color:#6b7280;">te invita a una reunión</div>' +
        '</div>' +
        '<button data-act="close" title="Cerrar" style="background:none; border:none; color:#9ca3af; cursor:pointer; font-size:1rem;"><i class="fa-solid fa-xmark"></i></button>' +
      '</div>' +
      '<div style="font-size:.88rem; color:#374151; margin-bottom:8px;">' +
        '<i class="fa-solid fa-video" style="color:#58CC02; margin-right:6px;"></i>' +
        '<strong>' + escapeHtml(topic) + '</strong>' +
        ' · Sala <code style="background:#f3f4f6; padding:1px 6px; border-radius:4px;">' + escapeHtml(payload.roomCode) + '</code>' +
      '</div>' +
      (msg ? '<div style="font-size:.85rem; color:#4b5563; font-style:italic; margin-bottom:10px;">"' + escapeHtml(msg) + '"</div>' : '') +
      '<div style="display:flex; gap:8px; margin-top:10px;">' +
        '<button class="btn-bl btn-green btn-sm" data-act="accept" style="flex:1;"><i class="fa-solid fa-check"></i> Unirme</button>' +
        '<button class="btn-bl btn-outline btn-sm" data-act="decline" style="flex:1;"><i class="fa-solid fa-xmark"></i> Rechazar</button>' +
      '</div>';

    node.addEventListener('click', async function (e) {
      var btn = e.target.closest('[data-act]');
      if (!btn) return;
      var act = btn.getAttribute('data-act');
      if (act === 'close') {
        dismiss(id);
        return;
      }
      btn.disabled = true;
      try {
        if (act === 'accept') {
          await window.API.post('api/invitations/' + id + '/accept', {});
          dismiss(id);
          window.Router && window.Router.navigate('room/' + payload.roomCode);
        } else if (act === 'decline') {
          await window.API.post('api/invitations/' + id + '/decline', {});
          dismiss(id);
          window.UI.notify('Invitación rechazada', 'info');
        }
      } catch (err) {
        window.UI.notify(err.message || 'Error', 'error');
        btn.disabled = false;
      }
    });

    shownInvites[id] = node;
    container.appendChild(node);

    // Optional sound: tiny beep using WebAudio (no asset needed).
    try { playBeep(); } catch (e) {}
  }

  function playBeep() {
    if (!window.AudioContext && !window.webkitAudioContext) return;
    var Ctx = window.AudioContext || window.webkitAudioContext;
    var ctx = new Ctx();
    var o = ctx.createOscillator();
    var g = ctx.createGain();
    o.connect(g); g.connect(ctx.destination);
    o.frequency.value = 880;
    g.gain.value = 0.04;
    o.start();
    setTimeout(function () {
      o.frequency.value = 1320;
      setTimeout(function () { o.stop(); ctx.close(); }, 90);
    }, 90);
  }

  function start() {
    if (socket && socket.connected) return socket;
    if (socket) {
      try { socket.connect(); } catch (e) {}
      return socket;
    }
    if (!window.io) {
      console.warn('[Notifications] socket.io not loaded');
      return null;
    }
    // Socket.IO connection strategy under reverse proxy:
    //
    // The reverse proxy serves the app at a prefixed URL like
    // /project-<userHash>/<projectHash>/  or  /run/<projectId>/
    // but strips that prefix before forwarding to our backend. Our backend's
    // Socket.IO is mounted at the default path "/socket.io" (no prefix).
    //
    // Client-side, we must:
    //   - Connect to the SAME ORIGIN (pass undefined as server URL).
    //   - Build an ABSOLUTE URL for the socket request that INCLUDES the
    //     proxy prefix, so the browser actually hits the proxy at the
    //     correct public path. socket.io-client treats `path` as an
    //     absolute path on the current origin, so we must include the
    //     prefix here (the proxy strips it before forwarding).
    //
    // Resolve the proxy prefix from <base href> (e.g. "/project-abc/xyz/").
    var baseHref = '';
    var baseEl = document.querySelector('base');
    if (baseEl) baseHref = baseEl.getAttribute('href') || '';
    // Normalize: ensure leading slash, strip trailing slash. Empty stays empty.
    if (baseHref && baseHref !== '/') {
      if (baseHref.charAt(0) !== '/') baseHref = '/' + baseHref;
      baseHref = baseHref.replace(/\/$/, '');
    } else {
      baseHref = '';
    }
    var socketPath = baseHref + '/socket.io';

    // The PUBLIC proxy (/project-<userHash>/<projectHash>/) does NOT support
    // the HTTP→WebSocket upgrade for socket.io: the initial polling handshake
    // succeeds, but the WS upgrade is refused (NS_ERROR_WEBSOCKET_CONNECTION_REFUSED)
    // and the subsequent long-polling returns 502. Detect that case and stay
    // on long-polling, which the proxy handles cleanly over plain HTTP.
    //
    // The INTERNAL proxy (/run/<projectId>/) DOES support WebSocket, so we
    // keep the upgrade enabled there for lower latency.
    var isPublicProxy = /^\/project-/.test(baseHref);
    var transports = isPublicProxy ? ['polling'] : ['polling', 'websocket'];
    var upgrade = !isPublicProxy;
    console.log('[Notifications] connecting socket.io path=' + socketPath +
      ' origin=' + window.location.origin +
      ' transports=' + transports.join(',') + ' upgrade=' + upgrade);

    socket = window.io(undefined, {
      withCredentials: true,
      transports: transports,
      upgrade: upgrade,
      path: socketPath,
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      timeout: 20000
    });

    socket.on('connect', function () {
      console.log('[Notifications] socket connected', socket.id);
    });

    socket.on('connect_error', function (err) {
      console.warn('[Notifications] socket error', err && err.message);
    });

    socket.on('disconnect', function (reason) {
      console.log('[Notifications] socket disconnected:', reason);
    });

    socket.on('invite:incoming', function (payload) {
      renderInvite(payload);
    });

    socket.on('invite:pending', function (list) {
      (list || []).forEach(renderInvite);
    });

    socket.on('invite:cancelled', function (payload) {
      dismiss(payload && payload.invitationId);
      window.UI && window.UI.notify('Una invitación fue cancelada', 'info');
    });

    socket.on('invite:response', function (payload) {
      var who = payload.inviteeName || 'El usuario';
      if (payload.status === 'accepted') {
        window.UI && window.UI.notify(who + ' aceptó tu invitación', 'success');
      } else if (payload.status === 'declined') {
        window.UI && window.UI.notify(who + ' rechazó tu invitación', 'warn');
      }
    });

    return socket;
  }

  function stop() {
    if (socket) {
      try { socket.disconnect(); } catch (e) {}
      socket = null;
    }
    Object.keys(shownInvites).forEach(dismiss);
  }

  function getSocket() { return socket; }

  // Inject keyframes for slide-in animation.
  (function injectStyles() {
    if (document.getElementById('invite-popup-styles')) return;
    var st = document.createElement('style');
    st.id = 'invite-popup-styles';
    st.textContent =
      '@keyframes invite-slide-in { from { opacity: 0; transform: translateX(20px); } to { opacity: 1; transform: translateX(0); } }' +
      '.invite-popup .btn-bl { padding: 6px 10px; font-size: .85rem; }';
    document.head.appendChild(st);
  })();

  window.Notifications = { start: start, stop: stop, getSocket: getSocket };
})();
