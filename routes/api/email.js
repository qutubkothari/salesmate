const express = require('express');
const router = express.Router();
const { dbClient } = require('../../services/config');
const { google } = require('googleapis');
const { requireTenantAuth } = require('../../services/tenantAuth');
const {
  getOAuth2Client,
  getRedirectUri,
  makeOAuthState,
  syncLatestMessages,
  startWatch,
  processPubSubNotification,
  getTenantGmailConnection
} = require('../../services/gmailService');
const { createLeadFromEmail } = require('../../services/emailLeadCaptureService');

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

// List all emails
router.get('/list', requireTenantAuth({ requireMatchParamTenantId: false }), async (req, res) => {
  try {
    const tenantId = String(req.auth?.tenantId || '');
    if (!tenantId) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const { data, error } = await dbClient
      .from('email_enquiries')
      .select('id, from_email, subject, body, received_at, assigned_to, is_read, created_at')
      .eq('tenant_id', tenantId)
      .order('received_at', { ascending: false });

    if (error) throw error;

    const emails = (data || []).map((row) => ({
      ...row,
      sender: row.from_email,
      read: row.is_read
    }));

    res.json({ success: true, emails });
  } catch (e) {
    console.error('[EMAIL_LIST] error:', e?.message || e);
    res.status(500).json({ success: false, error: 'Failed to list emails' });
  }
});

// Gmail OAuth connect
router.get('/gmail/connect', requireTenantAuth({ requireMatchParamTenantId: false }), async (req, res) => {
  try {
    const tenantId = String(req.auth?.tenantId || '');
    if (!tenantId) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const oauth2Client = getOAuth2Client();
    const state = makeOAuthState();

    await dbClient
      .from('tenants')
      .update({ gmail_oauth_state: state, gmail_oauth_state_created_at: new Date().toISOString() })
      .eq('id', tenantId);

    const authUrl = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      scope: [
        'https://www.googleapis.com/auth/gmail.readonly',
        'https://www.googleapis.com/auth/gmail.modify',
      ],
      state,
      redirect_uri: getRedirectUri()
    });

    res.json({ success: true, authUrl });
  } catch (e) {
    console.error('[EMAIL_GMAIL] connect error:', e?.message || e);
    res.status(500).json({ success: false, error: 'Failed to start Gmail connection' });
  }
});

// Gmail OAuth callback
router.get('/gmail/callback', async (req, res) => {
  try {
    const { code, state } = req.query || {};
    if (!code || !state) return res.status(400).send('Missing code/state');

    const { data: tenant, error } = await dbClient
      .from('tenants')
      .select('id')
      .eq('gmail_oauth_state', String(state))
      .maybeSingle();

    if (error || !tenant?.id) return res.status(400).send('Invalid state');

    const oauth2Client = getOAuth2Client();
    const { tokens } = await oauth2Client.getToken(String(code));
    oauth2Client.setCredentials(tokens);

    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
    const profile = await gmail.users.getProfile({ userId: 'me' });
    const connectedEmail = profile?.data?.emailAddress || null;

    await dbClient
      .from('tenants')
      .update({
        gmail_connected_email: connectedEmail,
        gmail_refresh_token: tokens.refresh_token || null,
        gmail_access_token: tokens.access_token || null,
        gmail_token_expiry: tokens.expiry_date ? String(tokens.expiry_date) : null,
        gmail_oauth_state: null,
        gmail_oauth_state_created_at: null
      })
      .eq('id', tenant.id);

    res.send('Gmail connected. You can close this tab and refresh Email tab.');
  } catch (e) {
    console.error('[EMAIL_GMAIL] callback error:', e?.message || e);
    res.status(500).send('Failed to connect Gmail');
  }
});

// Gmail sync (manual pull)
router.post('/gmail/sync', requireTenantAuth({ requireMatchParamTenantId: false }), async (req, res) => {
  try {
    const tenantId = String(req.auth?.tenantId || '');
    if (!tenantId) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const { maxResults } = req.body || {};
    const result = await syncLatestMessages({ tenantId, maxResults: maxResults || 20 });
    res.json({ success: true, ...result });
  } catch (e) {
    console.error('[EMAIL_GMAIL] sync error:', e?.message || e);
    res.status(500).json({ success: false, error: e?.message || 'Failed to sync emails' });
  }
});

