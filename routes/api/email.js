const express = require('express');
const router = express.Router();
const { dbClient, db } = require('../../services/config');
const { requireTenantAuth } = require('../../services/tenantAuth');
const crypto = require('crypto');
const assignmentService = require('../../services/assignmentService');
const heatScoringService = require('../../services/heatScoringService');
const {
  getOAuth2Client,
  makeOAuthState,
  getRedirectUri,
  startWatch,
  syncLatestMessages,
  processPubSubNotification,
} = require('../../services/gmailService');

// Inbound email ingest (integration)
// Auth: API key preferred; Bearer also accepted.
router.post('/inbound', requireTenantAuth({ requireMatchParamTenantId: false }), async (req, res) => {
  try {
    const tenantId = String(req.auth?.tenantId || '');
    if (!tenantId) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const { from, subject, body, receivedAt, raw } = req.body || {};

    const row = {
      tenant_id: tenantId,
      from_email: from ? String(from) : null,
      subject: subject ? String(subject) : null,
      body: body ? String(body) : null,
      received_at: receivedAt ? String(receivedAt) : new Date().toISOString(),
      raw: raw ? JSON.stringify(raw) : null,
      created_at: new Date().toISOString(),
    };

    const { data, error } = await dbClient
      .from('email_enquiries')
      .insert(row)
      .select('id, tenant_id, from_email, subject, received_at, created_at')
      .single();

    if (error) throw error;

    res.json({ success: true, enquiry: data });
  } catch (e) {
    console.error('[EMAIL_INGEST] inbound error:', e?.message || e);
    res.status(500).json({ success: false, error: 'Failed to ingest email' });
  }
});

// List email enquiries for a tenant
router.get('/list', async (req, res) => {
  try {
    // Accept API key from query param or header
    const queryKey = req.query.key;
    if (queryKey && !req.get('x-api-key')) {
      req.headers['x-api-key'] = queryKey;
    }
    
    const auth = await require('../../services/tenantAuth').authenticateRequest(req);
    const tenantId = String(auth.tenantId);
    
    const limit = Math.min(parseInt(req.query.limit) || 50, 100);
    const offset = parseInt(req.query.offset) || 0;
    const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
    const readFilter = typeof req.query.read === 'string' ? req.query.read.trim().toLowerCase() : '';

    const whereParts = ['tenant_id = ?'];
    const params = [tenantId];

    if (search) {
      whereParts.push('(COALESCE(from_email, \'\') LIKE ? OR COALESCE(subject, \'\') LIKE ? OR COALESCE(body, \'\') LIKE ?)');
      const q = `%${search}%`;
      params.push(q, q, q);
    }

    if (readFilter === 'read') {
      whereParts.push('COALESCE(is_read, 0) = 1');
    } else if (readFilter === 'unread') {
      whereParts.push('COALESCE(is_read, 0) = 0');
    }

    const whereSql = whereParts.length ? `WHERE ${whereParts.join(' AND ')}` : '';

    const emails = db
      .prepare(
        `
      SELECT
        id,
        tenant_id,
        from_email,
        subject,
        body,
        received_at,
        message_id,
        thread_id,
        COALESCE(snippet, '') AS snippet,
        COALESCE(is_read, 0) AS is_read,
        read_at,
        lead_conversation_id,
        lead_customer_profile_id,
        lead_created_at,
        created_at
      FROM email_enquiries
      ${whereSql}
      ORDER BY COALESCE(received_at, created_at) DESC
      LIMIT ? OFFSET ?
    `
      )
      .all(...params, limit, offset);

    const total = db
      .prepare(
        `
      SELECT COUNT(*) as count
      FROM email_enquiries
      ${whereSql}
    `
      )
      .get(...params);

    res.json({
      success: true,
      emails,
      total: total.count,
      limit,
      offset,
    });
  } catch (e) {
    console.error('[EMAIL_LIST] error:', e?.message || e);
    res.status(500).json({ success: false, error: 'Failed to list emails' });
  }
});

