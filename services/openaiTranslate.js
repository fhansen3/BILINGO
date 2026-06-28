'use strict';

/**
 * OpenAI-backed text translator for chat + caption text.
 *
 * Returns BOTH the translated string and usage metadata (tokens, model, cost)
 * so the caller can persist per-meeting cost analytics.
 *
 * Public API:
 *   translateText(text, sourceLang, targetLang, opts?)
 *     → Promise<string|null>      (legacy convenience wrapper)
 *   translateWithUsage(text, sourceLang, targetLang, opts?)
 *     → Promise<{
 *         text:string|null, provider:string, model:string,
 *         promptTokens:number, completionTokens:number, totalTokens:number,
 *         promptCostUsd:number, completionCostUsd:number, totalCostUsd:number,
 *         latencyMs:number, wasCached:boolean
 *       }>
 *   isOpenAIConfigured() → boolean
 *   getChatModel()       → string
 *
 * Pricing is configurable via env vars so we can update without redeploying:
 *   OPENAI_PRICE_PROMPT_PER_1K       (default tuned to gpt-4o-mini)
 *   OPENAI_PRICE_COMPLETION_PER_1K
 */

const https = require('https');
const { translate: myMemoryTranslate } = require('../utils/translate');

const CHAT_MODEL = process.env.OPENAI_CHAT_MODEL || 'gpt-4o-mini';
const API_KEY = process.env.OPENAI_API_KEY || '';
const PROVIDER = (process.env.TRANSLATION_PROVIDER || (API_KEY ? 'openai' : 'mymemory')).toLowerCase();

// Pricing per 1K tokens, in USD. Defaults are gpt-4o-mini list prices.
// Override per deployment via env vars if OpenAI changes pricing.
const PRICE_PROMPT_PER_1K     = parseFloat(process.env.OPENAI_PRICE_PROMPT_PER_1K     || '0.00015');
const PRICE_COMPLETION_PER_1K = parseFloat(process.env.OPENAI_PRICE_COMPLETION_PER_1K || '0.0006');

const cache = new Map();
const MAX_CACHE = 1000;

function cacheKey(text, src, tgt) {
  return src + '|' + tgt + '|' + text;
}

function isOpenAIConfigured() {
  return Boolean(API_KEY);
}
function getChatModel() {
  return CHAT_MODEL;
}

const LANG_NAME = {
  es: 'Spanish', en: 'English', pt: 'Portuguese', fr: 'French',
  de: 'German',  it: 'Italian', zh: 'Chinese',    ja: 'Japanese',
  ar: 'Arabic',  ru: 'Russian'
};
function langName(code) {
  if (!code) return code;
  const base = String(code).toLowerCase().split('-')[0];
  return LANG_NAME[base] || base.toUpperCase();
}

function emptyUsage(extra) {
  return Object.assign({
    text: null,
    provider: 'none',
    model: '',
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    promptCostUsd: 0,
    completionCostUsd: 0,
    totalCostUsd: 0,
    latencyMs: 0,
    wasCached: false
  }, extra || {});
}

function callOpenAI(text, sourceLang, targetLang, timeoutMs) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const body = JSON.stringify({
      model: CHAT_MODEL,
      messages: [
        {
          role: 'system',
          content:
            'You are a real-time meeting translator for international business teams. ' +
            'Translate the user message from ' + langName(sourceLang) + ' to ' + langName(targetLang) + '. ' +
            'Reply with ONLY the translation — no quotes, no preamble, no language tag. ' +
            'Preserve names, numbers, emails, URLs. Keep the same tone (formal/informal). ' +
            'If the input is already in ' + langName(targetLang) + ', return it unchanged.'
        },
        { role: 'user', content: String(text) }
      ],
      temperature: 0,
      max_tokens: 800
    });

    const req = https.request({
      host: 'api.openai.com',
      path: '/v1/chat/completions',
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + API_KEY,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    }, (res) => {
      let buf = '';
      res.on('data', (c) => { buf += c; });
      res.on('end', () => {
        const latencyMs = Date.now() - startedAt;
        if (res.statusCode !== 200) {
          console.warn('[openaiTranslate] HTTP', res.statusCode, buf.slice(0, 200));
          return resolve(emptyUsage({ latencyMs }));
        }
        try {
          const j = JSON.parse(buf);
          const out = j && j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
          const usage = (j && j.usage) || {};
          const pt = Number(usage.prompt_tokens || 0);
          const ct = Number(usage.completion_tokens || 0);
          const tt = Number(usage.total_tokens || (pt + ct));
          const promptCost = (pt / 1000) * PRICE_PROMPT_PER_1K;
          const compCost   = (ct / 1000) * PRICE_COMPLETION_PER_1K;
          resolve({
            text: out ? String(out).trim() : null,
            provider: 'openai',
            model: CHAT_MODEL,
            promptTokens: pt,
            completionTokens: ct,
            totalTokens: tt,
            promptCostUsd: promptCost,
            completionCostUsd: compCost,
            totalCostUsd: promptCost + compCost,
            latencyMs,
            wasCached: false
          });
        } catch (e) {
          resolve(emptyUsage({ latencyMs }));
        }
      });
    });

    req.on('error', (e) => {
      console.warn('[openaiTranslate] transport error', e.message);
      resolve(emptyUsage({ latencyMs: Date.now() - startedAt }));
    });

    const t = setTimeout(() => {
      req.destroy(new Error('timeout'));
      resolve(emptyUsage({ latencyMs: Date.now() - startedAt }));
    }, timeoutMs || 8000);
    req.on('close', () => clearTimeout(t));

    req.write(body);
    req.end();
  });
}

async function translateWithUsage(text, sourceLang, targetLang, opts) {
  if (!text || !sourceLang || !targetLang) {
    return emptyUsage({ text: null });
  }
  const src = String(sourceLang).toLowerCase().split('-')[0];
  const tgt = String(targetLang).toLowerCase().split('-')[0];
  if (src === tgt) {
    return emptyUsage({ text: String(text), provider: 'identity', model: 'identity', wasCached: true });
  }

  const key = cacheKey(text, src, tgt);
  if (cache.has(key)) {
    return emptyUsage({
      text: cache.get(key),
      provider: 'cache',
      model: CHAT_MODEL,
      wasCached: true
    });
  }

  let result = emptyUsage();
  if (PROVIDER === 'openai' && API_KEY) {
    result = await callOpenAI(text, src, tgt, opts && opts.timeoutMs);
  }

  // Fallback to MyMemory if OpenAI failed / disabled.
  if (!result.text) {
    try {
      const mm = await myMemoryTranslate(text, src, tgt);
      if (mm) {
        result = emptyUsage({
          text: mm,
          provider: 'mymemory',
          model: 'mymemory',
          latencyMs: result.latencyMs
        });
      }
    } catch (_) { /* ignore */ }
  }

  if (result.text) {
    if (cache.size >= MAX_CACHE) {
      const firstKey = cache.keys().next().value;
      cache.delete(firstKey);
    }
    cache.set(key, result.text);
  }
  return result;
}

// Legacy convenience wrapper (string in, string out).
async function translateText(text, sourceLang, targetLang, opts) {
  const r = await translateWithUsage(text, sourceLang, targetLang, opts);
  return r.text;
}

module.exports = {
  translateText,
  translateWithUsage,
  isOpenAIConfigured,
  getChatModel
};
