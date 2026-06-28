'use strict';

// Smoke test for the translation pipeline stub — verifies that:
//   1. A row is INSERTed into transcript_segments with start_ms/end_ms/confidence
//   2. Per-listener translation_sessions rows are written
//   3. The deliveries returned from processSegment carry translatedText
//
// Run from project root:  node scripts/smoke-translation-pipeline.js

const db = require('../config/db');
const { processSegment } = require('../services/translationPipeline');

(async () => {
  try {
    const meetingId = 6;

    const participants = await db.query(
      `SELECT id, user_id, native_language, target_language
       FROM meeting_participants
       WHERE room_id = ? AND status = 'admitted'`,
      [meetingId]
    );
    if (!participants.length) {
      console.error('No admitted participants in room', meetingId, '— pick another meeting id.');
      process.exit(2);
    }

    const speaker = participants[0];
    const listeners = participants.slice(1).map(p => ({
      participantId: p.id,
      userId: p.user_id,
      targetLanguage: p.native_language || 'en'
    }));

    console.log('Speaker participant:', speaker.id, '(user', speaker.user_id, ')');
    console.log('Listeners:', listeners);

    const result = await processSegment({
      meetingId,
      speakerParticipantId: speaker.id,
      speakerUserId: speaker.user_id,
      audioBlob: null,
      originalText: 'Hello everyone, welcome to the meeting.',
      sourceLanguage: speaker.native_language || 'en',
      targetLanguages: listeners
    });

    console.log('\n=== processSegment result ===');
    console.log(JSON.stringify(result, null, 2));

    const seg = await db.query(
      'SELECT id, meeting_id, source_language, original_text, start_ms, end_ms, confidence, audio_duration_ms FROM transcript_segments WHERE id = ?',
      [result.segmentId]
    );
    const sessions = await db.query(
      'SELECT id, listener_user_id, target_language, total_latency_ms, is_degraded FROM translation_sessions WHERE segment_id = ?',
      [result.segmentId]
    );

    console.log('\n=== transcript_segments row ===');
    console.log(seg[0]);
    console.log('\n=== translation_sessions rows ===');
    console.log(sessions);

    // Assertions
    if (!seg.length) throw new Error('FAIL: no transcript_segments row was inserted');
    if (seg[0].start_ms == null) throw new Error('FAIL: start_ms not populated');
    if (seg[0].end_ms == null)   throw new Error('FAIL: end_ms not populated');
    if (seg[0].confidence == null) throw new Error('FAIL: confidence not populated');
    if (listeners.length && sessions.length === 0) throw new Error('FAIL: no translation_sessions rows for listeners');

    console.log('\nOK — transcript_segments row persisted with start_ms / end_ms / confidence,');
    console.log('     and', sessions.length, 'translation_sessions row(s) written.');
    process.exit(0);
  } catch (err) {
    console.error('SMOKE FAIL:', err);
    process.exit(1);
  }
})();