function normalizeEmailAddress(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  // Handles "Name <email@x.com>"; fallback to raw.
  const match = s.match(/<([^>]+)>/);
  const email = (match ? match[1] : s).trim().toLowerCase();
  if (!email || !email.includes('@')) return null;
  return email;
}

function extractDisplayName(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  const match = s.match(/^\s*([^<]+?)\s*<[^>]+>\s*$/);
  const name = (match ? match[1] : '').trim();
  return name || null;
}

function makeHexId() {
  return crypto.randomBytes(16).toString('hex');
}

// Create a Salesmate lead from an email enquiry (native Salesmate flow)
// POST /api/email/:emailId/create-lead
router.post('/:emailId/create-lead', async (req, res) => {
  try {
    const queryKey = req.query.key;
    if (queryKey && !req.get('x-api-key')) {
      req.headers['x-api-key'] = queryKey;
    }

    const auth = await require('../../services/tenantAuth').authenticateRequest(req);
    const tenantId = String(auth?.tenantId || '');
    if (!tenantId) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const emailId = String(req.params.emailId || '').trim();
    if (!emailId) return res.status(400).json({ success: false, error: 'emailId required' });

    const now = new Date().toISOString();

    const tx = db.transaction(() => {
      const email = db
        .prepare(
          `
        SELECT *
        FROM email_enquiries
        WHERE id = ? AND tenant_id = ?
        LIMIT 1
      `
        )
        .get(emailId, tenantId);

      if (!email) {
        const err = new Error('Email not found');
        err.status = 404;
        throw err;
      }

      // Idempotency: if we've already created a lead, return it.
      if (email.lead_conversation_id) {
        const conv = db
          .prepare('SELECT id, tenant_id, phone_number, end_user_phone, assigned_to, heat, created_at, updated_at FROM conversations WHERE id = ?')
          .get(String(email.lead_conversation_id));

        return {
          email,
          customer: email.lead_customer_profile_id
            ? db.prepare('SELECT id, tenant_id, phone_number, name, email FROM customer_profiles WHERE id = ?').get(String(email.lead_customer_profile_id))
            : null,
          conversation: conv || { id: String(email.lead_conversation_id) },
          created: false,
        };
      }

      const fromEmail = normalizeEmailAddress(email.from_email);
      const fromName = extractDisplayName(email.from_email);
      if (!fromEmail) {
        const err = new Error('Email enquiry has no valid from_email');
        err.status = 400;
        throw err;
      }

      const syntheticPhone = `email:${fromEmail}`;

      // Upsert customer profile by synthetic phone.
      let customer = db
        .prepare('SELECT * FROM customer_profiles WHERE tenant_id = ? AND phone_number = ? LIMIT 1')
        .get(tenantId, syntheticPhone);

      if (!customer) {
        const customerId = makeHexId();
        db.prepare(
          `
          INSERT INTO customer_profiles (id, tenant_id, phone_number, name, email, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `
        ).run(customerId, tenantId, syntheticPhone, fromName, fromEmail, now, now);

        customer = db.prepare('SELECT * FROM customer_profiles WHERE id = ?').get(customerId);
      } else {
        const nextName = customer.name || fromName || null;
        const nextEmail = customer.email || fromEmail || null;
        db.prepare('UPDATE customer_profiles SET name = ?, email = ?, updated_at = ? WHERE id = ?')
          .run(nextName, nextEmail, now, customer.id);
        customer = db.prepare('SELECT * FROM customer_profiles WHERE id = ?').get(customer.id);
      }

      const conversationId = makeHexId();
      const subject = email.subject ? String(email.subject) : '';
      const body = email.body ? String(email.body) : '';
      const receivedAt = email.received_at || email.created_at || now;
      const messageText = `Email Lead\nFrom: ${fromEmail}\nSubject: ${subject}\n\n${body}`.trim();

      const context = JSON.stringify({
        source: 'email',
        email_enquiry_id: emailId,
        from_email: fromEmail,
        subject,
        received_at: receivedAt,
      });

      // Create conversation (use base columns that exist in all schemas)
      db.prepare(
        `
        INSERT INTO conversations (id, tenant_id, customer_profile_id, phone_number, state, context, last_message_time, is_active, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
      `
      ).run(conversationId, tenantId, customer.id, syntheticPhone, 'EMAIL_LEAD', context, receivedAt, now, now);

      // Best-effort optional fields (safe when columns exist)
      try {
        db.prepare(
          `
          UPDATE conversations
          SET end_user_phone = ?, last_message_at = ?, status = 'OPEN', last_activity_at = COALESCE(last_activity_at, ?)
          WHERE id = ? AND tenant_id = ?
        `
        ).run(syntheticPhone, receivedAt, receivedAt, conversationId, tenantId);
      } catch (_) {}

      // Insert initial message
      const messageId = makeHexId();
      db.prepare(
        `
        INSERT INTO messages (id, tenant_id, conversation_id, sender, message_body, message_type, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `
      ).run(messageId, tenantId, conversationId, 'EMAIL', messageText, 'email', receivedAt);

      // Mark email enquiry as processed + read
      const snippet = (body || subject || '').replace(/\s+/g, ' ').trim().slice(0, 200);
      db.prepare(
        `
        UPDATE email_enquiries
        SET
          snippet = COALESCE(snippet, ?),
          is_read = 1,
          read_at = COALESCE(read_at, ?),
          lead_conversation_id = ?,
          lead_customer_profile_id = ?,
          lead_created_at = ?
        WHERE id = ? AND tenant_id = ?
      `
      ).run(snippet, now, conversationId, customer.id, now, emailId, tenantId);

      const conversation = db
        .prepare('SELECT id, tenant_id, phone_number, end_user_phone, assigned_to, heat, created_at, updated_at FROM conversations WHERE id = ?')
        .get(conversationId);

      const updatedEmail = db
        .prepare('SELECT * FROM email_enquiries WHERE id = ? AND tenant_id = ? LIMIT 1')
        .get(emailId, tenantId);

      return { email: updatedEmail, customer, conversation, created: true };
    });

    const { email, customer, conversation, created } = tx();

    // Trigger heat scoring + assignment (non-blocking best-effort)
    let heatResult = null;
    let assignmentResult = null;

    try {
      const body = email?.body ? String(email.body) : '';
      const subject = email?.subject ? String(email.subject) : '';
      const msg = `${subject}\n${body}`.trim();
      if (msg) {
        heatResult = await heatScoringService.analyzeAndUpdateHeat(tenantId, conversation.id, msg, { useAI: false });
      }
    } catch (e) {
      console.warn('[EMAIL] heat scoring skipped:', e?.message || e);
    }

    try {
      assignmentResult = await assignmentService.assignConversation(tenantId, conversation.id);
    } catch (e) {
      console.warn('[EMAIL] assignment skipped:', e?.message || e);
    }

    let assignedSalesman = null;
    try {
      const refreshed = db
        .prepare('SELECT assigned_to, heat FROM conversations WHERE id = ? AND tenant_id = ?')
        .get(conversation.id, tenantId);
      if (refreshed?.assigned_to) {
        assignedSalesman = db.prepare('SELECT id, name, phone FROM salesman WHERE id = ? AND tenant_id = ?').get(refreshed.assigned_to, tenantId);
      }
    } catch (_) {}

    return res.json({
      success: true,
      created,
      email,
      customer,
      conversation,
      heat: heatResult,
      assignment: assignmentResult,
      assignedSalesman,
    });
  } catch (e) {
    const status = e?.status || 500;
    console.error('[EMAIL] create-lead error:', e?.message || e);
    return res.status(status).json({ success: false, error: e?.message || 'Failed to create lead from email' });
  }
});

