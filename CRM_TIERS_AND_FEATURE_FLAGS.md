# CRM Tiers & Feature Flags

Date: 2026-01-08

This repo supports **tier-based feature availability** with **per-tenant overrides**.

## Where feature flags live

- Tenant tier: `tenants.subscription_tier` (existing)
- Per-tenant overrides: `tenants.enabled_features` (JSON) (existing)

CRM uses stable keys defined in [services/crmFeatureFlags.js](services/crmFeatureFlags.js).

## Effective feature resolution

Order of precedence:

1. Tier defaults (Basic/Business/Enterprise mapped onto existing tiers)
2. `tenants.enabled_features` overrides

So you can ship a “Basic” version by setting tier defaults to `false` for certain CRM keys, and then selectively enable for specific tenants via overrides.

## API

- `GET /api/crm/features` (requires CRM auth) returns:
  - `defaults` (from tier)
  - `overrides` (tenant JSON)
  - `effective` (merged)

## Required env vars

- `JWT_SECRET` (or `SAK_JWT_SECRET`) for CRM JWT cookie `sak_auth`
- Optional: `JWT_EXPIRES_IN` (default `7d`)
- Optional dev header auth: set `DEV_HEADER_AUTH=1` and pass:
  - `x-tenant-id`, `x-user-id`, `x-role`

## CRM endpoints added (scaffold)

- Auth: `POST /api/crm/auth/login`, `POST /api/crm/auth/logout`, `GET /api/crm/auth/me`
- Users: `POST /api/crm/users`, `GET /api/crm/users`
- Leads: `POST /api/crm/leads`, `GET /api/crm/leads`, `GET /api/crm/leads/:leadId`, `PATCH /api/crm/leads/:leadId`, `POST /api/crm/leads/:leadId/messages`
- Ingest: `POST /api/crm/ingest` (auth), `POST /api/crm/ingest/webhook` (secret header)
- Triage: `GET /api/crm/triage`, `POST /api/crm/triage`, `PATCH /api/crm/triage/:id`
- Templates: `GET/POST/PATCH /api/crm/templates`
- Notifications: `GET /api/crm/notifications`, `GET /api/crm/notifications/unread-count`, `POST /api/crm/notifications/:id/mark-read`
- Audit logs: `GET /api/crm/audit`
- SLA: `GET/POST /api/crm/sla/rules`, `GET /api/crm/sla/status/:leadId`

## Database

- Supabase/Postgres migration: [migrations/20260108_crm_core_tables.sql](migrations/20260108_crm_core_tables.sql)
- Local mode (SQLite): schema auto-ensured in [services/config.js](services/config.js)
