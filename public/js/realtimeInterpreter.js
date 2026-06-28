'use strict';

/**
 * RealtimeInterpreter
 * -------------------
 * Live simultaneous interpreter powered by OpenAI Realtime (WebRTC).
 *
 * Concept:
 *   - Each local user opens ONE Realtime session whose system instruction
 *     is "translate everything you hear into <my native language>".
 *   - We feed it ALL incoming peer audio (mixed) — never the local mic,
 *     because I already understand what I say.
 *   - The model streams back translated speech, played to my speakers,
 *     plus partial / final transcripts for on-screen captions.
 *
 * Resilience:
 *   - The connection is supervised. If ICE fails, the peer connection
 *     drops, the data channel closes unexpectedly, the network goes
 *     offline, or the watchdog times out, the session is rebuilt
 *     automatically with exponential backoff. Peer audio sources are
 *     re-wired into the new mixer transparently.
 *   - A manual `stop()` disables auto-reconnect; nothing else does.
 *
 * Public API:
 *
 *   const it = new RealtimeInterpreter({
 *     basePath: window.__APP_BASE__ || '',
 *     onCaption: ({speaker, text, final, lang}) => { ... },
 *     onStatus:  (state) => { ... },
 *       // states: 'idle' | 'connecting' | 'live' | 'reconnecting'
 *       //       | 'error' | 'closed'
 *     onError:   (err) => { ... }
 *   });
 *
 *   await it.start();                  // mint token + open peer connection
 *   it.addPeerAudio(stream, peerLabel);// feed remote audio stream
 *   it.removePeerAudio(peerLabel);
 *   it.stop();                         // user-initiated stop, no reconnect
 */