// ---- Gmail OAuth + Pub/Sub integration (optional)

// Start OAuth flow (redirects to Google)
// Accepts API key via header (X-API-Key) or query param (key) for browser convenience
router.get('/gmail/auth', async (req, res) => {
  try {
    // Allow API key from query param for browser-friendly URLs
    const queryKey = req.query.key;
    if (queryKey && !req.get('x-api-key')) {
      req.headers['x-api-key'] = queryKey;
    }
    
    // Authenticate
    const { authenticateRequest } = require('../../services/tenantAuth');
    const auth = await authenticateRequest(req);
    if (!auth?.tenantId) return res.status(401).send('Unauthorized - provide API key via X-API-Key header or ?key= param');
    
    const tenantId = String(auth.tenantId);
    if (!tenantId) return res.status(401).send('Unauthorized');

    const state = makeOAuthState();

    // Persist state to prevent CSRF/mis-binds
    await dbClient
      .from('tenants')
      .update({
        gmail_oauth_state: state,
        gmail_oauth_state_created_at: new Date().toISOString(),
      })
      .eq('id', tenantId);

    const oauth2Client = getOAuth2Client();
    const authUrl = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      scope: [
        'https://www.googleapis.com/auth/gmail.readonly',
        'https://www.googleapis.com/auth/gmail.modify',
      ],
      state,
    });

    return res.redirect(authUrl);
  } catch (e) {
    console.error('[GMAIL] auth start error:', e?.message || e);
    res.status(500).send('Failed to start Gmail auth');
  }
});

