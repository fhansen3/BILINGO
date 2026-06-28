'use strict';

/**
 * BiLingo Realtime — OpenAI speech-to-speech translator.
 *
 * One instance per local user. When started, it:
 *   1. Asks the backend for an ephemeral key (`ek_…`) bound to the user's
 *      native language. The backend's system prompt tells the model to act
 *      as a simultaneous interpreter INTO that native language.
 *   2. Captures the local microphone.
 *   3. Opens an RTCPeerConnection directly to api.openai.com/v1/realtime
 *      (no Node hop for the audio — direct browser ↔ OpenAI WebRTC).
 *   4. Plays the translated audio out of an invisible <audio> sink.
 *   5. Streams BOTH transcripts (original + translated) over a DataChannel
 *      and re-emits them as `caption` events on the meeting's Socket.IO
 *      connection so the speaker's tile shows live captions and the rest
 *      of the room sees them too.
 *
 * Usage:
 *   const rt = BiLingoRealtime.create({
 *     apiBase: '',                 // '' = same-origin
 *     socket: socket,              // Socket.IO room socket
 *     nativeLang: 'es',
 *     onStatus: (state) => {...},  // 'idle' | 'connecting' | 'live' | 'error'
 *     onCaption: ({ original, translated, isFinal }) => {...}
 *   });
 *   await rt.start();
 *   ...
 *   rt.stop();
 *
 * The translated audio track is exposed as `rt.translatedTrack` so the
 * existing WebRTC peer connection can replace the raw mic track with the
 * translated one, ensuring the OTHER participant hears the translation.
 */

