'use strict';

/**
 * Translation Pipeline (stub).
 *
 * Simulates STT → MT → TTS with random latencies and persists:
 *   - one `transcript_segments` row per spoken segment (with translations JSON)
 *   - one `translation_sessions` row per listener participant
 *
 * This is the seam where real ASR/MT/TTS providers will be plugged in later.
 * For now we lean on utils/translate.js (MyMemory) for MT and fabricate the
 * STT/TTS portions with realistic-feeling latencies.
 */

const db = require('../config/db');
const { translate } = require('../utils/translate');

const DEGRADED_THRESHOLD_MS = 2000;

function randomLatency(min, max) {
  return Math.floor(min + Math.random() * (max - min));
}

// Fake STT: pretend we transcribed an audio blob. If the caller already
// supplied originalText, we use that and only fake the latency.
async function simulateSTT(audioBlob, sourceLanguage, originalText) {
  const latency = randomLatency(180, 520);
  await new Promise(r => setTimeout(r, Math.min(latency, 50))); // don't actually sleep the full amount in tests
  const text = originalText && String(originalText).trim()
    ? String(originalText)
    : `[stt:${sourceLanguage}] sample transcript ${Date.now().toString(36)}`;
  return { text, latencyMs: latency };
}

// MT: try real translator, fall back to a tagged stub.
async function runMT(text, sourceLang, targetLang) {
  const start = Date.now();
  let translated = null;
  if (sourceLang === targetLang) {
    translated = text;
  } else {
    try {
      translated = await translate(text, sourceLang, targetLang);
    } catch (_) {
      translated = null;
    }
    if (!translated) {
      translated = `[${targetLang}] ${text}`;
    }
  }
  // Ensure a minimum measured latency for the metric (random component)
  const measured = Date.now() - start;
  const latencyMs = Math.max(measured, randomLatency(120, 380));
  return { translated, latencyMs };
}

// Fake TTS: returns a mock audio URL and a latency.
async function simulateTTS(text, targetLang) {
  const latency = randomLatency(250, 700);
  const url = `/mock-audio/${targetLang}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.mp3`;
  return { audioUrl: url, latencyMs: latency };
}

/**
 * Process a single spoken segment.
 *
 * @param {Object} opts
 * @param {number} opts.meetingId           — rooms.id
 * @param {number} [opts.speakerParticipantId] — meeting_participants.id of speaker
 * @param {number} [opts.speakerUserId]     — users.id of speaker (for logging)
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

  // 1. STT (simulated) — gives us original text + audio-in latency.
  const stt = await simulateSTT(audioBlob, sourceLanguage, providedText);
  const originalText = stt.text;
  const audioInLatencyMs = stt.latencyMs;

  // Compute startMs / endMs / confidence (timeline metadata for the segment).
  const audioDurationMs = randomLatency(800, 3500);
  const endMs = providedEndMs != null ? Number(providedEndMs) : Date.now();
  const startMs = providedStartMs != null ? Number(providedStartMs) : (endMs - audioDurationMs);
  // STT confidence — provided, or simulated in [0.78, 0.99].
  const confidence = providedConfidence != null
    ? Math.max(0, Math.min(1, Number(providedConfidence)))
    : Math.round((0.78 + Math.random() * 0.21) * 1000) / 1000;

  // 2. MT — unique target languages only (cache by lang code).
  const uniqueTargets = Array.from(new Set(
    targetLanguages
      .map(t => (t && t.targetLanguage) || null)
      .filter(Boolean)
  ));

  const mtByLang = {};   // { lang: { translated, latencyMs } }
  const ttsByLang = {};  // { lang: { audioUrl, latencyMs } }

  for (const lang of uniqueTargets) {
    const mt = await runMT(originalText, sourceLanguage, lang);
    mtByLang[lang] = mt;
    const tts = await simulateTTS(mt.translated, lang);
    ttsByLang[lang] = tts;
  }

  // 3. Insert transcript_segments row.
  const translationsForSegment = {};
  for (const lang of uniqueTargets) {
    translationsForSegment[lang] = {
      text: mtByLang[lang].translated,
      audioUrl: ttsByLang[lang].audioUrl
    };
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
      sourceLanguage,
      originalText,
      JSON.stringify(translationsForSegment),
      audioDurationMs,
      startMs,
      endMs,
      confidence
    ]
  );
  const segmentId = segRes.insertId;

  // 4. Insert one translation_sessions row per LISTENER.
  const deliveries = [];
  for (const listener of targetLanguages) {
    if (!listener) continue;
    const targetLanguage = listener.targetLanguage;
    if (!targetLanguage) continue;

    const mt = mtByLang[targetLanguage] || { translated: originalText, latencyMs: 0 };
    const tts = ttsByLang[targetLanguage] || { audioUrl: null, latencyMs: 0 };

    const totalLatencyMs = audioInLatencyMs + mt.latencyMs + tts.latencyMs;
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
        sourceLanguage,
        targetLanguage,
        originalText,
        mt.translated,
        tts.audioUrl,
        audioInLatencyMs,
        mt.latencyMs,
        tts.latencyMs,
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
      audioUrl: tts.audioUrl,
      audioInLatencyMs,
      translationLatencyMs: mt.latencyMs,
      ttsLatencyMs: tts.latencyMs,
      totalLatencyMs,
      isDegraded: Boolean(isDegraded)
    });
  }

  return {
    segmentId,
    originalText,
    sourceLanguage,
    translations: translationsForSegment,
    startMs,
    endMs,
    confidence,
    audioDurationMs,
    deliveries
  };
}

module.exports = {
  processSegment,
  DEGRADED_THRESHOLD_MS
};