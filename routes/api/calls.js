/**
 * Phone Calls API Routes
 */

const express = require('express');
const router = express.Router();
const { db } = require('../../services/config');

/**
 * GET /api/calls/:tenantId
 * Get all calls
 */
router.get('/:tenantId', (req, res) => {
  try {
    const { tenantId } = req.params;
    const { lead_id, direction, outcome } = req.query;
    
    
    let query = `
      SELECT c.*, 
              cp.name as lead_name, cp.phone_number as customer_phone,
             s.name as salesman_name
      FROM calls c
      LEFT JOIN customer_profiles cp ON c.lead_id = cp.id
      LEFT JOIN salesman s ON c.handled_by = CAST(s.id AS TEXT)
      WHERE c.tenant_id = ?
    `;
    
    const params = [tenantId];
    
    if (lead_id) {
      query += ' AND c.lead_id = ?';
      params.push(lead_id);
    }
    
    if (direction) {
      query += ' AND c.direction = ?';
      params.push(direction);
    }
    
    if (outcome) {
      query += ' AND c.outcome = ?';
      params.push(outcome);
    }
    
    query += ' ORDER BY c.created_at DESC LIMIT 100';
    
    const calls = db.prepare(query).all(...params);
    
    res.json({ success: true, calls });
  } catch (error) {
    console.error('Error fetching calls:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/calls/:tenantId/by-lead/:leadId
 * Get call history for specific lead
 */
router.get('/:tenantId/by-lead/:leadId', (req, res) => {
  try {
    const { tenantId, leadId } = req.params;
    
    
    const calls = db.prepare(`
      SELECT c.*, s.name as salesman_name
      FROM calls c
      LEFT JOIN salesman s ON c.handled_by = CAST(s.id AS TEXT)
      WHERE c.tenant_id = ? AND c.lead_id = ?
      ORDER BY c.created_at DESC
    `).all(tenantId, leadId);
    
    const stats = {
      total_calls: calls.length,
      total_duration: calls.reduce((sum, call) => sum + (call.duration_seconds || 0), 0),
      by_direction: {
        INBOUND: calls.filter(c => c.direction === 'INBOUND').length,
        OUTBOUND: calls.filter(c => c.direction === 'OUTBOUND').length
      },
      by_outcome: {
        ANSWERED: calls.filter(c => c.outcome === 'ANSWERED').length,
        NO_ANSWER: calls.filter(c => c.outcome === 'NO_ANSWER').length,
        BUSY: calls.filter(c => c.outcome === 'BUSY').length,
        VOICEMAIL: calls.filter(c => c.outcome === 'VOICEMAIL').length
      }
    };
    
    res.json({ success: true, calls, stats });
  } catch (error) {
    console.error('Error fetching call history:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/calls/:tenantId/scheduled-callbacks
 * Get upcoming scheduled callbacks
 */
router.get('/:tenantId/scheduled-callbacks', (req, res) => {
  try {
    const { tenantId } = req.params;
    
    
    const callbacks = db.prepare(`
      SELECT c.*, 
             cp.name as lead_name, cp.phone_number as customer_phone,
             s.name as salesman_name
      FROM calls c
      LEFT JOIN customer_profiles cp ON c.lead_id = cp.id
      LEFT JOIN salesman s ON c.handled_by = CAST(s.id AS TEXT)
      WHERE c.tenant_id = ? 
        AND c.scheduled_for IS NOT NULL
        AND c.scheduled_for > CURRENT_TIMESTAMP
      ORDER BY c.scheduled_for ASC
    `).all(tenantId);
    
    res.json({ success: true, callbacks });
  } catch (error) {
    console.error('Error fetching callbacks:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/calls/:tenantId
 * Log a new call
 */
router.post('/:tenantId', (req, res) => {
  try {
    const { tenantId } = req.params;
    const { 
      lead_id, conversation_id, phone_number, direction, outcome, 
      duration_seconds, notes, handled_by, scheduled_for, started_at, ended_at 
    } = req.body;
    
    if (!phone_number || !direction) {
      return res.status(400).json({ success: false, error: 'phone_number and direction are required' });
    }
    
    
    const result = db.prepare(`
      INSERT INTO calls (
        tenant_id, lead_id, conversation_id, phone_number,
        direction, outcome, duration_seconds, notes, handled_by,
        scheduled_for, started_at, ended_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      tenantId,
      lead_id || null,
      conversation_id || null,
      phone_number,
      direction,
      outcome || null,
      duration_seconds || 0,
      notes || null,
      handled_by || null,
      scheduled_for || null,
      started_at || null,
      ended_at || null
    );
    
    const call = db.prepare('SELECT * FROM calls WHERE id = ?').get(result.lastInsertRowid);
    
    // Update last_activity_at for conversation if linked
    if (conversation_id) {
      db.prepare('UPDATE conversations SET last_activity_at = CURRENT_TIMESTAMP WHERE id = ? AND tenant_id = ?')
        .run(conversation_id, tenantId);
    }
    
    res.json({ success: true, call });
  } catch (error) {
    console.error('Error logging call:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * PUT /api/calls/:tenantId/:callId
 * Update call details
 */
router.put('/:tenantId/:callId', (req, res) => {
  try {
    const { tenantId, callId } = req.params;
    const { outcome, duration_seconds, notes, recording_url } = req.body;
    
    
    const updates = [];
    const values = [];
    
    if (outcome !== undefined) { updates.push('outcome = ?'); values.push(outcome); }
    if (duration_seconds !== undefined) { updates.push('duration_seconds = ?'); values.push(duration_seconds); }
    if (notes !== undefined) { updates.push('notes = ?'); values.push(notes); }
    if (recording_url !== undefined) { updates.push('recording_url = ?'); values.push(recording_url); }
    
    values.push(callId, tenantId);
    
    db.prepare(`
      UPDATE calls
      SET ${updates.join(', ')}
      WHERE id = ? AND tenant_id = ?
    `).run(...values);
    
    const call = db.prepare('SELECT * FROM calls WHERE id = ?').get(callId);
    
    res.json({ success: true, call });
  } catch (error) {
    console.error('Error updating call:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;