// Gmail watch (optional)
router.post('/gmail/watch', requireTenantAuth({ requireMatchParamTenantId: false }), async (req, res) => {
  try {
    const tenantId = String(req.auth?.tenantId || '');
    if (!tenantId) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const { topicName } = req.body || {};
    const result = await startWatch({ tenantId, topicName });
    res.json({ success: true, ...result });
  } catch (e) {
    console.error('[EMAIL_GMAIL] watch error:', e?.message || e);
    res.status(500).json({ success: false, error: e?.message || 'Failed to start watch' });
  }
});

// Gmail status
router.get('/gmail/status', requireTenantAuth({ requireMatchParamTenantId: false }), async (req, res) => {
  try {
    const tenantId = String(req.auth?.tenantId || '');
    if (!tenantId) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const tenant = await getTenantGmailConnection(tenantId);
    res.json({
      success: true,
      connected: Boolean(tenant?.gmail_refresh_token),
      email: tenant?.gmail_connected_email || null,
      historyId: tenant?.gmail_history_id || null
    });
  } catch (e) {
    console.error('[EMAIL_GMAIL] status error:', e?.message || e);
    res.status(500).json({ success: false, error: 'Failed to load Gmail status' });
  }
});

// Gmail Pub/Sub webhook
router.post('/gmail/pubsub', async (req, res) => {
  try {
    const msg = req.body?.message?.data ? Buffer.from(req.body.message.data, 'base64').toString('utf8') : null;
    const payload = msg ? JSON.parse(msg) : {};
    const result = await processPubSubNotification({
      emailAddress: payload.emailAddress,
      historyId: payload.historyId
    });
    res.json({ success: true, ...result });
  } catch (e) {
    console.error('[EMAIL_GMAIL] pubsub error:', e?.message || e);
    res.status(200).json({ success: false });
  }
});

// Assign emails to salesperson
router.post('/assign', requireTenantAuth({ requireMatchParamTenantId: false }), async (req, res) => {
  try {
    const tenantId = String(req.auth?.tenantId || '');
    if (!tenantId) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const { emailIds, salesPersonId } = req.body || {};
    if (!Array.isArray(emailIds) || !salesPersonId) {
      return res.status(400).json({ success: false, error: 'Invalid request' });
    }

    const { data, error } = await dbClient
      .from('email_enquiries')
      .update({ assigned_to: salesPersonId })
      .eq('tenant_id', tenantId)
      .in('id', emailIds)
      .select();

    if (error) throw error;

    // Best-effort: create/update CRM lead and assign
    try {
      const rows = data || [];
      await Promise.all(rows.map((row) =>
        createLeadFromEmail({
          tenantId,
          fromEmail: row.from_email,
          fromName: null,
          subject: row.subject,
          body: row.body || '',
          salesmanId: salesPersonId,
          salesmanEmail: null
        })
      ));
    } catch (leadErr) {
      console.warn('[EMAIL_ASSIGN] Lead update failed:', leadErr?.message || leadErr);
    }

    res.json({ success: true, updated: data?.length || 0 });
  } catch (e) {
    console.error('[EMAIL_ASSIGN] error:', e?.message || e);
    res.status(500).json({ success: false, error: 'Failed to assign emails' });
  }
});

// Delete emails
router.post('/delete', requireTenantAuth({ requireMatchParamTenantId: false }), async (req, res) => {
  try {
    const tenantId = String(req.auth?.tenantId || '');
    if (!tenantId) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const { ids } = req.body || {};
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ success: false, error: 'Invalid request' });
    }

    const { data, error } = await dbClient
      .from('email_enquiries')
      .delete()
      .eq('tenant_id', tenantId)
      .in('id', ids)
      .select();

    if (error) throw error;

    res.json({ success: true, deleted: data?.length || 0 });
  } catch (e) {
    console.error('[EMAIL_DELETE] error:', e?.message || e);
    res.status(500).json({ success: false, error: 'Failed to delete emails' });
  }
});

module.exports = router;

