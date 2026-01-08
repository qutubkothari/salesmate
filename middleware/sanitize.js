// Lightweight request sanitization.
// Removes prototype-pollution keys and ensures JSON bodies are plain objects.

const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

function isPlainObject(value) {
  if (!value || typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function sanitizeValue(value, depth = 0) {
  if (depth > 20) return value;
  if (Array.isArray(value)) return value.map((v) => sanitizeValue(v, depth + 1));
  if (!isPlainObject(value)) return value;

  const out = {};
  for (const [k, v] of Object.entries(value)) {
    if (FORBIDDEN_KEYS.has(k)) continue;
    if (typeof k === 'string' && k.startsWith('$')) continue;
    out[k] = sanitizeValue(v, depth + 1);
  }
  return out;
}

function sanitizeJsonBody(req, res, next) {
  const method = (req.method || '').toUpperCase();
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) return next();

  // Only act on JSON-like bodies.
  if (req.body === undefined || req.body === null) return next();

  if (Array.isArray(req.body)) {
    return res.status(400).json({ ok: false, error: 'invalid_request', details: [{ path: 'body', message: 'Body must be an object' }] });
  }
  if (typeof req.body === 'object') {
    req.body = sanitizeValue(req.body);
  }
  return next();
}

module.exports = {
  sanitizeJsonBody,
};
