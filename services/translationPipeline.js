'use strict';

/**
 * Translation Pipeline — OpenAI-backed (chat / text) + persistence.
 *
 * KEY OPTIMIZATION:
 *   We translate ONCE per unique target language, then fan out to every
 *   listener who needs that language. If a listener shares the speaker's
 *   native language → zero API calls; the original text is reused.
 *
 * Persists, per spoken segment:
 *   - one `transcript_segments` row (translations JSON keyed by target lang)
 *   - one `translation_sessions` row per LISTENER (so we can bill / audit
 *     per-user delivery)
 *
 * Realtime audio: this module also exposes the helpers that the WebSocket
 * audio bridge will call (planned next step). The current path runs on
 * text-level STT input (originalText supplied by client). When the audio
 * bridge lands, it will fill `audioBlob` and STT will become a real call to
 * gpt-realtime-mini (transcription + optional inline translation).
 */

const db = require('../config/db');
const { translateWithUsage, isOpenAIConfigured, getChatModel } = require('./openaiTranslate');
const { recordUsage } = require('./tokenUsage');

const DEGRADED_THRESHOLD_MS = 2000;

function normalizeLang(code) {
  if (!code) return code;
  return String(code).toLowerCase().split('-')[0];
}

function randomLatency(min, max) {
  return Math.floor(min + Math.random() * (max - min));
}

/**
 * Simulated STT layer — kept here so the rest of the pipeline doesn't change
 * when we plug in real audio. When `originalText` is provided (text-mode
 * speaking or a pre-transcribed client), we use it directly. Latency is
 * recorded so analytics still get a value.
 */
async function simulateSTT(audioBlob, sourceLanguage, originalText) {
  const latency = audioBlob ? randomLatency(220, 520) : randomLatency(40, 120);
  const text = originalText && String(originalText).trim()
    ? String(originalText).trim()
    : `[stt:${sourceLanguage}] sample transcript ${Date.now().toString(36)}`;
  return { text, latencyMs: latency };
}

/**
 * Translate ONE unique target language. Wraps the OpenAI/MyMemory call and
 * gives us a uniform { translated, latencyMs } shape regardless of provider.
 */
async function runMT(text, sourceLang, targetLang) {
  const src = normalizeLang(sourceLang);
  const tgt = normalizeLang(targetLang);
  if (src === tgt) {
    return { translated: text, latencyMs: 0, usage: null };
  }
  let usage = null;
  try {
    usage = await translateWithUsage(text, src, tgt);
  } catch (e) {
    usage = null;
  }
  let translated = usage && usage.text;
  if (!translated) {
    translated = `[${tgt}] ${text}`;
  }
  return {
    translated,
    latencyMs: (usage && usage.latencyMs) || 0,
    usage
  };
}

/**
 * Process a single spoken segment.
 *
 * @param {Object} opts
 * @param {number} opts.meetingId           — rooms.id
 * @param {number} [opts.speakerParticipantId] — meeting_participants.id of speaker
 * @param {number} [opts.speakerUserId]     — users.id of speaker
 * @param {Buffer|string|null} [opts.audioBlob]
 * @param {string} [opts.originalText]      — if STT already happened on the client
 * @param {string} opts.sourceLanguage      — e.g. 'en'
 * @param {Array<{participantId?:number,userId?:number,targetLanguage:string}>} opts.targetLanguages
 *        — one entry per LISTENER (not including the speaker)
 *
 * @returns {Promise<{segmentId:number, originalText:string, translations:Object, deliveries:Array}>}
 */
