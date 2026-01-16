const crypto = require('crypto');
const { google } = require('googleapis');
const { dbClient } = require('./config');

function env(name, fallback = '') {
  return (process.env[name] ?? fallback);
}

function getRedirectUri() {
  return (
    env('GOOGLE_REDIRECT_URI') ||
    env('GMAIL_REDIRECT_URI') ||
    'https://salesmate.saksolution.com/api/email/gmail/callback'
  );
}

function getOAuth2Client() {
  const clientId = env('GOOGLE_CLIENT_ID') || env('GMAIL_CLIENT_ID');
  const clientSecret = env('GOOGLE_CLIENT_SECRET') || env('GMAIL_CLIENT_SECRET');
  const redirectUri = getRedirectUri();

  if (!clientId || !clientSecret) {
    const e = new Error('Missing Google OAuth credentials');
    e.code = 'MISSING_GOOGLE_OAUTH';
    throw e;
  }

  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

function makeOAuthState() {
  return crypto.randomBytes(24).toString('hex');
}

function headerValue(headers, name) {
  const n = String(name || '').toLowerCase();
  const h = Array.isArray(headers) ? headers : [];
  const found = h.find(x => String(x?.name || '').toLowerCase() === n);
  return found?.value || null;
}

function decodeBase64Url(data) {
  if (!data) return '';
  const s = String(data).replace(/-/g, '+').replace(/_/g, '/');
  const pad = s.length % 4;
  const padded = pad ? s + '='.repeat(4 - pad) : s;
  return Buffer.from(padded, 'base64').toString('utf8');
}

function extractBodyFromPayload(payload) {
  if (!payload) return '';

  // Prefer text/plain part when present
  const mime = String(payload.mimeType || '').toLowerCase();
  if (mime === 'text/plain' && payload.body?.data) {
    return decodeBase64Url(payload.body.data);
  }

  // Fallback to snippet-like body data
  if (payload.body?.data) {
    return decodeBase64Url(payload.body.data);
  }

  const parts = Array.isArray(payload.parts) ? payload.parts : [];
  for (const part of parts) {
    const partMime = String(part.mimeType || '').toLowerCase();
    if (partMime === 'text/plain' && part.body?.data) {
      return decodeBase64Url(part.body.data);
    }
  }

  // Deep search
  for (const part of parts) {
    const nested = extractBodyFromPayload(part);
    if (nested) return nested;
  }

  return '';
}

async function getTenantGmailConnection(tenantId) {
  const { data: tenant, error } = await dbClient
    .from('tenants')
    .select('id, gmail_connected_email, gmail_refresh_token, gmail_access_token, gmail_token_expiry, gmail_history_id')
    .eq('id', String(tenantId))
    .maybeSingle();

  if (error) throw error;
  return tenant || null;
}

async function getAuthedGmailClient(tenantId) {
  const tenant = await getTenantGmailConnection(tenantId);
  if (!tenant?.gmail_refresh_token) {
    const e = new Error('Gmail not connected');
    e.code = 'GMAIL_NOT_CONNECTED';
    throw e;
  }

  const oauth2Client = getOAuth2Client();
  oauth2Client.setCredentials({
    refresh_token: tenant.gmail_refresh_token,
    access_token: tenant.gmail_access_token || undefined,
    expiry_date: tenant.gmail_token_expiry ? Number(tenant.gmail_token_expiry) : undefined,
  });

  const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
  return { gmail, oauth2Client, tenant };
}

async function upsertEmailEnquiry({
  tenantId,
  fromEmail,
  subject,
  body,
  receivedAt,
  messageId,
  threadId,
  raw,
}) {
  const row = {
    tenant_id: String(tenantId),
    from_email: fromEmail ? String(fromEmail) : null,
    subject: subject ? String(subject) : null,
    body: body ? String(body) : null,
    received_at: receivedAt ? String(receivedAt) : new Date().toISOString(),
    message_id: messageId ? String(messageId) : null,
    thread_id: threadId ? String(threadId) : null,
    raw: raw ? JSON.stringify(raw) : null,
    created_at: new Date().toISOString(),
  };

  // Dedupe: prefer ignoring conflict when message_id exists
  if (row.message_id) {
    try {
      const { data, error } = await dbClient
        .from('email_enquiries')
        .upsert(row, { onConflict: 'tenant_id,message_id', ignoreDuplicates: true })
        .select('id')
        .maybeSingle();

      if (!error) return data || null;
    } catch (_) {
      // fall through to insert fallback
    }

    // Some adapters don't support upsert(ignoreDuplicates); fail-open by inserting.
    try {
      const r2 = await dbClient.from('email_enquiries').insert(row).select('id').maybeSingle();
      if (r2.error) throw r2.error;
      return r2.data || null;
    } catch (e2) {
      // If it's a unique constraint, treat as ok.
      const msg = String(e2?.message || e2 || '');
      if (msg.toLowerCase().includes('unique') || msg.toLowerCase().includes('constraint')) return null;
      throw e2;
    }
  }

  const { data, error } = await dbClient.from('email_enquiries').insert(row).select('id').maybeSingle();
  if (error) throw error;
  return data || null;
}

async function ingestGmailMessage(tenantId, message) {
  const id = message?.id || null;
  const threadId = message?.threadId || null;
  const payload = message?.payload || null;
  const headers = payload?.headers || [];

  const from = headerValue(headers, 'From');
  const subject = headerValue(headers, 'Subject');
  const dateHeader = headerValue(headers, 'Date');

  let receivedAt = null;
  if (dateHeader) {
    const d = new Date(dateHeader);
    if (!Number.isNaN(d.getTime())) receivedAt = d.toISOString();
  }

  const body = extractBodyFromPayload(payload) || message?.snippet || '';

  return upsertEmailEnquiry({
    tenantId,
    fromEmail: from,
    subject,
    body,
    receivedAt,
    messageId: id,
    threadId,
    raw: message,
  });
}

async function startWatch({ tenantId, topicName }) {
  const { gmail } = await getAuthedGmailClient(tenantId);

  const topic = topicName || env('GMAIL_PUBSUB_TOPIC');
  if (!topic) return { ok: false, skipped: true, reason: 'No topic configured' };

  const resp = await gmail.users.watch({
    userId: 'me',
    requestBody: {
      topicName: topic,
      labelIds: ['INBOX'],
    },
  });

  const historyId = resp?.data?.historyId ? String(resp.data.historyId) : null;
  const expiration = resp?.data?.expiration ? String(resp.data.expiration) : null;

  try {
    await dbClient
      .from('tenants')
      .update({
        gmail_history_id: historyId,
        gmail_watch_expiry: expiration,
      })
      .eq('id', String(tenantId));
  } catch (_) {}

  return { ok: true, historyId, expiration };
}

async function syncLatestMessages({ tenantId, maxResults = 10 }) {
  const { gmail } = await getAuthedGmailClient(tenantId);

  const list = await gmail.users.messages.list({
    userId: 'me',
    q: 'in:inbox',
    maxResults: Math.max(1, Math.min(50, Number(maxResults) || 10)),
  });

  const msgs = Array.isArray(list?.data?.messages) ? list.data.messages : [];
  let ingested = 0;

  for (const m of msgs) {
    if (!m?.id) continue;
    const full = await gmail.users.messages.get({ userId: 'me', id: m.id, format: 'full' });
    await ingestGmailMessage(tenantId, full?.data);
    ingested += 1;
  }

  return { ingested };
}

async function processPubSubNotification({ emailAddress, historyId }) {
  // We store a single mailbox connection per tenant; find tenant by connected_email.
  const addr = String(emailAddress || '').trim();
  if (!addr) {
    const e = new Error('Missing emailAddress in notification');
    e.code = 'BAD_NOTIFICATION';
    throw e;
  }

  const { data: tenant, error } = await dbClient
    .from('tenants')
    .select('id, gmail_history_id')
    .eq('gmail_connected_email', addr)
    .maybeSingle();

  if (error) throw error;
  if (!tenant?.id) {
    return { ok: true, skipped: true, reason: 'No tenant bound to this email' };
  }

  const tenantId = tenant.id;
  const prevHistoryId = tenant.gmail_history_id ? String(tenant.gmail_history_id) : null;

  // First event: store and stop (we need a baseline)
  if (!prevHistoryId) {
    await dbClient
      .from('tenants')
      .update({ gmail_history_id: String(historyId || '') || null })
      .eq('id', String(tenantId));

    return { ok: true, tenantId, ingested: 0, baselineSet: true };
  }

  const { gmail } = await getAuthedGmailClient(tenantId);

  const hist = await gmail.users.history.list({
    userId: 'me',
    startHistoryId: prevHistoryId,
    historyTypes: ['messageAdded'],
  });

  const history = Array.isArray(hist?.data?.history) ? hist.data.history : [];
  const messageIds = new Set();

  for (const h of history) {
    const added = Array.isArray(h?.messagesAdded) ? h.messagesAdded : [];
    for (const ma of added) {
      const mid = ma?.message?.id;
      if (mid) messageIds.add(String(mid));
    }
  }

  let ingested = 0;
  for (const mid of messageIds) {
    const full = await gmail.users.messages.get({ userId: 'me', id: mid, format: 'full' });
    await ingestGmailMessage(tenantId, full?.data);
    ingested += 1;
  }

  // Advance stored history id to latest from notification
  if (historyId) {
    try {
      await dbClient
        .from('tenants')
        .update({ gmail_history_id: String(historyId) })
        .eq('id', String(tenantId));
    } catch (_) {}
  }

  return { ok: true, tenantId, ingested };
}

module.exports = {
  getRedirectUri,
  getOAuth2Client,
  makeOAuthState,
  getTenantGmailConnection,
  getAuthedGmailClient,
  ingestGmailMessage,
  syncLatestMessages,
  startWatch,
  processPubSubNotification,
};