// OAuth callback endpoint configured in Google Console
router.get('/gmail/callback', async (req, res) => {
  try {
    const code = typeof req.query.code === 'string' ? req.query.code : '';
    const state = typeof req.query.state === 'string' ? req.query.state : '';
    const err = typeof req.query.error === 'string' ? req.query.error : '';

    if (err) {
      return res.status(400).send(`Gmail auth denied: ${err}`);
    }
    if (!code || !state) {
      return res.status(400).send('Missing code/state');
    }

    const { data: tenant, error: tenantErr } = await dbClient
      .from('tenants')
      .select('id, gmail_oauth_state, gmail_refresh_token')
      .eq('gmail_oauth_state', state)
      .maybeSingle();
    if (tenantErr) throw tenantErr;
    if (!tenant?.id) return res.status(400).send('Invalid state');

    const oauth2Client = getOAuth2Client();
    const tokenResponse = await oauth2Client.getToken(code);
    const tokens = tokenResponse?.tokens || {};

    oauth2Client.setCredentials(tokens);

    // Get connected email
    const { google } = require('googleapis');
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
    const profile = await gmail.users.getProfile({ userId: 'me' });
    const connectedEmail = profile?.data?.emailAddress ? String(profile.data.emailAddress) : null;

    await dbClient
      .from('tenants')
      .update({
        gmail_connected_email: connectedEmail,
        gmail_refresh_token: tokens.refresh_token || tenant.gmail_refresh_token || null,
        gmail_access_token: tokens.access_token || null,
        gmail_token_expiry: tokens.expiry_date ? String(tokens.expiry_date) : null,
        gmail_oauth_state: null,
        gmail_oauth_state_created_at: null,
      })
      .eq('id', String(tenant.id));

    // Optional: start watch if topic configured
    let watchResult = null;
    try {
      watchResult = await startWatch({ tenantId: tenant.id });
    } catch (e) {
      console.warn('[GMAIL] watch start failed:', e?.message || e);
    }

    const redirect = process.env.WEB_DASHBOARD_URL || '/dashboard.html';
    res.status(200).send(
      `Gmail connected for ${connectedEmail || 'account'}. Redirect URI: ${getRedirectUri()}\n\nWatch: ${JSON.stringify(watchResult)}\n\nOpen: ${redirect}`
    );
  } catch (e) {
    console.error('[GMAIL] callback error:', e?.message || e);
    res.status(500).send('Failed to complete Gmail auth');
  }
});

