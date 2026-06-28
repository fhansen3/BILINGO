'use strict';

const router = require('express').Router();

/**
 * Public, server-rendered pages.
 * These use the EJS layout with the public navbar partial.
 */

// --- Helpers --------------------------------------------------------------

/**
 * Build the absolute public URL of the current request, honoring the
 * reverse-proxy BASE_PATH so the canonical/og:url tags are correct when the
 * app is served behind /run/<projectId>/ or /project-<u>/<p>/.
 */
function publicUrl(req, suffix) {
  const proto = (req.headers['x-forwarded-proto'] || req.protocol || 'https').split(',')[0].trim();
  const host = (req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
  const basePath = (process.env.BASE_PATH || '').replace(/\/$/, '');
  const tail = suffix ? (suffix.startsWith('/') ? suffix : '/' + suffix) : '';
  // basePath already starts with '/' when set by the runtime; if it's empty, just host+tail.
  return `${proto}://${host}${basePath}${tail}`;
}

function absoluteAsset(req, relPath) {
  // relPath is something like "images/og-image.svg"
  return publicUrl(req, '/' + relPath.replace(/^\/+/, ''));
}

function landingSeo(req) {
  const canonical = publicUrl(req, '/');
  const ogImage = absoluteAsset(req, 'images/og-image.png');

  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'SoftwareApplication',
        'name': 'BiLingo Meet',
        'applicationCategory': 'BusinessApplication',
        'operatingSystem': 'Web, Windows, macOS, Linux, Android, iOS',
        'description': 'Free multilingual video conferencing with real-time AI translation. Speak in your language, everyone hears theirs.',
        'url': canonical,
        'image': ogImage,
        'offers': {
          '@type': 'Offer',
          'price': '0',
          'priceCurrency': 'USD'
        },
        'featureList': [
          'Real-time speech translation',
          'Multilingual group video calls',
          'Live caption translation',
          'WebRTC video & audio',
          'No install required',
          '30+ supported languages',
          'Free for personal and team use'
        ],
        'inLanguage': ['en', 'es', 'pt', 'fr', 'de', 'it', 'zh', 'ja']
      },
      {
        '@type': 'WebSite',
        'name': 'BiLingo Meet',
        'url': canonical,
        'inLanguage': 'en'
      },
      {
        '@type': 'Organization',
        'name': 'BiLingo Meet',
        'url': canonical,
        'logo': absoluteAsset(req, 'images/logo.svg')
      }
    ]
  };

  return {
    title: 'BiLingo Meet — Free real-time translated video meetings in any language',
    description: 'BiLingo Meet is a free multilingual video conferencing platform with real-time AI translation. Speak in your own language and everyone in the meeting hears (and reads) theirs. No install, works in 30+ languages.',
    keywords: 'free video conferencing, multilingual video calls, real-time translation, AI interpreter, live translated meetings, multilingual meetings, free online meetings, video chat translation, real time interpreter, multilingual zoom alternative, free meeting app, translated video conference, language translation meeting, bilingual meetings, international video calls, free conference call multiple languages, web meeting translator',
    canonicalUrl: canonical,
    ogImage: ogImage,
    ogImageAlt: 'BiLingo Meet — Real-time translated video meetings. Talk in your language, everyone hears theirs.',
    ogType: 'website',
    ogLocale: 'en_US',
    htmlLang: 'en',
    jsonLd: jsonLd
  };
}

// --- Routes ---------------------------------------------------------------

// GET / — landing page
router.get('/', (req, res) => {
  const seo = landingSeo(req);
  res.render('landing', Object.assign({}, seo, {
    nav: 'public',
    user: (req.session && req.session.user) || null
  }));
});

// GET /help — help center
router.get('/help', (req, res) => {
  res.render('help', {
    title: 'Help Center · BiLingo Meet',
    description: 'How real-time translation works on BiLingo Meet, latency, privacy, supported languages and frequently asked questions about our free multilingual video conferencing platform.',
    canonicalUrl: publicUrl(req, '/help'),
    nav: 'public',
    user: (req.session && req.session.user) || null
  });
});

// GET /robots.txt — basic SEO crawler hints
router.get('/robots.txt', (req, res) => {
  res.type('text/plain');
  res.send(
    'User-agent: *\n' +
    'Allow: /\n' +
    'Disallow: /api/\n' +
    'Disallow: /admin\n' +
    'Disallow: /dashboard\n' +
    'Disallow: /account-settings\n' +
    'Disallow: /m/\n' +
    'Sitemap: ' + publicUrl(req, '/sitemap.xml') + '\n'
  );
});

// GET /sitemap.xml
router.get('/sitemap.xml', (req, res) => {
  const urls = [
    { loc: publicUrl(req, '/'),     priority: '1.0', changefreq: 'weekly' },
    { loc: publicUrl(req, '/help'), priority: '0.6', changefreq: 'monthly' }
  ];
  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'
  ];
  for (const u of urls) {
    xml.push('  <url>');
    xml.push('    <loc>' + u.loc + '</loc>');
    xml.push('    <changefreq>' + u.changefreq + '</changefreq>');
    xml.push('    <priority>' + u.priority + '</priority>');
    xml.push('  </url>');
  }
  xml.push('</urlset>');
  res.type('application/xml').send(xml.join('\n'));
});

// POST /join — meeting-code join from landing
// Validates the code shape and forwards into the SPA room route.
router.post('/join', (req, res) => {
  const raw = (req.body && req.body.code) || '';
  const code = String(raw).trim().toUpperCase().replace(/[^A-Z0-9-]/g, '');

  if (!code || code.length < 4 || code.length > 12) {
    const seo = landingSeo(req);
    // Re-render landing with a flash-style error
    return res.status(400).render('landing', Object.assign({}, seo, {
      nav: 'public',
      user: (req.session && req.session.user) || null,
      joinError: 'The meeting code is invalid. It must be between 4 and 12 characters.'
    }));
  }

  // Hand off to the server-rendered meeting page (relative redirect — proxy-safe).
  res.redirect('m/' + encodeURIComponent(code));
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
    title: 'Page not found · BiLingo Meet',
    description: 'The page you are looking for does not exist.',
    robots: 'noindex,follow',
    nav: 'public',
    user: (req.session && req.session.user) || null
  });
}

module.exports = router;
module.exports.notFoundHandler = notFoundHandler;
