const express = require('express');
const router = express.Router();
const aiIntegration = require('../../services/aiIntegrationService');
const { memoryManager } = require('../../services/ai');
const pool = require('../../config/database');

/**
 * GET /api/ai-admin/stats
 * Get AI usage statistics
 */
router.get('/stats', async (req, res) => {
  try {
    const stats = aiIntegration.getDailyCostSummary();

    res.json({
      success: true,
      data: {
        dailyCalls: stats.calls,
        dailyCost: stats.cost,
        date: stats.date,
        costInINR: (stats.cost * 85).toFixed(2),
        limits: {
          maxDailyCalls: process.env.MAX_DAILY_AI_CALLS || '1000',
          maxDailyCost: process.env.MAX_AI_COST_PER_DAY || '10.00'
        },
        isEnabled: process.env.AI_DISABLED !== 'true'
      }
    });

  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/ai-admin/memories/:customerProfileId
 * Get customer memories
 */
router.get('/memories/:customerProfileId', async (req, res) => {
  try {
    const { customerProfileId } = req.params;
    const { limit = 10, type } = req.query;

    const memories = await memoryManager.getMemories(customerProfileId, {
      limit: parseInt(limit),
      type: type
    });

    res.json({
      success: true,
      data: memories
    });

  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/ai-admin/memories
 * Store a manual memory
 */
router.post('/memories', async (req, res) => {
  try {
    const { tenantId, customerProfileId, conversationId, memory } = req.body;

    if (!memory.type || !memory.content) {
      return res.status(400).json({ 
        success: false, 
        error: 'Memory type and content are required' 
      });
    }

    const memoryId = await memoryManager.storeMemory(
      tenantId,
      customerProfileId,
      conversationId,
      memory
    );

    res.json({
      success: true,
      data: { memoryId }
    });

  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/ai-admin/preferences/:customerProfileId
 * Get customer preferences
 */
router.get('/preferences/:customerProfileId', async (req, res) => {
  try {
    const { customerProfileId } = req.params;

    const preferences = await memoryManager.getPreferences(customerProfileId);

    res.json({
      success: true,
      data: preferences
    });

  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * PUT /api/ai-admin/preferences/:customerProfileId
 * Update customer preferences
 */
router.put('/preferences/:customerProfileId', async (req, res) => {
  try {
    const { customerProfileId } = req.params;
    const updates = req.body;

    const preferences = await memoryManager.updatePreferences(
      customerProfileId,
      updates
    );

    res.json({
      success: true,
      data: preferences
    });

  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/ai-admin/analytics
 * Get AI analytics and insights
 */
router.get('/analytics', async (req, res) => {
  try {
    const { days = 7 } = req.query;

    // Get AI usage logs
    const usageQuery = `
      SELECT 
        DATE(created_at) as date,
        COUNT(*) as calls,
        SUM(total_tokens) as tokens,
        SUM(estimated_cost_usd) as cost,
        usage_type
      FROM ai_usage_logs
      WHERE created_at >= NOW() - INTERVAL '${parseInt(days)} days'
      GROUP BY DATE(created_at), usage_type
      ORDER BY date DESC
    `;

    const usageResult = await pool.query(usageQuery);

    // Get intent distribution
    const intentQuery = `
      SELECT 
        last_intent as intent,
        COUNT(*) as count
      FROM conversations
      WHERE last_intent IS NOT NULL
        AND updated_at >= NOW() - INTERVAL '${parseInt(days)} days'
      GROUP BY last_intent
      ORDER BY count DESC
    `;

    const intentResult = await pool.query(intentQuery);

    res.json({
      success: true,
      data: {
        usage: usageResult.rows,
        intents: intentResult.rows
      }
    });

  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/ai-admin/cleanup-memories
 * Manually trigger memory cleanup
 */
router.post('/cleanup-memories', async (req, res) => {
  try {
    const expired = await memoryManager.cleanupExpiredMemories();
    const archived = await memoryManager.archiveOldMemories(90);

    res.json({
      success: true,
      data: {
        expiredCount: expired,
        archivedCount: archived
      }
    });

  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/ai-admin/customer-intelligence/:customerProfileId
 * Get complete intelligence report for a customer
 */
router.get('/customer-intelligence/:customerProfileId', async (req, res) => {
  try {
    const { customerProfileId } = req.params;

    // Get all intelligence data
    const [memories, preferences, patterns, affinity] = await Promise.all([
      memoryManager.getMemories(customerProfileId, { limit: 20 }),
      memoryManager.getPreferences(customerProfileId),
      pool.query(`
        SELECT * FROM customer_purchase_patterns
        WHERE customer_profile_id = $1
      `, [customerProfileId]),
      pool.query(`
        SELECT cpa.*, p.name, p.code
        FROM customer_product_affinity cpa
        JOIN products p ON p.id = cpa.product_id
        WHERE cpa.customer_profile_id = $1
        ORDER BY cpa.is_regular_product DESC, cpa.days_since_last_purchase ASC
      `, [customerProfileId])
    ]);

    res.json({
      success: true,
      data: {
        memories: memories,
        preferences: preferences,
        purchasePatterns: patterns.rows[0] || null,
        productAffinity: affinity.rows
      }
    });

  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