// Status for dashboard
router.get('/gmail/status', async (req, res) => {
  try {
    const queryKey = req.query.key;
    if (queryKey && !req.get('x-api-key')) {
      req.headers['x-api-key'] = queryKey;
    }
    
    const { authenticateRequest } = require('../../services/tenantAuth');
    const auth = await authenticateRequest(req);
    if (!auth?.tenantId) return res.status(401).json({ success: false, error: 'Unauthorized' });
    
    const tenantId = String(auth.tenantId);
    if (!tenantId) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const { data: tenant, error } = await dbClient
      .from('tenants')
      .select('id, gmail_connected_email, gmail_watch_expiry, gmail_history_id')
      .eq('id', tenantId)
      .maybeSingle();
    if (error) throw error;

    res.json({
      success: true,
      gmail: {
        connected: !!tenant?.gmail_connected_email,
        connected_email: tenant?.gmail_connected_email || null,
        watch_expiry: tenant?.gmail_watch_expiry || null,
        history_id: tenant?.gmail_history_id || null,
        redirect_uri: getRedirectUri(),
      },
    });
  } catch (e) {
    console.error('[GMAIL] status error:', e?.message || e);
    res.status(500).json({ success: false, error: 'Failed to get Gmail status' });
  }
});

// Manual sync (fetches latest inbox messages)
router.post('/gmail/sync', async (req, res) => {
  try {
    const queryKey = req.query.key;
    if (queryKey && !req.get('x-api-key')) {
      req.headers['x-api-key'] = queryKey;
    }
    
    const { authenticateRequest } = require('../../services/tenantAuth');
    const auth = await authenticateRequest(req);
    if (!auth?.tenantId) return res.status(401).json({ success: false, error: 'Unauthorized' });
    
    const tenantId = String(auth.tenantId);
    if (!tenantId) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const maxResults = req.body?.maxResults;
    const r = await syncLatestMessages({ tenantId, maxResults });
    res.json({ success: true, ...r });
  } catch (e) {
    console.error('[GMAIL] sync error:', e?.message || e);
    const code = e?.code || '';
    const status = code === 'GMAIL_NOT_CONNECTED' ? 400 : 500;
    res.status(status).json({ success: false, error: e?.message || 'Failed to sync Gmail' });
  }
});

// Pub/Sub push endpoint
// Configure your Pub/Sub subscription to push to:
//   https://salesmate.saksolution.com/api/email/gmail/pubsub?token=YOUR_TOKEN
router.post('/gmail/pubsub', async (req, res) => {
  try {
    const expected = process.env.GMAIL_PUBSUB_TOKEN || '';
    const token = String(req.query.token || req.get('x-pubsub-token') || '');
    if (expected && token !== expected) {
      return res.status(403).json({ success: false, error: 'forbidden' });
    }

    const msg = req.body?.message || null;
    const dataB64 = msg?.data || '';
    if (!dataB64) return res.status(200).json({ success: true, skipped: true });

    const decoded = Buffer.from(String(dataB64), 'base64').toString('utf8');
    let payload = null;
    try {
      payload = JSON.parse(decoded);
    } catch {
      payload = null;
    }

    const emailAddress = payload?.emailAddress || payload?.email || null;
    const historyId = payload?.historyId || null;

    const out = await processPubSubNotification({ emailAddress, historyId });
    res.status(200).json({ success: true, ...out });
  } catch (e) {
    console.error('[GMAIL] pubsub error:', e?.message || e);
    // Return 200 so Pub/Sub doesn't retry forever for non-transient issues
    res.status(200).json({ success: false, error: 'pubsub error' });
  }
});

module.exports = router;
