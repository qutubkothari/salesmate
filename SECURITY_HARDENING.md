# Security Hardening Notes

This repo now includes baseline security middleware:

- **Rate limiting** for public endpoints (IP + user/tenant-based where available)
- **Schema-based request validation** (Zod) for key public endpoints
- **JSON body sanitization** (prototype-pollution key stripping)
- **Security headers** (Helmet; CSP intentionally disabled to avoid breaking the static dashboard)

## Environment variables (no secrets in client)

All external service credentials must be supplied via environment variables (never hard-coded into JS/HTML). Common ones used in this codebase:

- `OPENAI_API_KEY`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY` (server-only)
- `SUPABASE_ANON_KEY` (server-only)
- `ZOHO_CLIENT_ID`, `ZOHO_CLIENT_SECRET`, `ZOHO_REFRESH_TOKEN`
- `MAYTAPI_API_KEY` / `MAYTAPI_TOKEN` / `MAYTAPI_PHONE_ID` (legacy provider)
- `WHATSAPP_ACCESS_TOKEN` (Meta WhatsApp Cloud)
- `UPLOADCARE_PUBLIC_KEY`, `UPLOADCARE_SECRET_KEY`
- `GST_API_KEY`, `CLEARTAX_API_KEY`

### Key hygiene

- Do **not** expose any of the above in `public/` assets.
- Prefer **server-side only** tokens (Supabase service role key must never reach browsers).
- Keep `.env` uncommitted (this repo’s `.gitignore` already ignores it).

## Rotation checklist

When rotating any credential:

1. Generate a new key/token in the provider console.
2. Update the server environment variables.
3. Restart the service.
4. Verify the old key is revoked/disabled.
5. Audit logs to ensure no secrets were printed.

## Rate limiting tuning

Defaults can be overridden via env vars:

- `RATE_LIMIT_IP_PER_MIN` (default: 600)
- `RATE_LIMIT_USER_PER_MIN` (default: 300)
- `RATE_LIMIT_WEBHOOK_PER_MIN` (default: 1200)
- `RATE_LIMIT_STATUS_PER_MIN` (default: 1200)
- `TRUST_PROXY` (default: 1; set to `0` for direct-to-node)

Notes:

- `/api` and `/api_new` return **HTTP 429** on limit.
- `/webhook` and `/status` return **HTTP 200** on limit to avoid provider retries (safer for WhatsApp gateways).

## Next hardening steps (recommended)

- Add authentication/authorization checks to all dashboard APIs (some endpoints accept tenantId directly).
- Add Redis-backed rate limiting if running multiple Node workers.
- Add a real password hash (bcrypt/argon2) for `/api/auth/login` and `/change-password`.
- Consider enabling CSP by refactoring inline scripts in `public/*.html`.
