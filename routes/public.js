'use strict';

const router = require('express').Router();
const path = require('path');

/**
 * Public, server-rendered pages.
 * These use the EJS layout with the public navbar partial.
 */

// GET / — landing page
router.get('/', (req, res) => {
  res.render('landing', {
    title: 'BiLingo Meet · Reuniones de trabajo sin barreras de idioma',
    description: 'Plataforma de videollamadas con chat traducido en tiempo real para equipos globales.',
    nav: 'public',
    user: (req.session && req.session.user) || null
  });
});

// GET /help — help center
router.get('/help', (req, res) => {
  res.render('help', {
    title: 'Centro de ayuda · BiLingo Meet',
    description: 'Cómo funciona el pipeline de traducción, latencia, privacidad y preguntas frecuentes.',
    nav: 'public',
    user: (req.session && req.session.user) || null
  });
});

// POST /join — meeting-code join from landing
// Validates the code shape and forwards into the SPA room route.
router.post('/join', (req, res) => {
  const raw = (req.body && req.body.code) || '';
  const code = String(raw).trim().toUpperCase().replace(/[^A-Z0-9-]/g, '');

  if (!code || code.length < 4 || code.length > 12) {
    // Re-render landing with a flash-style error
    return res.status(400).render('landing', {
      title: 'BiLingo Meet · Reuniones de trabajo sin barreras de idioma',
      description: 'Plataforma de videollamadas con chat traducido en tiempo real para equipos globales.',
      nav: 'public',
      user: (req.session && req.session.user) || null,
      joinError: 'El código de reunión no es válido. Debe tener entre 4 y 12 caracteres.'
    });
  }

  // Hand off to the SPA's client-side router for the room screen.
  res.redirect(`/#/room/${code}`);
});

/**
 * Catch-all 404 renderer.
 * Mount this LAST on the app, after the SPA fallback. It only runs when
 * no earlier route or static file matched.
 */
function notFoundHandler(req, res) {
  // JSON for API-style requests, HTML page for browsers.
  if (req.path.startsWith('/api/') || req.accepts(['html', 'json']) === 'json') {
    return res.status(404).json({ error: 'Not found' });
  }
  res.status(404).render('404', {
    title: 'Página no encontrada · BiLingo Meet',
    description: 'La página que buscas no existe.',
    nav: 'public',
    user: (req.session && req.session.user) || null
  });
}

module.exports = router;
module.exports.notFoundHandler = notFoundHandler;