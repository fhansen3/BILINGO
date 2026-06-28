'use strict';

/**
 * Shared socket.io instance accessor.
 *
 * server.js calls setIO(io) once at boot; route handlers call getIO() to
 * emit events from HTTP endpoints (e.g. host moderation actions).
 */

let _io = null;

function setIO(io) { _io = io; }
function getIO()   { return _io; }

module.exports = { setIO, getIO };