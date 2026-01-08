# SAK‑SMS Feature Summary (Current Repo)

Date: 2026-01-08

This repository implements a **multi-tenant WhatsApp AI Sales Assistant** with a web dashboard, lead/follow-up tracking, broadcast messaging, and Zoho integration.

> Note: The list below is **based on what is present in the codebase today**. Some CRM features (triage center, role-based users/salesmen, Gmail ingestion, Salesmate webhook, SLA rules) are not present in this repo at the time of writing.

## Dashboard (Web)

- Static dashboard UI served from `public/` (see server wiring in [index.js](index.js#L1)).
- Dashboard login supports a **magic token** flow:
  - Verify token: `GET /api/dashboard/verify-token?token=...` and `POST /api/dashboard/verify-token` ([routes/api/dashboard.js](routes/api/dashboard.js#L1)).
  - There is also an API-level token verification flow under `POST /api/verify-token` ([routes/api.js](routes/api.js#L1)).
- Dashboard APIs include (at minimum):
  - Conversations listing endpoints (multiple handlers exist in [routes/api/dashboard.js](routes/api/dashboard.js#L1)).
  - Follow-ups + lead views: see “Leads & Follow-ups” below.
  - Document upload + knowledge ingestion endpoints (see below).

## Leads & Follow-ups (Conversation-based)

This repo treats **a “lead” as a conversation** (a person chatting with the bot), enriched with computed/derived fields.

- Lead type (hot/warm/new/cold) is derived from recency and can be stored back to the DB:
  - `GET /api/followups/:tenantId/leads` ([routes/api/followups.js](routes/api/followups.js#L168)).
- Follow-up scheduling and tracking:
  - `GET /api/followups/:tenantId` and `GET /api/followups/:tenantId/stats` ([routes/api/followups.js](routes/api/followups.js#L46)).
  - `GET /api/followups/:tenantId/conversation-by-phone?phone=...` resolves/creates a conversation id for history linking ([routes/api/followups.js](routes/api/followups.js#L30)).
- Lead scoring exists as a service:
  - [services/leadScoringService.js](services/leadScoringService.js)

## Inbound Handling / Ingestion

### WhatsApp webhook ingestion

- Primary ingestion entrypoint:
  - `POST /webhook/*` via router mounted at `app.use('/webhook', webhookRouter)` ([index.js](index.js#L1125)).
  - The webhook pipeline includes message normalization, tenant resolution, admin detection, and validation ([routes/webhook.js](routes/webhook.js#L1)).

### Desktop Agent ingestion (optional)

- Desktop agent endpoints exist to register an agent and process inbound messages:
  - `POST /api/desktop-agent/register`
  - `POST /api/desktop-agent/process-message`
  - Agent status check endpoint also exists
  - All are defined in [index.js](index.js#L1).

### Web dashboard knowledge documents

- Upload + extract text + store per tenant:
  - `POST /api/dashboard/documents/:tenantId/upload` ([routes/api/dashboard.js](routes/api/dashboard.js#L120)).
  - Listing endpoint: `GET /api/dashboard/documents/:tenantId`.

## Messaging Utilities (Templates + Broadcast)

- Broadcast API and campaign tracking exist under `/api/broadcast/*` ([index.js](index.js#L1125)).
- Message templates CRUD endpoints:
  - Create template: `POST /api/broadcast/templates`
  - List templates: `GET /api/broadcast/templates/:tenantId`
  - Delete template: `DELETE /api/broadcast/templates/:templateId`
  - Usage counter: `PUT /api/broadcast/templates/:templateId/use`
  - Implemented in [routes/api/broadcast.js](routes/api/broadcast.js#L792).

## AI / Intelligence

AI features in this repo are exposed as admin endpoints and support per-customer intelligence (memories/preferences), plus usage analytics.

- `GET /api/ai-admin/stats` provides daily call/cost summary and enablement state ([routes/api/aiAdmin.js](routes/api/aiAdmin.js#L1)).
- Memory + preference APIs:
  - `GET /api/ai-admin/memories/:customerProfileId`
  - `POST /api/ai-admin/memories`
  - `GET /api/ai-admin/preferences/:customerProfileId`
  - `PUT /api/ai-admin/preferences/:customerProfileId`
  - `GET /api/ai-admin/customer-intelligence/:customerProfileId`
  - Implemented in [routes/api/aiAdmin.js](routes/api/aiAdmin.js#L1).

## Tenancy & Access Control

- Multi-tenant data model (most queries use `tenant_id` / `tenantId`).
- Tenant registration API:
  - `POST /api/tenants/register` ([routes/api/tenants.js](routes/api/tenants.js#L1)).
- Admin concept is **owner/admin phone-based**, not role-based RBAC:
  - `isAdminGuard` checks sender phone against `owner_whatsapp_number` and `admin_phones` ([middleware/isAdminGuard.js](middleware/isAdminGuard.js#L1)).
- Tenant resolution for inbound WhatsApp messages is bot-number based:
  - [middleware/requireTenant.js](middleware/requireTenant.js#L1).

### Dashboard auth

- Magic-link style token verification exists (see “Dashboard”).
- There is also a simple password login API:
  - `POST /api/auth/login` ([routes/api/auth.js](routes/api/auth.js#L1)).

## Integrations

### Zoho

- Zoho APIs and services are present (auth + sync + sales orders). Entry route mounted at `app.use('/api/zoho', zohoRoutes)` ([index.js](index.js#L1125)).

## What’s NOT present (vs the CRM-style spec)

These features are described in your CRM spec, but **I did not find corresponding implementations** in this repo:

- Triage queue / “Triage Center” UI and triage item lifecycle.
- Sales team management (salesmen directory, capacity/limits, assignment strategies like ROUND_ROBIN/LEAST_ACTIVE for human sales assignment).
- Multi-channel ingest endpoints (generic ingest for EMAIL/PHONE/etc), secure external webhook entrypoint, and a dedicated Salesmate integration webhook.
- Gmail OAuth + polling + Gmail Pub/Sub webhook ingestion.
- A notifications center (unread counts, mark-as-read) and audit log browsing.
- SLA rules + SLA status endpoints.
- JWT cookie auth (`sak_auth`), dev header auth (`x-tenant-id`, `x-user-id`, `x-role`), and RBAC roles (OWNER/ADMIN/MANAGER/SALESMAN).

If you want, I can also produce a **“gap” checklist** that maps each missing CRM feature to a suggested folder/route location in this repo so it’s clear where to implement it.
