const express = require('express');
const router = express.Router();
const { dbClient } = require('../../services/config');
const { requireTenantAuth } = require('../../services/tenantAuth');
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

    const emails = dbClient.prepare(`
      SELECT id, sender_email, subject, snippet, created_at, is_read
      FROM email_enquiries
      WHERE tenant_id = ?
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `).all(tenantId, limit, offset);

    const total = dbClient.prepare(`
      SELECT COUNT(*) as count
      FROM email_enquiries
      WHERE tenant_id = ?
    `).get(tenantId);

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
