/**
 * Assignment & Heat Scoring API Routes
 */

const express = require('express');
const router = express.Router();
const { db } = require('../../services/config');
const { getAssignmentConfig, assignConversation, reassignConversation } = require('../../services/assignmentService');
const { getConversationsByHeat, getHeatDistribution, updateConversationHeat, analyzeAndUpdateHeat } = require('../../services/heatScoringService');

// ==========================================
// ASSIGNMENT ENDPOINTS
// ==========================================

/**
 * GET /api/assignment/:tenantId/config
 * Get assignment configuration
 */
router.get('/:tenantId/config', (req, res) => {
  try {
    const { tenantId } = req.params;
    const config = getAssignmentConfig(tenantId);
    
    res.json({ success: true, config });
  } catch (error) {
    console.error('Error fetching assignment config:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * PUT /api/assignment/:tenantId/config
 * Update assignment configuration
 */
router.put('/:tenantId/config', (req, res) => {
  try {
    const { tenantId } = req.params;
    const { strategy, auto_assign, consider_capacity, consider_score, consider_skills } = req.body;
    
    
    const updates = [];
    const values = [];
    
    if (strategy !== undefined) { updates.push('strategy = ?'); values.push(strategy); }
    if (auto_assign !== undefined) { updates.push('auto_assign = ?'); values.push(auto_assign ? 1 : 0); }
    if (consider_capacity !== undefined) { updates.push('consider_capacity = ?'); values.push(consider_capacity ? 1 : 0); }
    if (consider_score !== undefined) { updates.push('consider_score = ?'); values.push(consider_score ? 1 : 0); }
    if (consider_skills !== undefined) { updates.push('consider_skills = ?'); values.push(consider_skills ? 1 : 0); }
    
    updates.push('updated_at = CURRENT_TIMESTAMP');
    values.push(tenantId);
    
    db.prepare(`
      UPDATE assignment_config
      SET ${updates.join(', ')}
      WHERE tenant_id = ?
    `).run(...values);
    
    const config = getAssignmentConfig(tenantId);
    
    res.json({ success: true, config });
  } catch (error) {
    console.error('Error updating assignment config:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/assignment/:tenantId/assign/:conversationId
 * Manually trigger assignment for a conversation
 */
router.post('/:tenantId/assign/:conversationId', async (req, res) => {
  try {
    const { tenantId, conversationId } = req.params;
    const { strategy } = req.body;
    
    const result = await assignConversation(tenantId, conversationId, { strategy });
    
    res.json(result);
  } catch (error) {
    console.error('Error assigning conversation:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/assignment/:tenantId/reassign/:conversationId
 * Reassign conversation to different salesman
 */
router.post('/:tenantId/reassign/:conversationId', (req, res) => {
  try {
    const { tenantId, conversationId } = req.params;
    const { salesman_id, reason } = req.body;
    
    if (!salesman_id) {
      return res.status(400).json({ success: false, error: 'salesman_id is required' });
    }
    
    const result = reassignConversation(tenantId, conversationId, salesman_id, reason);
    
    res.json(result);
  } catch (error) {
    console.error('Error reassigning conversation:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==========================================
// HEAT SCORING ENDPOINTS
// ==========================================

/**
 * GET /api/assignment/:tenantId/heat/distribution
 * Get heat level distribution
 */
router.get('/:tenantId/heat/distribution', (req, res) => {
  try {
    const { tenantId } = req.params;
    const distribution = getHeatDistribution(tenantId);
    
    res.json({ success: true, distribution });
  } catch (error) {
    console.error('Error fetching heat distribution:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/assignment/:tenantId/heat/:heatLevel
 * Get conversations by heat level
 */
router.get('/:tenantId/heat/:heatLevel', (req, res) => {
  try {
    const { tenantId, heatLevel } = req.params;
    const conversations = getConversationsByHeat(tenantId, heatLevel);
    
    res.json({ success: true, conversations });
  } catch (error) {
    console.error('Error fetching conversations by heat:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/assignment/:tenantId/heat/:conversationId/analyze
 * Analyze and update heat for a conversation
 */
router.post('/:tenantId/heat/:conversationId/analyze', async (req, res) => {
  try {
    const { tenantId, conversationId } = req.params;
    const { message, use_ai } = req.body;
    
    if (!message) {
      return res.status(400).json({ success: false, error: 'message is required' });
    }
    
    const result = await analyzeAndUpdateHeat(tenantId, conversationId, message, { useAI: use_ai !== false });
    
    res.json({ success: true, analysis: result });
  } catch (error) {
    console.error('Error analyzing heat:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * PUT /api/assignment/:tenantId/heat/:conversationId
 * Manually update conversation heat
 */
router.put('/:tenantId/heat/:conversationId', async (req, res) => {
  try {
    const { tenantId, conversationId } = req.params;
    const { heat, confidence, reasons } = req.body;
    
    if (!heat) {
      return res.status(400).json({ success: false, error: 'heat level is required' });
    }
    
    const result = await updateConversationHeat(tenantId, conversationId, heat, confidence || 1.0, reasons || ['Manual update']);
    
    res.json({ success: true, result });
  } catch (error) {
    console.error('Error updating heat:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;

