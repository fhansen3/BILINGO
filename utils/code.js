'use strict';

const CHARS = 'abcdefghijkmnopqrstuvwxyz';

function randSegment(n) {
  let s = '';
  for (let i = 0; i < n; i++) {
    s += CHARS[Math.floor(Math.random() * CHARS.length)];
  }
  return s;
}

/**
 * Generates a meeting code in the Google-Meet-style xxx-xxxx-xxx pattern.
 * Lowercase letters only (visually unambiguous, no digits 0/1 vs l/o).
 */
function generateMeetingCode() {
  return randSegment(3) + '-' + randSegment(4) + '-' + randSegment(3);
}

// Legacy alias: existing rooms code used 6-char uppercase codes. We keep the
// export so older callers still work, but they now also get the dashed format
// — the design says "xxx-xxxx-xxx" so we unify on that pattern going forward.
function generateRoomCode() {
  return generateMeetingCode();
}

module.exports = { generateRoomCode, generateMeetingCode };