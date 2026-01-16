/**
 * Salesmen Management API Routes
 */

const express = require('express');
const router = express.Router();
const { db } = require('../../services/config');
const { getActiveSalesmen, getSalesmanWorkload } = require('../../services/assignmentService');
const { sendMessage } = require('../../services/whatsappService');
const { getClientStatus, sendWebMessage } = require('../../services/whatsappWebService');

/**
 * GET /api/salesmen/:tenantId
 * Get all salesmen for tenant
 */
router.get('/:tenantId', (req, res) => {
  try {
    const { tenantId } = req.params;
    
    const salesmen = db.prepare(`
      SELECT * FROM salesman
      WHERE tenant_id = ?
      ORDER BY active DESC, name ASC
    `).all(tenantId);
    
    // Add workload to each salesman
    const salesmenWithWorkload = salesmen.map(salesman => ({
      ...salesman,
      current_workload: getSalesmanWorkload(tenantId, salesman.id),
      product_skills: salesman.product_skills ? JSON.parse(salesman.product_skills) : [],
      language_skills: salesman.language_skills ? JSON.parse(salesman.language_skills) : []
    }));
    
    res.json({ success: true, salesmen: salesmenWithWorkload });
  } catch (error) {
    console.error('Error fetching salesmen:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/salesmen/:tenantId/:salesmanId
 * Get single salesman details
 */
router.get('/:tenantId/:salesmanId', (req, res) => {
  try {
    const { tenantId, salesmanId } = req.params;
    
    const salesman = db.prepare('SELECT * FROM salesman WHERE id = ? AND tenant_id = ?')
      .get(salesmanId, tenantId);
    
    if (!salesman) {
      return res.status(404).json({ success: false, error: 'Salesman not found' });
    }
    
    // Add workload
    salesman.current_workload = getSalesmanWorkload(tenantId, salesmanId);
    salesman.product_skills = salesman.product_skills ? JSON.parse(salesman.product_skills) : [];
    salesman.language_skills = salesman.language_skills ? JSON.parse(salesman.language_skills) : [];
    
    res.json({ success: true, salesman });
  } catch (error) {
    console.error('Error fetching salesman:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/salesmen/:tenantId
 * Create new salesman
 */
router.post('/:tenantId', (req, res) => {
  try {
    const { tenantId } = req.params;
    const { name, email, phone, max_leads_per_month, product_skills, language_skills, geographic_zone } = req.body;
    
    if (!name) {
      return res.status(400).json({ success: false, error: 'Name is required' });
    }
    
    const result = db.prepare(`
      INSERT INTO salesman (
        tenant_id, name, email, phone, 
        max_leads_per_month, product_skills, language_skills, geographic_zone
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      tenantId,
      name,
      email || null,
      phone || null,
      max_leads_per_month || 50,
      product_skills ? JSON.stringify(product_skills) : null,
      language_skills ? JSON.stringify(language_skills) : null,
      geographic_zone || null
    );
    
    const salesman = db.prepare('SELECT * FROM salesman WHERE id = ?').get(result.lastInsertRowid);
    
    res.json({ success: true, salesman });
  } catch (error) {
    console.error('Error creating salesman:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * PUT /api/salesmen/:tenantId/:salesmanId
 * Update salesman
 */
router.put('/:tenantId/:salesmanId', (req, res) => {
  try {
    const { tenantId, salesmanId } = req.params;
    const { name, email, phone, max_leads_per_month, product_skills, language_skills, geographic_zone, active } = req.body;
    
    const updates = [];
    const values = [];
    
    if (name !== undefined) { updates.push('name = ?'); values.push(name); }
    if (email !== undefined) { updates.push('email = ?'); values.push(email); }
    if (phone !== undefined) { updates.push('phone = ?'); values.push(phone); }
    if (max_leads_per_month !== undefined) { updates.push('max_leads_per_month = ?'); values.push(max_leads_per_month); }
    if (product_skills !== undefined) { updates.push('product_skills = ?'); values.push(JSON.stringify(product_skills)); }
    if (language_skills !== undefined) { updates.push('language_skills = ?'); values.push(JSON.stringify(language_skills)); }
    if (geographic_zone !== undefined) { updates.push('geographic_zone = ?'); values.push(geographic_zone); }
    if (active !== undefined) { updates.push('active = ?'); values.push(active ? 1 : 0); }
    
    updates.push('updated_at = CURRENT_TIMESTAMP');
    values.push(salesmanId, tenantId);
    
    db.prepare(`
      UPDATE salesman
      SET ${updates.join(', ')}
      WHERE id = ? AND tenant_id = ?
    `).run(...values);
    
    const salesman = db.prepare('SELECT * FROM salesman WHERE id = ?').get(salesmanId);
    
    res.json({ success: true, salesman });
  } catch (error) {
    console.error('Error updating salesman:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * DELETE /api/salesmen/:tenantId/:salesmanId
 * Deactivate salesman (soft delete)
 */
router.delete('/:tenantId/:salesmanId', (req, res) => {
  try {
    const { tenantId, salesmanId } = req.params;

    db.prepare('UPDATE salesman SET active = 0 WHERE id = ? AND tenant_id = ?')
      .run(salesmanId, tenantId);
    
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting salesman:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/salesmen/:tenantId/broadcast
 * Admin: message all active salesmen (practical "call all salesman together" alternative).
 * Body: { text, fromSessionName? }
 */
router.post('/:tenantId/broadcast', async (req, res) => {
  try {
    const { tenantId } = req.params;
    const text = String(req.body?.text || '').trim();
    const fromSessionName = String(req.body?.fromSessionName || 'default');

    if (!tenantId) {
      return res.status(400).json({ success: false, error: 'Tenant ID is required' });
    }
    if (!text) {
      return res.status(400).json({ success: false, error: 'text is required' });
    }

    const salesmen = db.prepare(`
      SELECT id, name, phone, active
      FROM salesman
      WHERE tenant_id = ?
        AND active = 1
        AND phone IS NOT NULL
        AND TRIM(phone) <> ''
      ORDER BY name ASC
    `).all(tenantId);

    if (!salesmen || salesmen.length === 0) {
      return res.json({ success: true, sent: 0, failed: 0, results: [], message: 'No active salesmen with phone numbers' });
    }

    // Prefer sending via tenant's default/admin WA Web session if ready.
    let preferWeb = false;
    try {
      const status = getClientStatus(String(tenantId), fromSessionName);
      preferWeb = !!status && status.status === 'ready';
    } catch (_) {
      preferWeb = false;
    }

    const results = [];
    let sent = 0;
    let failed = 0;

    for (const s of salesmen) {
      const phone = String(s.phone || '').trim();
      if (!phone) continue;

      try {
        let messageId = null;
        if (preferWeb) {
          const r = await sendWebMessage(String(tenantId), phone, text, fromSessionName);
          messageId = r?.messageId || r?.message_id || null;
        }

        if (!messageId) {
          messageId = await sendMessage(phone, text, String(tenantId));
        }

        if (messageId) {
          sent += 1;
          results.push({ salesmanId: s.id, name: s.name, phone, success: true, messageId });
        } else {
          failed += 1;
          results.push({ salesmanId: s.id, name: s.name, phone, success: false, error: 'send_failed' });
        }
      } catch (e) {
        failed += 1;
        results.push({ salesmanId: s.id, name: s.name, phone, success: false, error: e?.message || String(e) });
      }

      // Small delay to reduce risk of rate limiting / spiky load.
      await new Promise(r => setTimeout(r, 120));
    }

    return res.json({ success: true, sent, failed, results });
  } catch (error) {
    console.error('Error broadcasting to salesmen:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/salesmen/:tenantId/:salesmanId/workload
 * Get salesman's current workload details
 */
router.get('/:tenantId/:salesmanId/workload', (req, res) => {
  try {
    const { tenantId, salesmanId } = req.params;

    const activeLeads = db.prepare(`
      SELECT c.*, cp.name, cp.phone_number
      FROM conversations c
      LEFT JOIN customer_profiles cp ON c.end_user_phone = cp.phone_number
      WHERE c.tenant_id = ? AND c.assigned_to = ? AND c.status = 'OPEN'
      ORDER BY c.last_activity_at DESC
    `).all(tenantId, salesmanId);
    
    const stats = {
      total_active: activeLeads.length,
      by_heat: {
        ON_FIRE: activeLeads.filter(l => l.heat === 'ON_FIRE').length,
        VERY_HOT: activeLeads.filter(l => l.heat === 'VERY_HOT').length,
        HOT: activeLeads.filter(l => l.heat === 'HOT').length,
        WARM: activeLeads.filter(l => l.heat === 'WARM').length,
        COLD: activeLeads.filter(l => l.heat === 'COLD').length
      }
    };
    
    res.json({ success: true, workload: stats, leads: activeLeads });
  } catch (error) {
    console.error('Error fetching workload:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;

