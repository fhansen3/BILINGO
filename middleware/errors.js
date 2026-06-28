'use strict';

function errorHandler(err, req, res, next) {
  const status = err.status || 500;
  // Only log real server errors (5xx). 4xx are expected client errors.
  if (status >= 500) {
    console.error('[ERROR]', err);
  } else {
    console.warn(`[${status}] ${req.method} ${req.originalUrl} — ${err.message}`);
  }
  res.status(status).json({
    error: err.message || 'Internal server error'
  });
}

module.exports = { errorHandler };
