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

module.exports = router;
