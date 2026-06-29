'use strict';

/**
 * Detect the public URL prefix at which this app is being accessed.
 *
 * The same backend can be reached through several front-doors:
 *   1. /run/<projectId>/...           (dev workspace proxy)
 *   2. /project-<u>/<p>/...           (public sandbox proxy)
 *   3. https://app.example.com/...    (future custom domain — no prefix)
 *
 * Reverse-proxies SHOULD send `X-Forwarded-Prefix: /run/184` (or whatever).
 * Some send `X-Forwarded-Path` or `X-Script-Name`. As a last resort we fall
 * back to the BASE_PATH env var the runtime injects.
 *
 * Whatever we detect is exposed as:
 *   - req.basePrefix     "/run/184"  (no trailing slash)  OR  ""
 *   - res.locals.basePath  same value (for EJS templates)
 *   - res.locals.baseHref  "/run/184/"  (with trailing slash, for <base href>)
 *                          falls back to "./" when there is no prefix so the
 *                          tag is always valid HTML.
 */
function basePrefixMiddleware(req, res, next) {
  // 1. Proxy headers (preferred — set per-request, so they handle every
  //    front-door automatically).
  let prefix =
    req.get('x-forwarded-prefix') ||
    req.get('x-forwarded-path')   ||
    req.get('x-script-name')      ||
    '';

  // 2. BASE_PATH env (runtime fallback). Only used if no header was sent.
  if (!prefix && process.env.BASE_PATH) {
    prefix = process.env.BASE_PATH;
  }

  // Normalize: leading slash, no trailing slash.
  prefix = String(prefix || '').trim();
  if (prefix && !prefix.startsWith('/')) prefix = '/' + prefix;
  prefix = prefix.replace(/\/+$/, '');

  req.basePrefix = prefix;            // "" or "/run/184"
  res.locals.basePath = prefix;       // mirrors req.basePrefix for EJS
  res.locals.baseHref = prefix ? prefix + '/' : './';  // safe for <base href="">
  next();
}

/**
 * Build a redirect-safe path from a relative URL the developer wants the
 * browser to land on. NEVER returns a leading-slash URL — instead it returns
 * either:
 *   - a relative URL ("dashboard", "admin/users?ok=1") when no prefix, OR
 *   - the prefixed absolute path ("/run/184/admin/users") when a prefix was
 *     detected, so the redirect stays inside the project under the proxy.
 *
 * Pass the request so per-request headers win over env fallback.
 */
function bp(req, relPath) {
  let p = String(relPath || '').replace(/^\/+/, '');  // strip any leading slashes
  const prefix = (req && req.basePrefix) || '';
  if (!prefix) return p;                  // pure relative — safe under any host
  return prefix + '/' + p;                // "/run/184/dashboard"
}

module.exports = { basePrefixMiddleware, bp };
