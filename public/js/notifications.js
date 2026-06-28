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
  //   window.Notifications.getSocket() => returns the shared socket (or null)

  var socket = null;
  var shownInvites = {}; // invitationId -> { node, ringStop }
  var backdrop = null;

  function ensureBackdrop() {
    if (backdrop) return backdrop;
    backdrop = document.createElement('div');
    backdrop.id = 'invite-popups-backdrop';
    backdrop.style.cssText =
      'position:fixed; inset:0; z-index:9998;' +
      'background:rgba(15,23,42,0.55);' +
      'backdrop-filter: blur(2px);' +
      '-webkit-backdrop-filter: blur(2px);' +
      'display:none;' +
      'align-items:center; justify-content:center;' +
      'padding:20px;';
    document.body.appendChild(backdrop);

    var container = document.createElement('div');
    container.id = 'invite-popups';
    container.style.cssText =
      'display:flex; flex-direction:column; gap:14px;' +
      'width:100%; max-width:420px;' +
      'max-height:90vh; overflow-y:auto;';
    backdrop.appendChild(container);
    return backdrop;
  }

  function refreshBackdropVisibility() {
    if (!backdrop) return;
    var hasAny = Object.keys(shownInvites).length > 0;
    backdrop.style.display = hasAny ? 'flex' : 'none';
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
    var entry = shownInvites[invitationId];
    if (!entry) return;
    // Stop the ringing sound (and vibration) for this invite.
    try { entry.ringStop && entry.ringStop(); } catch (e) {}
    var node = entry.node;
    if (node) {
      node.style.transition = 'opacity .25s, transform .25s';
      node.style.opacity = '0';
      node.style.transform = 'scale(0.95)';
      setTimeout(function () {
        node.remove();
        refreshBackdropVisibility();
      }, 250);
    }
    delete shownInvites[invitationId];
    // If no more invites pending, stop any global vibration loop.
    if (!Object.keys(shownInvites).length) {
      try { navigator.vibrate && navigator.vibrate(0); } catch (e) {}
    }
  }

  function renderInvite(payload) {
    var id = payload.invitationId;
    if (!id || shownInvites[id]) return;
    var bd = ensureBackdrop();
    var container = bd.querySelector('#invite-popups');

    var inviterName = (payload.inviter && payload.inviter.name) || 'Alguien';
    var avatarColor = (payload.inviter && payload.inviter.avatarColor) || '#58CC02';
    var topic = payload.topic || 'Reunión sin título';
    var msg  = payload.message || '';

    var node = document.createElement('div');
    node.className = 'invite-popup card-bl';
    node.style.cssText =
      'background:#fff; border:1px solid var(--border, #e5e7eb); border-left:4px solid #58CC02;' +
      'border-radius:16px; padding:20px 22px;' +
      'box-shadow:0 20px 60px rgba(0,0,0,0.35), 0 0 0 1px rgba(255,255,255,0.05);' +
      'animation: invite-pop-in .3s cubic-bezier(.16,1,.3,1);' +
      'position:relative;';

    node.innerHTML =
      '<div style="display:flex; align-items:center; gap:8px; margin-bottom:14px; font-size:.78rem; color:#16a34a; font-weight:800; text-transform:uppercase; letter-spacing:.6px;">' +
        '<span class="invite-pulse-dot" style="display:inline-block; width:8px; height:8px; border-radius:50%; background:#16a34a;"></span>' +
        '<i class="fa-solid fa-phone-volume" style="font-size:.85rem;"></i>' +
        '<span>Invitación entrante</span>' +
      '</div>' +
      '<div style="display:flex; align-items:center; gap:14px; margin-bottom:14px;">' +
        '<div class="invite-avatar-ring" style="width:56px; height:56px; border-radius:50%; background:' + escapeHtml(avatarColor) +
        '; color:#fff; display:flex; align-items:center; justify-content:center; font-weight:800; font-size:1.4rem; flex-shrink:0;">' +
        escapeHtml(avatarLetter(inviterName)) + '</div>' +
        '<div style="flex:1; min-width:0;">' +
          '<div style="font-weight:800; font-size:1.05rem; color:#111827;">' + escapeHtml(inviterName) + '</div>' +
          '<div style="font-size:.85rem; color:#6b7280;">te invita a una reunión</div>' +
        '</div>' +
        '<button data-act="close" title="Cerrar" style="background:none; border:none; color:#9ca3af; cursor:pointer; font-size:1.1rem; padding:6px;"><i class="fa-solid fa-xmark"></i></button>' +
      '</div>' +
      '<div style="font-size:.9rem; color:#374151; margin-bottom:8px;">' +
        '<i class="fa-solid fa-video" style="color:#58CC02; margin-right:6px;"></i>' +
        '<strong>' + escapeHtml(topic) + '</strong>' +
        ' · Sala <code style="background:#f3f4f6; padding:1px 7px; border-radius:5px; font-size:.85em;">' + escapeHtml(payload.roomCode) + '</code>' +
      '</div>' +
      (msg ? '<div style="font-size:.88rem; color:#4b5563; font-style:italic; margin:10px 0 4px; padding:8px 12px; background:#f9fafb; border-radius:8px; border-left:3px solid #e5e7eb;">"' + escapeHtml(msg) + '"</div>' : '') +
      '<div style="display:flex; gap:10px; margin-top:16px;">' +
        '<button class="btn-bl btn-green" data-act="accept" style="flex:1;"><i class="fa-solid fa-check"></i> Unirme</button>' +
        '<button class="btn-bl btn-outline" data-act="decline" style="flex:1;"><i class="fa-solid fa-xmark"></i> Rechazar</button>' +
      '</div>';

    node.addEventListener('click', async function (e) {
      // Block clicks on the backdrop from dismissing the popup — user MUST
      // choose accept / decline / close explicitly.
      e.stopPropagation();
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

    // Prevent backdrop clicks from dismissing — user must act.
    bd.onclick = function (e) {
      if (e.target === bd) {
        // Optional UX: flash the popup so the user notices it. We do NOT
        // close on backdrop click because invitations require an explicit
        // accept/decline.
        node.style.animation = 'none';
        // force reflow so the animation can replay
        void node.offsetWidth;
        node.style.animation = 'invite-shake .4s ease';
      }
    };

    // Start ringing tone + vibration; capture the stop handle so dismiss()
    // can cut it off cleanly.
    var ringStop = startRingtone();
    shownInvites[id] = { node: node, ringStop: ringStop };
    container.appendChild(node);
    refreshBackdropVisibility();
  }

  // ─────────────────────────────────────────────────────────────────────
  // Ringtone — generated with WebAudio (no asset needed).
  // Plays a classic two-pulse ring pattern in a loop until stopped.
  // Returns a stop() function.
  // ─────────────────────────────────────────────────────────────────────
  function startRingtone() {
    var stopped = false;
    var ctx = null;
    var schedTimer = null;

    // Try to start audio. Browsers require a user gesture for AudioContext
    // on first use; if blocked, we silently skip the sound but still vibrate.
    try {
      var Ctx = window.AudioContext || window.webkitAudioContext;
      if (Ctx) {
        ctx = new Ctx();
        // If context is suspended (autoplay policy), try to resume; if it
        // fails, we just won't get sound — the visual popup is the primary
        // cue anyway.
        if (ctx.state === 'suspended') {
          ctx.resume().catch(function () {});
        }
      }
    } catch (e) {
      ctx = null;
    }

    // One "ring" = two short pulses (ding-dong style), then a gap.
    // Pattern length: ~3.2s total → repeats.
    function playRing() {
      if (stopped || !ctx) return;
      var now = ctx.currentTime;
      // Pulse 1: 880 Hz, 0.35s
      playTone(ctx, now,        0.35, 880);
      // Pulse 2: 660 Hz, 0.35s (immediately after)
      playTone(ctx, now + 0.4,  0.35, 660);
    }

    function playTone(ctx, startAt, dur, freq) {
      var osc = ctx.createOscillator();
      var gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      // Soft attack/release to avoid clicks.
      gain.gain.setValueAtTime(0.0001, startAt);
      gain.gain.exponentialRampToValueAtTime(0.18, startAt + 0.02);
      gain.gain.setValueAtTime(0.18, startAt + dur - 0.05);
      gain.gain.exponentialRampToValueAtTime(0.0001, startAt + dur);
      osc.connect(gain).connect(ctx.destination);
      osc.start(startAt);
      osc.stop(startAt + dur + 0.05);
    }

    // Loop: ring every ~2.6s. Up to ~30s safety cap so we never ring forever
    // if the user navigates away with an invite still open and the dismiss
    // isn't called for some reason.
    var loopsLeft = 12;
    function loop() {
      if (stopped) return;
      playRing();
      loopsLeft--;
      if (loopsLeft <= 0) return;
      schedTimer = setTimeout(loop, 2600);
    }
    loop();

    // Vibration (mobile). Pattern: [vibrate, pause, vibrate, pause, …]
    try {
      if (navigator.vibrate) {
        navigator.vibrate([300, 200, 300, 1800, 300, 200, 300, 1800, 300, 200, 300]);
      }
    } catch (e) {}

    return function stop() {
      stopped = true;
      if (schedTimer) { clearTimeout(schedTimer); schedTimer = null; }
      try { navigator.vibrate && navigator.vibrate(0); } catch (e) {}
      try {
        if (ctx && ctx.state !== 'closed') {
          // Give pending tones a beat to release, then close.
          setTimeout(function () { try { ctx.close(); } catch (e) {} }, 200);
        }
      } catch (e) {}
    };
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

  // Inject keyframes for animations + pulse on the green dot.
  (function injectStyles() {
    if (document.getElementById('invite-popup-styles')) return;
    var st = document.createElement('style');
    st.id = 'invite-popup-styles';
    st.textContent =
      '@keyframes invite-pop-in {' +
      '  from { opacity: 0; transform: scale(0.85) translateY(20px); }' +
      '  to   { opacity: 1; transform: scale(1) translateY(0); }' +
      '}' +
      '@keyframes invite-shake {' +
      '  0%, 100% { transform: translateX(0); }' +
      '  20% { transform: translateX(-8px); }' +
      '  40% { transform: translateX(8px); }' +
      '  60% { transform: translateX(-6px); }' +
      '  80% { transform: translateX(6px); }' +
      '}' +
      '@keyframes invite-pulse-dot {' +
      '  0%   { box-shadow: 0 0 0 0   rgba(22,163,74,0.6); }' +
      '  70%  { box-shadow: 0 0 0 10px rgba(22,163,74,0); }' +
      '  100% { box-shadow: 0 0 0 0   rgba(22,163,74,0); }' +
      '}' +
      '@keyframes invite-avatar-ring {' +
      '  0%   { box-shadow: 0 0 0 0   rgba(88,204,2,0.5); }' +
      '  70%  { box-shadow: 0 0 0 14px rgba(88,204,2,0); }' +
      '  100% { box-shadow: 0 0 0 0   rgba(88,204,2,0); }' +
      '}' +
      '.invite-popup .btn-bl { padding: 10px 14px; font-size: .9rem; }' +
      '.invite-pulse-dot { animation: invite-pulse-dot 1.4s ease-out infinite; }' +
      '.invite-avatar-ring { animation: invite-avatar-ring 1.8s ease-out infinite; }';
    document.head.appendChild(st);
  })();

  window.Notifications = { start: start, stop: stop, getSocket: getSocket };
})();
