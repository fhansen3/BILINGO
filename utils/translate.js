'use strict';

// Lightweight translator using MyMemory API (free, no API key required).
// Docs: https://mymemory.translated.net/doc/spec.php
// We use the global fetch available in Node 18+.

const cache = new Map();
const MAX_CACHE = 500;

function cacheKey(text, source, target) {
  return source + '|' + target + '|' + text;
}

async function translate(text, sourceLang, targetLang) {
  if (!text || !sourceLang || !targetLang) return null;
  if (sourceLang === targetLang) return text;

  const key = cacheKey(text, sourceLang, targetLang);
  if (cache.has(key)) return cache.get(key);

  // MyMemory accepts lang codes like "en|es" or "en-US|es-ES"
  const langPair = encodeURIComponent(sourceLang + '|' + targetLang);
  const q = encodeURIComponent(text.slice(0, 500)); // free tier limit
  const url = 'https://api.mymemory.translated.net/get?q=' + q + '&langpair=' + langPair;

  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 6000);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(t);
    if (!res.ok) return null;
    const data = await res.json();
    const translated = data?.responseData?.translatedText;
    if (!translated) return null;

    // MyMemory sometimes echoes the original wrapped in quotes — keep as is.
    if (cache.size >= MAX_CACHE) {
      const firstKey = cache.keys().next().value;
      cache.delete(firstKey);
    }
    cache.set(key, translated);
    return translated;
  } catch (err) {
    console.warn('[translate] failed:', err.message);
    return null;
  }
}

module.exports = { translate };