(function (global) {
  function rel(base, path) {
    if (!base) return path;
    if (base.endsWith('/') && path.startsWith('/')) return base + path.slice(1);
    if (!base.endsWith('/') && !path.startsWith('/')) return base + '/' + path;
    return base + path;
  }

  function fetchJSON(url, opts) {
    opts = opts || {};
    opts.headers = Object.assign(
      { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      opts.headers || {}
    );
    const token = (function () {
      try { return localStorage.getItem('token'); } catch (_) { return null; }
    })();
    if (token) opts.headers['Authorization'] = 'Bearer ' + token;
    opts.credentials = 'include';
    return fetch(url, opts).then(async (r) => {
      const text = await r.text();
      let data = null;
      try { data = text ? JSON.parse(text) : null; } catch (_) { data = { raw: text }; }
      if (!r.ok) {
        try {
          console.error('[interpreter] backend error', r.status, 'body=', JSON.stringify(data, null, 2));
        } catch (_) {
          console.error('[interpreter] backend error', r.status, data);
        }
        const msg = (data && (data.message || data.error)) || ('HTTP ' + r.status);
        const detailMsg = data && data.details
          ? (data.details.message || data.details.code || JSON.stringify(data.details))
          : '';
        const err = new Error(msg + (detailMsg ? ' — ' + detailMsg : ''));
        err.status = r.status;
        err.body = data;
        throw err;
      }
      return data;
    });
  }

  // Backoff schedule for auto-reconnect (ms). First attempt is IMMEDIATE
  // (0ms) so the user perceives no interruption. Only if successive attempts
  // fail do we start backing off. After the last entry, it stays at the last
  // value (30s) forever — we never give up while the user has the meeting open.
  const RECONNECT_BACKOFF_MS = [0, 250, 1000, 2000, 4000, 8000, 16000, 30000];

  // Watchdog: how often we sanity-check the connection state.
  const WATCHDOG_INTERVAL_MS = 2000;
  // If the connection has been NOT 'connected' for this long while supposed
  // to be 'live', the watchdog forces a reconnect. Kept short so users
  // don't sit on a dead session for more than ~3s.
  const WATCHDOG_DOWN_GRACE_MS = 3000;

  class RealtimeInterpreter {
    constructor(opts) {
      opts = opts || {};
      this.basePath  = opts.basePath || '';
      this.onCaption = opts.onCaption || function () {};
      this.onStatus  = opts.onStatus  || function () {};
      this.onError   = opts.onError   || function () {};
      this.nativeLang = opts.nativeLang || null;

      this.pc = null;
      this.dc = null;
      this.audioEl = null;
      this.mixerCtx = null;
      this.mixerDest = null;
      // label -> { stream, srcNode }
      // srcNode is recreated on every reconnect from the (still-valid) stream.
      this.peerSources = new Map();
      this.state = 'idle';
      this.session = null;
      this._transcripts = new Map();

      // ---- Reconnection bookkeeping ----
      this._userStopped = false;       // true after stop() — disables reconnect
      this._reconnectAttempt = 0;      // counter for backoff
      this._reconnectTimer = null;     // setTimeout handle for next attempt
      this._reconnecting = false;      // a connect cycle is in flight
      this._watchdogTimer = null;
      this._lastConnectedAt = 0;       // ms timestamp of last 'connected' state
      this._downSince = 0;             // ms timestamp when we first noticed down
      this._listenersBound = false;
      this._onOnline = null;
      this._onVisibility = null;
    }

    _setState(s) {
      if (this.state === s) return;
      this.state = s;
      try { this.onStatus(s); } catch (_) {}
    }

    // ─────────────────────────────────────────────────────────────
    //  Public lifecycle
    // ─────────────────────────────────────────────────────────────

    async start() {
      this._userStopped = false;
      this._bindGlobalListeners();
      this._startWatchdog();
      return this._connect({ initial: true });
    }

    stop() {
      // Mark as user-stopped FIRST so any in-flight cycle won't reschedule.
      this._userStopped = true;
      this._cancelReconnect();
      this._stopWatchdog();
      this._unbindGlobalListeners();
      this._teardown({ keepPeerStreams: false });
      this._setState('closed');
    }

    // ─────────────────────────────────────────────────────────────
    //  Connect / reconnect
    // ─────────────────────────────────────────────────────────────

    async _connect(opts) {
      opts = opts || {};
      if (this._userStopped) return;
      if (this._reconnecting) return; // already trying
      if (this.state === 'live' && opts.initial) return;

      this._reconnecting = true;
      // Tear down any leftover PC/dc from a previous attempt, but KEEP
      // peerSources so we can re-wire streams into the new mixer.
      this._teardown({ keepPeerStreams: true });

      this._setState(opts.initial ? 'connecting' : 'reconnecting');

      try {
        // 1) Mint ephemeral token  (cache-busted)
        const url = rel(this.basePath, 'api/realtime/session') + '?t=' + Date.now();
        const body = this.nativeLang ? { nativeLang: this.nativeLang } : {};
        const sess = await fetchJSON(url, {
          method: 'POST',
          cache: 'no-store',
          headers: { 'Cache-Control': 'no-cache', 'Pragma': 'no-cache' },
          body: JSON.stringify(body)
        });
        console.log('[interpreter] backend session response:', JSON.stringify({
          model: sess && sess.model,
          voice: sess && sess.voice,
          nativeLang: sess && sess.nativeLang,
          hasSecret: !!(sess && sess.client_secret)
        }));
        this.session = sess;

        // 2) ICE config
        let iceConfig = {
          iceServers: [
            { urls: ['stun:stun.l.google.com:19302'] },
            { urls: ['stun:stun1.l.google.com:19302'] }
          ],
          iceTransportPolicy: 'all'
        };
        try {
          const iceUrl = rel(this.basePath, 'api/realtime/ice-servers') + '?t=' + Date.now();
          const iceData = await fetchJSON(iceUrl, { method: 'GET' });
          if (iceData && Array.isArray(iceData.iceServers) && iceData.iceServers.length) {
            iceConfig.iceServers = iceData.iceServers;
          }
          if (iceData && iceData.ice_transport_policy) {
            iceConfig.iceTransportPolicy = iceData.ice_transport_policy;
          }
          console.log('[interpreter] ICE config — has_turn=' + (iceData && iceData.has_turn) +
                      ' policy=' + iceConfig.iceTransportPolicy +
                      ' servers=' + iceConfig.iceServers.length);
          if (!iceData || !iceData.has_turn) {
            console.warn('[interpreter] No TURN server configured. ' +
              'If users are behind strict NATs (corporate, symmetric, mobile), ' +
              'ICE will fail. Set TURN_URL / TURN_USERNAME / TURN_CREDENTIAL ' +
              'in the service env to fix this.');
          }
        } catch (e) {
          console.warn('[interpreter] /ice-servers fetch failed, using default STUN:', e && e.message);
        }

        if (this._userStopped) { this._reconnecting = false; return; }

        const pc = new RTCPeerConnection(iceConfig);
        this.pc = pc;

        pc.onicecandidate = (ev) => {
          if (ev && ev.candidate) {
            const c = ev.candidate;
            const type = (c.candidate.match(/typ\s+(\S+)/) || [])[1] || '?';
            console.log('[interpreter] ICE candidate type=' + type +
                        ' proto=' + (c.protocol || '?') +
                        ' addr=' + (c.address || '?'));
          } else {
            console.log('[interpreter] ICE gathering complete');
          }
        };

        pc.oniceconnectionstatechange = () => {
          const st = pc.iceConnectionState;
          console.log('[interpreter] iceConnectionState=' + st);
          if (st === 'failed') {
            console.warn('[interpreter] ICE failed — reconnecting immediately');
            this._scheduleReconnect('ice-failed');
          } else if (st === 'disconnected') {
            console.warn('[interpreter] ICE disconnected — reconnecting immediately');
            // Don't wait for the watchdog grace period; trigger reconnect now.
            // If the browser self-recovers before our reconnect lands, the
            // new session simply replaces the old one.
            this._scheduleReconnect('ice-disconnected');
          }
        };
        pc.onconnectionstatechange = () => {
          const cs = pc.connectionState;
          console.log('[interpreter] connectionState=' + cs);
          if (cs === 'connected') {
            this._lastConnectedAt = Date.now();
            this._downSince = 0;
            this._reconnectAttempt = 0;
            this._setState('live');
          } else if (cs === 'failed' || cs === 'closed') {
            this._scheduleReconnect('connection-' + cs);
          } else if (cs === 'disconnected') {
            if (!this._downSince) this._downSince = Date.now();
            // Trigger an immediate reconnect attempt — don't wait for the
            // watchdog grace period.
            this._scheduleReconnect('connection-disconnected');
          }
        };

        // 2a) Output audio sink
        const audioEl = document.createElement('audio');
        audioEl.autoplay = true;
        audioEl.setAttribute('playsinline', '');
        audioEl.style.display = 'none';
        document.body.appendChild(audioEl);
        this.audioEl = audioEl;
        pc.ontrack = (ev) => {
          if (ev.streams && ev.streams[0]) {
            audioEl.srcObject = ev.streams[0];
          }
        };

        // 2b) Input audio mixer
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        const ctx = new AudioCtx();
        const dest = ctx.createMediaStreamDestination();
        this.mixerCtx = ctx;
        this.mixerDest = dest;
        const mixedTrack = dest.stream.getAudioTracks()[0];
        if (mixedTrack) {
          pc.addTrack(mixedTrack, dest.stream);
        } else {
          const silent = ctx.createOscillator();
          const gain = ctx.createGain();
          gain.gain.value = 0;
          silent.connect(gain).connect(dest);
          silent.start();
          pc.addTrack(dest.stream.getAudioTracks()[0], dest.stream);
        }

        // 2c) Re-wire any peer streams that were registered before / during
        //     a previous session into the new mixer.
        this._rewirePeerSources();

        // 2d) Data channel
        const dc = pc.createDataChannel('oai-events');
        this.dc = dc;
        dc.onopen = () => {
          console.log('[interpreter] data channel open');
        };
        dc.onclose = () => {
          console.warn('[interpreter] data channel closed');
          // If we're still supposed to be live, treat this as a drop.
          if (!this._userStopped && (this.state === 'live' || this.state === 'reconnecting')) {
            this._scheduleReconnect('dc-closed');
          }
        };
        dc.onerror = (e) => {
          console.warn('[interpreter] data channel error', e);
        };
        dc.onmessage = (ev) => this._handleEvent(ev.data);

        // 3) SDP negotiation
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);

        const modelName = sess.model || 'gpt-realtime-translate';
        const sdpPath = sess.sdp_path ||
          (/translate/i.test(modelName)
            ? '/v1/realtime/translations/calls'
            : '/v1/realtime/calls');
        const sdpUrl = 'https://api.openai.com' + sdpPath + '?model=' +
                       encodeURIComponent(modelName);
        console.log('[interpreter] session received, model=' + modelName +
                    ' nativeLang=' + (sess.nativeLang || '?') +
                    ' -> SDP url=' + sdpUrl);
        const sdpResp = await fetch(sdpUrl, {
          method: 'POST',
          headers: {
            'Authorization': 'Bearer ' + sess.client_secret,
            'Content-Type': 'application/sdp'
          },
          body: offer.sdp
        });
        if (!sdpResp.ok) {
          const t = await sdpResp.text();
          throw new Error('OpenAI SDP exchange failed: ' + sdpResp.status + ' ' + t.slice(0, 200));
        }
        const answerSdp = await sdpResp.text();
        if (this._userStopped) { this._reconnecting = false; return; }
        await pc.setRemoteDescription({ type: 'answer', sdp: answerSdp });

        // Don't set 'live' here — wait for connectionState='connected'
        // (handled in onconnectionstatechange). That avoids the false-positive
        // "live" before ICE actually completes.
        this._reconnecting = false;
      } catch (err) {
        this._reconnecting = false;
        console.error('[interpreter] connect failed:', err && err.message);
        // Surface error to UI only on the very first try; on subsequent
        // reconnect attempts, stay quiet to avoid spamming toasts.
        if (this._reconnectAttempt === 0) {
          try { this.onError(err); } catch (_) {}
        }
        if (this._userStopped) {
          this._setState('error');
          return;
        }
        this._scheduleReconnect('connect-threw');
      }
    }

    _scheduleReconnect(reason) {
      if (this._userStopped) return;
      if (this._reconnectTimer) return; // already scheduled
      if (this._reconnecting) return;   // in-flight attempt

      const idx = Math.min(this._reconnectAttempt, RECONNECT_BACKOFF_MS.length - 1);
      const delay = RECONNECT_BACKOFF_MS[idx];
      this._reconnectAttempt += 1;
      console.warn('[interpreter] scheduling reconnect (reason=' + reason +
                   ') attempt=' + this._reconnectAttempt + ' in ' + delay + 'ms');

      // Stop sending audio meanwhile so the local mixer doesn't pile up.
      this._teardown({ keepPeerStreams: true });
      this._setState('reconnecting');

      if (delay <= 0) {
        // Immediate reconnect — microtask, no timer delay.
        this._reconnectTimer = null;
        Promise.resolve().then(() => {
          if (this._userStopped) return;
          this._connect({ initial: false }).catch(() => { /* already handled */ });
        });
      } else {
        this._reconnectTimer = setTimeout(() => {
          this._reconnectTimer = null;
          if (this._userStopped) return;
          this._connect({ initial: false }).catch(() => { /* already handled */ });
        }, delay);
      }
    }

    _cancelReconnect() {
      if (this._reconnectTimer) {
        clearTimeout(this._reconnectTimer);
        this._reconnectTimer = null;
      }
      this._reconnectAttempt = 0;
    }

    // ─────────────────────────────────────────────────────────────
    //  Watchdog
    // ─────────────────────────────────────────────────────────────

    _startWatchdog() {
      this._stopWatchdog();
      this._watchdogTimer = setInterval(() => {
        if (this._userStopped) return;
        if (this._reconnecting) return;
        if (this._reconnectTimer) return;

        const pc = this.pc;
        const cs = pc ? pc.connectionState : 'none';

        // If we don't have a PC at all and we're not connecting, something
        // is wrong — kick a reconnect.
        if (!pc && this.state !== 'closed' && this.state !== 'idle') {
          console.warn('[interpreter] watchdog: no PC but state=' + this.state + ', reconnecting');
          this._scheduleReconnect('watchdog-no-pc');
          return;
        }

        if (pc && cs !== 'connected' && cs !== 'connecting' && cs !== 'new') {
          // Track how long we've been not-connected.
          if (!this._downSince) this._downSince = Date.now();
          const downFor = Date.now() - this._downSince;
          if (downFor > WATCHDOG_DOWN_GRACE_MS) {
            console.warn('[interpreter] watchdog: down for ' + downFor + 'ms (cs=' + cs + '), reconnecting');
            this._scheduleReconnect('watchdog-down');
          }
        } else if (pc && cs === 'connected') {
          this._downSince = 0;
        }
      }, WATCHDOG_INTERVAL_MS);
    }

    _stopWatchdog() {
      if (this._watchdogTimer) {
        clearInterval(this._watchdogTimer);
        this._watchdogTimer = null;
      }
    }

    // ─────────────────────────────────────────────────────────────
    //  Global listeners (network / visibility)
    // ─────────────────────────────────────────────────────────────

    _bindGlobalListeners() {
      if (this._listenersBound) return;
      this._listenersBound = true;

      this._onOnline = () => {
        if (this._userStopped) return;
        console.log('[interpreter] network online — reconnecting immediately');
        const cs = this.pc ? this.pc.connectionState : 'none';
        if (cs !== 'connected') {
          // Cancel any pending backoff, reset attempt counter, and try NOW.
          this._cancelReconnect();
          this._reconnectAttempt = 0;
          this._connect({ initial: false }).catch(() => {});
        }
      };
      this._onVisibility = () => {
        if (this._userStopped) return;
        if (document.visibilityState !== 'visible') return;
        const cs = this.pc ? this.pc.connectionState : 'none';
        if (cs !== 'connected' && !this._reconnecting && !this._reconnectTimer) {
          console.log('[interpreter] tab visible — reconnecting immediately');
          this._cancelReconnect();
          this._reconnectAttempt = 0;
          this._connect({ initial: false }).catch(() => {});
        }
      };

      try { window.addEventListener('online', this._onOnline); } catch (_) {}
      try { document.addEventListener('visibilitychange', this._onVisibility); } catch (_) {}
    }

    _unbindGlobalListeners() {
      if (!this._listenersBound) return;
      try { window.removeEventListener('online', this._onOnline); } catch (_) {}
      try { document.removeEventListener('visibilitychange', this._onVisibility); } catch (_) {}
      this._onOnline = null;
      this._onVisibility = null;
      this._listenersBound = false;
    }

    // ─────────────────────────────────────────────────────────────
    //  Teardown (internal — does NOT change _userStopped)
    // ─────────────────────────────────────────────────────────────

    _teardown(opts) {
      opts = opts || {};
      const keepPeerStreams = !!opts.keepPeerStreams;

      // Disconnect source nodes from the old mixer but KEEP the underlying
      // streams when keepPeerStreams=true, so we can re-wire on reconnect.
      this.peerSources.forEach((entry) => {
        try { if (entry.srcNode) entry.srcNode.disconnect(); } catch (_) {}
        entry.srcNode = null;
      });
      if (!keepPeerStreams) {
        this.peerSources.clear();
      }

      try { if (this.dc) this.dc.close(); } catch (_) {}
      try { if (this.pc) this.pc.close(); } catch (_) {}
      try { if (this.mixerCtx) this.mixerCtx.close(); } catch (_) {}
      if (this.audioEl && this.audioEl.parentNode) {
        try { this.audioEl.srcObject = null; } catch (_) {}
        try { this.audioEl.parentNode.removeChild(this.audioEl); } catch (_) {}
      }
      this.pc = null;
      this.dc = null;
      this.mixerCtx = null;
      this.mixerDest = null;
      this.audioEl = null;
      this._transcripts.clear();
    }

    _rewirePeerSources() {
      if (!this.mixerCtx || !this.mixerDest) return;
      this.peerSources.forEach((entry, label) => {
        if (!entry.stream) return;
        try {
          // Drop any stale node first.
          try { if (entry.srcNode) entry.srcNode.disconnect(); } catch (_) {}
          const src = this.mixerCtx.createMediaStreamSource(entry.stream);
          src.connect(this.mixerDest);
          entry.srcNode = src;
          console.log('[interpreter] rewired peer source ' + label);
        } catch (e) {
          console.warn('[interpreter] rewire failed for ' + label, e);
        }
      });
    }

    // ─────────────────────────────────────────────────────────────
    //  Peer audio API
    // ─────────────────────────────────────────────────────────────

    addPeerAudio(stream, label) {
      label = label || ('peer_' + Math.random().toString(36).slice(2, 8));
      if (!stream) return label;

      // Diagnostic log — track ids should be the REMOTE peer's track ids,
      // not anything from the local microphone.
      try {
        const tids = stream.getAudioTracks().map(t => t.id + '(label=' + (t.label || '?') + ')');
        console.log('[interpreter] addPeerAudio label=' + label +
                    ' audioTracks=' + stream.getAudioTracks().length +
                    ' ids=[' + tids.join(', ') + ']');
      } catch (_) {}

      // Remove existing entry of same label (if any) — but keep the new stream.
      const existing = this.peerSources.get(label);
      if (existing) {
        try { if (existing.srcNode) existing.srcNode.disconnect(); } catch (_) {}
        this.peerSources.delete(label);
      }

      if (!this.mixerCtx || !this.mixerDest) {
        // Defer: stash and wire in on next successful connect.
        this.peerSources.set(label, { stream, srcNode: null });
        return label;
      }
      try {
        const src = this.mixerCtx.createMediaStreamSource(stream);
        src.connect(this.mixerDest);
        this.peerSources.set(label, { stream, srcNode: src });
        console.log('[interpreter] mixer wired for ' + label +
                    ' — sources in mixer now=' + this.peerSources.size);
      } catch (e) {
        console.warn('[Interpreter] addPeerAudio failed', e);
        // Still record the stream so it can be wired on reconnect.
        this.peerSources.set(label, { stream, srcNode: null });
      }
      return label;
    }

    removePeerAudio(label) {
      const entry = this.peerSources.get(label);
      if (!entry) return;
      try { if (entry.srcNode) entry.srcNode.disconnect(); } catch (_) {}
      this.peerSources.delete(label);
    }

    // ─────────────────────────────────────────────────────────────
    //  Event handling
    // ─────────────────────────────────────────────────────────────

    _handleEvent(raw) {
      let ev = null;
      try { ev = typeof raw === 'string' ? JSON.parse(raw) : raw; }
      catch (_) { return; }
      if (!ev || !ev.type) return;

      switch (ev.type) {
        case 'conversation.item.input_audio_transcription.delta': {
          const id = ev.item_id || 'in';
          const cur = this._transcripts.get(id) || { text: '', kind: 'in' };
          cur.text += (ev.delta || '');
          this._transcripts.set(id, cur);
          this.onCaption({ speaker: 'peer', text: cur.text, final: false, kind: 'source' });
          break;
        }
        case 'conversation.item.input_audio_transcription.completed': {
          const id = ev.item_id || 'in';
          const text = ev.transcript || (this._transcripts.get(id) || {}).text || '';
          this._transcripts.delete(id);
          this.onCaption({ speaker: 'peer', text, final: true, kind: 'source' });
          break;
        }
        case 'response.audio_transcript.delta': {
          const id = ev.response_id || 'out';
          const cur = this._transcripts.get(id) || { text: '', kind: 'out' };
          cur.text += (ev.delta || '');
          this._transcripts.set(id, cur);
          this.onCaption({ speaker: 'me', text: cur.text, final: false, kind: 'translation' });
          break;
        }
        case 'response.audio_transcript.done': {
          const id = ev.response_id || 'out';
          const text = ev.transcript || (this._transcripts.get(id) || {}).text || '';
          this._transcripts.delete(id);
          this.onCaption({ speaker: 'me', text, final: true, kind: 'translation' });
          break;
        }
        case 'error': {
          const msg = (ev.error && (ev.error.message || ev.error.code)) || 'Realtime error';
          console.warn('[interpreter] server error event:', msg);
          // Don't tear down on every server error — only surface it.
          try { this.onError(new Error(msg)); } catch (_) {}
          break;
        }
        default:
          break;
      }
    }
  }

  global.RealtimeInterpreter = RealtimeInterpreter;
})(window);
