const express = require('express');
const router = express.Router();
const { dbClient } = require('../../services/config');
const { requireTenantAuth } = require('../../services/tenantAuth');

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
      .select('id, from_email as sender, subject, body, received_at, assigned_to, is_read as read, created_at')
      .eq('tenant_id', tenantId)
      .order('received_at', { ascending: false });

    if (error) throw error;

    res.json({ success: true, emails: data || [] });
  } catch (e) {
    console.error('[EMAIL_LIST] error:', e?.message || e);
    res.status(500).json({ success: false, error: 'Failed to list emails' });
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