(function (global) {
  'use strict';

  function joinUrl(base, path) {
    if (!base) return path;
    if (base.endsWith('/') && path.startsWith('/')) return base + path.slice(1);
    if (!base.endsWith('/') && !path.startsWith('/')) return base + '/' + path;
    return base + path;
  }

  function create(opts) {
    opts = opts || {};
    const apiBase = opts.apiBase || '';
    const socket = opts.socket || null;
    const nativeLang = opts.nativeLang || 'en';
    const onStatus = typeof opts.onStatus === 'function' ? opts.onStatus : function () {};
    const onCaption = typeof opts.onCaption === 'function' ? opts.onCaption : function () {};
    const onError = typeof opts.onError === 'function' ? opts.onError : function () {};

    let pc = null;
    let micStream = null;
    let dataChannel = null;
    let audioEl = null;
    let translatedTrack = null;
    let sessionInfo = null;
    let stopped = false;

    // ---- Local VAD gate state ----
    let vadAudioCtx = null;
    let vadAnalyser = null;
    let vadRafId = null;
    let vadSourceNode = null;
    // Tuning knobs — exposed via opts so we can A/B tune later.
    const VAD_RMS_THRESHOLD = (typeof opts.vadThreshold === 'number') ? opts.vadThreshold : 0.012;
    const VAD_SILENCE_HOLD_MS = (typeof opts.vadSilenceHoldMs === 'number') ? opts.vadSilenceHoldMs : 400;
    const VAD_ATTACK_MS = 60; // how long voice must persist before un-muting
    let lastVoiceAt = 0;
    let lastSilenceAt = 0;
    let micGateMuted = true;
    let vadVoiceStartAt = 0;

    // Buffers for the in-progress turn.
    let currentTurn = {
      original: '',
      translated: '',
      itemId: null
    };

    function setStatus(s) {
      try { onStatus(s); } catch (_) {}
    }

    function emitCaption(payload) {
      try { onCaption(payload); } catch (_) {}
      if (socket && socket.connected) {
        try {
          socket.emit('speak', {
            sourceLanguage: payload.originalLanguage || 'auto',
            originalText: payload.original || '',
            translatedText: payload.translated || '',
            isFinal: !!payload.isFinal
          });
        } catch (_) {}
      }
    }

    async function mintSession() {
      const url = joinUrl(apiBase, 'api/realtime/session') + '?t=' + Date.now();
      const res = await fetch(url, {
        method: 'POST',
        credentials: 'include',
        cache: 'no-store',
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache',
          'Pragma': 'no-cache'
        },
        body: JSON.stringify({ nativeLang: nativeLang })
      });
      if (!res.ok) {
        const txt = await res.text();
        throw new Error('Could not mint Realtime session: HTTP ' + res.status + ' ' + txt);
      }
      const data = await res.json();
      console.log('[realtime] /api/realtime/session response:', JSON.stringify({
        model: data.model,
        voice: data.voice,
        nativeLang: data.nativeLang,
        hasSecret: !!data.client_secret
      }));
      if (!data.client_secret) throw new Error('Realtime session missing client_secret');
      return data;
    }

    function handleServerEvent(ev) {
      if (!ev || !ev.type) return;
      switch (ev.type) {
        // The model produced text (the TRANSLATION).
        case 'response.audio_transcript.delta':
          if (ev.delta) {
            currentTurn.translated += ev.delta;
            emitCaption({
              original: currentTurn.original,
              translated: currentTurn.translated,
              originalLanguage: 'auto',
              isFinal: false
            });
          }
          break;
        case 'response.audio_transcript.done':
          if (ev.transcript) currentTurn.translated = ev.transcript;
          emitCaption({
            original: currentTurn.original,
            translated: currentTurn.translated,
            originalLanguage: 'auto',
            isFinal: true
          });
          // Reset for next turn.
          currentTurn = { original: '', translated: '', itemId: null };
          break;

        // Whisper transcription of the INPUT audio (the ORIGINAL words).
        case 'conversation.item.input_audio_transcription.completed':
          if (ev.transcript) {
            currentTurn.original = ev.transcript;
            emitCaption({
              original: currentTurn.original,
              translated: currentTurn.translated,
              originalLanguage: 'auto',
              isFinal: false
            });
          }
          break;
        case 'conversation.item.input_audio_transcription.failed':
          console.warn('[realtime] input transcription failed', ev);
          break;

        case 'response.done':
        case 'response.completed':
          // Defensive flush.
          if (currentTurn.translated || currentTurn.original) {
            emitCaption({
              original: currentTurn.original,
              translated: currentTurn.translated,
              originalLanguage: 'auto',
              isFinal: true
            });
            currentTurn = { original: '', translated: '', itemId: null };
          }
          break;

        case 'error':
          console.warn('[realtime] server error event', ev);
          onError(new Error((ev.error && ev.error.message) || 'Realtime error'));
          break;

        default:
          // Many events we ignore (rate_limits.updated, session.created, etc.)
          break;
      }
    }

    async function start() {
      if (pc) return;
      stopped = false;
      setStatus('connecting');

      try {
        // 1. Ephemeral key.
        sessionInfo = await mintSession();
        const ek = sessionInfo.client_secret;
        const model = sessionInfo.model;

        // 2. Microphone — with browser-level noise suppression engaged.
        micStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
            channelCount: 1,
            sampleRate: 24000
          }
        });

        // 2b. Local VAD gate. We measure RMS on the mic stream and MUTE
        //     the outgoing track whenever the signal is below a threshold
        //     for `silenceHoldMs`. While muted, OpenAI receives effectively
        //     no audio frames -> no tokens spent on silence/background noise.
        installLocalVadGate(micStream);

        // 3. Peer connection to OpenAI.
        pc = new RTCPeerConnection();

        // Audio sink for the TRANSLATED voice.
        audioEl = document.createElement('audio');
        audioEl.autoplay = true;
        audioEl.style.display = 'none';
        document.body.appendChild(audioEl);

        pc.ontrack = function (e) {
          if (e.streams && e.streams[0]) {
            audioEl.srcObject = e.streams[0];
            const tracks = e.streams[0].getAudioTracks();
            translatedTrack = tracks && tracks[0] ? tracks[0] : null;
            if (typeof opts.onTranslatedTrack === 'function' && translatedTrack) {
              try { opts.onTranslatedTrack(translatedTrack); } catch (_) {}
            }
          }
        };

        // Push the local mic to OpenAI.
        const micTrack = micStream.getAudioTracks()[0];
        if (micTrack) pc.addTrack(micTrack, micStream);

        // Data channel for events.
        dataChannel = pc.createDataChannel('oai-events');
        dataChannel.onopen = function () {
          // Nothing extra to send — the server-side session already has
          // instructions, VAD, transcription model, etc. configured.
          setStatus('live');
        };
        dataChannel.onmessage = function (e) {
          try {
            const data = JSON.parse(e.data);
            handleServerEvent(data);
          } catch (_) {}
        };

        // 4. SDP offer / answer with OpenAI (GA API).
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);

        const modelName = model || 'gpt-realtime-translate';
        const sdpUrl = 'https://api.openai.com/v1/realtime/calls?model=' +
                       encodeURIComponent(modelName);
        console.log('[realtime] session received, model=' + modelName +
                    ' nativeLang=' + (sessionInfo.nativeLang || '?') +
                    ' -> SDP url=' + sdpUrl);
        const sdpRes = await fetch(sdpUrl, {
          method: 'POST',
          body: offer.sdp,
          headers: {
            'Authorization': 'Bearer ' + ek,
            'Content-Type': 'application/sdp'
          }
        });
        if (!sdpRes.ok) {
          const txt = await sdpRes.text();
          throw new Error('OpenAI SDP exchange failed: HTTP ' + sdpRes.status + ' ' + txt);
        }
        const answerSdp = await sdpRes.text();
        await pc.setRemoteDescription({ type: 'answer', sdp: answerSdp });

        pc.onconnectionstatechange = function () {
          const st = pc.connectionState;
          if (st === 'failed' || st === 'closed' || st === 'disconnected') {
            if (!stopped) setStatus('error');
          }
        };
      } catch (err) {
        console.error('[realtime] start failed', err);
        setStatus('error');
        onError(err);
        cleanup();
        throw err;
      }
    }

    function installLocalVadGate(stream) {
      try {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return; // no Web Audio -> just skip the gate, server VAD still works
        vadAudioCtx = new AC();
        vadSourceNode = vadAudioCtx.createMediaStreamSource(stream);
        vadAnalyser = vadAudioCtx.createAnalyser();
        vadAnalyser.fftSize = 1024;
        vadAnalyser.smoothingTimeConstant = 0.4;
        vadSourceNode.connect(vadAnalyser);

        const buf = new Float32Array(vadAnalyser.fftSize);
        // Start MUTED — wait for actual voice before opening the gate.
        const tracks = stream.getAudioTracks();
        if (tracks[0]) tracks[0].enabled = false;
        micGateMuted = true;

        function tick() {
          if (stopped || !vadAnalyser) return;
          vadAnalyser.getFloatTimeDomainData(buf);
          // RMS of this frame
          let sum = 0;
          for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
          const rms = Math.sqrt(sum / buf.length);
          const now = performance.now();

          if (rms >= VAD_RMS_THRESHOLD) {
            // Voice detected.
            if (vadVoiceStartAt === 0) vadVoiceStartAt = now;
            lastVoiceAt = now;
            if (micGateMuted && (now - vadVoiceStartAt) >= VAD_ATTACK_MS) {
              // Open the gate.
              if (tracks[0]) tracks[0].enabled = true;
              micGateMuted = false;
            }
          } else {
            // Silence frame.
            vadVoiceStartAt = 0;
            lastSilenceAt = now;
            if (!micGateMuted && (now - lastVoiceAt) >= VAD_SILENCE_HOLD_MS) {
              // Close the gate.
              if (tracks[0]) tracks[0].enabled = false;
              micGateMuted = true;
            }
          }
          vadRafId = requestAnimationFrame(tick);
        }
        vadRafId = requestAnimationFrame(tick);
      } catch (e) {
        console.warn('[realtime] local VAD gate failed to install (server VAD still active):', e);
      }
    }

    function teardownLocalVadGate() {
      try { if (vadRafId) cancelAnimationFrame(vadRafId); } catch (_) {}
      vadRafId = null;
      try { if (vadSourceNode) vadSourceNode.disconnect(); } catch (_) {}
      vadSourceNode = null;
      vadAnalyser = null;
      try { if (vadAudioCtx) vadAudioCtx.close(); } catch (_) {}
      vadAudioCtx = null;
      micGateMuted = true;
      vadVoiceStartAt = 0;
      lastVoiceAt = 0;
      lastSilenceAt = 0;
    }

    function cleanup() {
      teardownLocalVadGate();
      try { if (dataChannel) dataChannel.close(); } catch (_) {}
      dataChannel = null;
      try { if (pc) pc.close(); } catch (_) {}
      pc = null;
      if (micStream) {
        micStream.getTracks().forEach(function (t) { try { t.stop(); } catch (_) {} });
        micStream = null;
      }
      if (audioEl) {
        try { audioEl.srcObject = null; audioEl.remove(); } catch (_) {}
        audioEl = null;
      }
      translatedTrack = null;
    }

    function stop() {
      stopped = true;
      cleanup();
      setStatus('idle');
    }

    function isLive() {
      return Boolean(pc && pc.connectionState === 'connected');
    }

    return {
      start: start,
      stop: stop,
      isLive: isLive,
      get translatedTrack() { return translatedTrack; },
      get session() { return sessionInfo; },
      // Exposed for debugging / UI indicator ("speaking" dot)
      get isVoiceActive() { return !micGateMuted; }
    };
  }

  global.BiLingoRealtime = { create: create };
})(typeof window !== 'undefined' ? window : this);