async function processSegment(opts) {
  const {
    meetingId,
    speakerParticipantId = null,
    speakerUserId = null,
    audioBlob = null,
    originalText: providedText = null,
    sourceLanguage,
    targetLanguages = [],
    startMs: providedStartMs = null,
    endMs: providedEndMs = null,
    confidence: providedConfidence = null
  } = opts || {};

  if (!meetingId) throw new Error('meetingId is required');
  if (!sourceLanguage) throw new Error('sourceLanguage is required');

  const sourceLang = normalizeLang(sourceLanguage);

  // 1. STT (simulated or pre-transcribed).
  const stt = await simulateSTT(audioBlob, sourceLang, providedText);
  const originalText = stt.text;
  const audioInLatencyMs = stt.latencyMs;

  // Timeline metadata.
  const audioDurationMs = randomLatency(800, 3500);
  const endMs = providedEndMs != null ? Number(providedEndMs) : Date.now();
  const startMs = providedStartMs != null ? Number(providedStartMs) : (endMs - audioDurationMs);
  const confidence = providedConfidence != null
    ? Math.max(0, Math.min(1, Number(providedConfidence)))
    : Math.round((0.78 + Math.random() * 0.21) * 1000) / 1000;

  // 2. MT — group by unique normalized target language (THE OPTIMIZATION).
  //    Listeners that share the same target language share one OpenAI call.
  //    Listeners whose target == sourceLang get the original text for free.
  const uniqueTargets = Array.from(new Set(
    targetLanguages
      .map(t => t && t.targetLanguage ? normalizeLang(t.targetLanguage) : null)
      .filter(Boolean)
  ));

  const mtByLang = {};
  // Run translations IN PARALLEL — drops total latency for multi-lang rooms.
  await Promise.all(uniqueTargets.map(async (lang) => {
    mtByLang[lang] = await runMT(originalText, sourceLang, lang);
  }));

  // 3. transcript_segments row (translations keyed by target lang).
  //    NOTE: no audio URL anymore — listeners hear the speaker's ORIGINAL
  //    voice via WebRTC. Captions carry the translated text.
  const translationsForSegment = {};
  for (const lang of uniqueTargets) {
    translationsForSegment[lang] = { text: mtByLang[lang].translated };
  }

  const segRes = await db.query(
    `INSERT INTO transcript_segments
       (meeting_id, speaker_participant_id, speaker_user_id, source_language, original_text,
        translations, audio_duration_ms, start_ms, end_ms, confidence)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      meetingId,
      speakerParticipantId,
      speakerUserId,
      sourceLang,
      originalText,
      JSON.stringify(translationsForSegment),
      audioDurationMs,
      startMs,
      endMs,
      confidence
    ]
  );
  const segmentId = segRes.insertId;

  // 4. translation_sessions: one row per LISTENER.
  const deliveries = [];
  for (const listener of targetLanguages) {
    if (!listener) continue;
    const targetLanguage = normalizeLang(listener.targetLanguage);
    if (!targetLanguage) continue;

    const mt = mtByLang[targetLanguage] || { translated: originalText, latencyMs: 0 };
    const ttsLatencyMs = 0; // no TTS — listeners hear the speaker's real voice

    const totalLatencyMs = audioInLatencyMs + mt.latencyMs + ttsLatencyMs;
    const isDegraded = totalLatencyMs > DEGRADED_THRESHOLD_MS ? 1 : 0;

    const insRes = await db.query(
      `INSERT INTO translation_sessions
         (meeting_id, segment_id, speaker_participant_id,
          listener_participant_id, listener_user_id,
          source_language, target_language,
          original_text, translated_text, audio_url,
          audio_in_latency_ms, translation_latency_ms, tts_latency_ms,
          total_latency_ms, is_degraded)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        meetingId,
        segmentId,
        speakerParticipantId,
        listener.participantId || null,
        listener.userId || null,
        sourceLang,
        targetLanguage,
        originalText,
        mt.translated,
        null,                  // no audio_url — original voice played via WebRTC
        audioInLatencyMs,
        mt.latencyMs,
        ttsLatencyMs,
        totalLatencyMs,
        isDegraded
      ]
    );

    deliveries.push({
      sessionId: insRes.insertId,
      participantId: listener.participantId || null,
      userId: listener.userId || null,
      targetLanguage,
      translatedText: mt.translated,
      audioUrl: null,
      audioInLatencyMs,
      translationLatencyMs: mt.latencyMs,
      ttsLatencyMs,
      totalLatencyMs,
      isDegraded: Boolean(isDegraded)
    });
  }

  return {
    segmentId,
    originalText,
    sourceLanguage: sourceLang,
    translations: translationsForSegment,
    startMs,
    endMs,
    confidence,
    audioDurationMs,
    deliveries,
    provider: isOpenAIConfigured() ? 'openai:' + getChatModel() : 'mymemory'
  };
}

module.exports = {
  processSegment,
  DEGRADED_THRESHOLD_MS,
  // exposed for testing / debugging
  _internal: { runMT, normalizeLang }
};
