const { z } = require('zod');

// Schema-based validation middleware.
// - Uses Zod for type checks, length limits, and rejecting unexpected fields via .strict().
// - On success, overwrites req.body/req.query/req.params with parsed values.

function formatZodError(err) {
  try {
    return err.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
  } catch (_) {
    return [{ path: '', message: 'Invalid request' }];
  }
}

function validate({ body, query, params } = {}) {
  return (req, res, next) => {
    try {
      if (body) {
        const parsed = body.parse(req.body ?? {});
        req.body = parsed;
      }
      if (query) {
        const parsed = query.parse(req.query ?? {});
        req.query = parsed;
      }
      if (params) {
        const parsed = params.parse(req.params ?? {});
        req.params = parsed;
      }
      return next();
    } catch (err) {
      if (err && err.name === 'ZodError') {
        return res.status(400).json({ ok: false, error: 'invalid_request', details: formatZodError(err) });
      }
      return res.status(400).json({ ok: false, error: 'invalid_request' });
    }
  };
}

// Common helpers
const zTrimmedString = (min, max) =>
  z
    .string()
    .transform((s) => String(s))
    .transform((s) => s.replace(/\u0000/g, '').trim())
    .refine((s) => s.length >= min, { message: `Must be at least ${min} characters` })
    .refine((s) => s.length <= max, { message: `Must be at most ${max} characters` });

const zOptionalTrimmedString = (max) =>
  z
    .string()
    .transform((s) => String(s))
    .transform((s) => s.replace(/\u0000/g, '').trim())
    .refine((s) => s.length <= max, { message: `Must be at most ${max} characters` })
    .optional();

module.exports = {
  z,
  validate,
  zTrimmedString,
  zOptionalTrimmedString,
};
