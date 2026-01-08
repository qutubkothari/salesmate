// In-memory rate limiter (no external dependency).
//
// Goals:
// - Default: return HTTP 429 with Retry-After for public APIs.
// - Configurable: webhook-style endpoints can optionally respond 200 to avoid provider retries.
// - Supports IP-based and user-based keys.
//
// NOTE: This is per-process. If you run multiple Node processes, consider moving this to Redis.

const buckets = new Map();

function nowMs() {
	return Date.now();
}

function normalizePhoneDigits(value) {
	if (!value) return '';
	const withoutSuffix = String(value).replace(/@c\.us$/i, '');
	return withoutSuffix.replace(/\D/g, '');
}

function getUserKey(req) {
	// Prefer authenticated/known identifiers (tenant/user), then WhatsApp phone.
	const tenantId = req.tenant?.id || req.body?.tenantId || req.body?.tenant_id || req.params?.tenantId || req.params?.tenant_id;
	if (tenantId) return `tenant:${String(tenantId).slice(0, 128)}`;

	const auth = req.get ? req.get('authorization') : null;
	if (auth && typeof auth === 'string' && auth.toLowerCase().startsWith('bearer ')) {
		// Do NOT store the raw token; hash-ish by truncating.
		return `bearer:${auth.slice(7, 7 + 32)}`;
	}

	const phone = req.message?.from || req.body?.from || req.body?.phoneNumber || req.body?.customer_phone || req.query?.phone;
	const digits = normalizePhoneDigits(phone);
	if (digits) return `phone:${digits}`;

	return null;
}

function getIp(req) {
	// req.ip depends on Express trust proxy; index.js should set app.set('trust proxy', ...)
	return (req.ip || req.connection?.remoteAddress || 'unknown').toString();
}

function rateLimit({ windowMs = 60_000, max = 300, keyFn, statusCode = 429, name = 'rate_limit', skipIfNoKey = false } = {}) {
	const effectiveKeyFn =
		keyFn ||
		((req) => {
			const ip = getIp(req);
			return `${name}:ip:${ip}`;
		});

	return (req, res, next) => {
		const rawKey = effectiveKeyFn(req);
		if (skipIfNoKey && !rawKey) return next();
		const key = rawKey || `${name}:anon`;
		const now = nowMs();

		const entry = buckets.get(key) || { count: 0, resetAt: now + windowMs };
		if (now > entry.resetAt) {
			entry.count = 0;
			entry.resetAt = now + windowMs;
		}

		entry.count += 1;
		buckets.set(key, entry);

		const remaining = Math.max(0, max - entry.count);
		const retryAfterSeconds = Math.max(1, Math.ceil((entry.resetAt - now) / 1000));

		// Standard-ish headers (useful for clients, safe to expose).
		res.setHeader('X-RateLimit-Limit', String(max));
		res.setHeader('X-RateLimit-Remaining', String(remaining));
		res.setHeader('X-RateLimit-Reset', String(Math.floor(entry.resetAt / 1000)));

		if (entry.count > max) {
			res.setHeader('Retry-After', String(retryAfterSeconds));
			return res.status(statusCode).json({
				ok: false,
				error: 'rate_limited',
				retry_after_seconds: retryAfterSeconds,
			});
		}

		return next();
	};
}

function ipRateLimit(opts = {}) {
	return rateLimit({
		name: 'ip',
		keyFn: (req) => `ip:${getIp(req)}`,
		...opts,
	});
}

function userRateLimit(opts = {}) {
	return rateLimit({
		name: 'user',
		keyFn: (req) => {
			const userKey = getUserKey(req);
			return userKey ? `user:${userKey}` : null;
		},
		skipIfNoKey: true,
		...opts,
	});
}

module.exports = {
	rateLimit,
	ipRateLimit,
	userRateLimit,
	getUserKey,
};