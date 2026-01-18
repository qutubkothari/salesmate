/**
 * WhatsApp AI API Routes
 * Smart replies, broadcast campaigns, conversation analytics, AI training
 */

const express = require('express');
const router = express.Router();
const { db } = require('../../services/config');
const WhatsAppAIService = require('../../services/whatsapp-ai-service');

// ===== CONVERSATION SESSIONS =====

/**
 * POST /api/whatsapp-ai/sessions/start
 * Start new AI conversation session
 */
router.post('/sessions/start', (req, res) => {
  try {
    const tenantId = req.body.tenant_id || 'default-tenant';
    
    const session = WhatsAppAIService.startSession(tenantId, req.body);
    
    res.json({
      success: true,
      session
    });
  } catch (error) {
    console.error('Error starting session:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/whatsapp-ai/sessions/active
 * Get active session for customer
 */
router.get('/sessions/active', (req, res) => {
  try {
    const tenantId = req.query.tenant_id || 'default-tenant';
    const customerId = req.query.customer_id;
    
    if (!customerId) {
      return res.status(400).json({ success: false, error: 'customer_id required' });
    }
    
    const session = WhatsAppAIService.getActiveSession(tenantId, customerId);
    
    res.json({
      success: true,
      session: session || null
    });
  } catch (error) {
    console.error('Error fetching session:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * PUT /api/whatsapp-ai/sessions/:id/context
 * Update session context
 */
router.put('/sessions/:id/context', (req, res) => {
  try {
    const { id } = req.params;
    
    WhatsAppAIService.updateSessionContext(id, req.body);
    
    res.json({
      success: true,
      message: 'Session context updated'
    });
  } catch (error) {
    console.error('Error updating context:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/whatsapp-ai/sessions/:id/handoff
 * Request human handoff
 */
router.post('/sessions/:id/handoff', (req, res) => {
  try {
    const { id } = req.params;
    const { reason, agent_id } = req.body;
    
    const result = WhatsAppAIService.requestHumanHandoff(id, reason, agent_id);
    
    res.json({
      success: true,
      handoff: result
    });
  } catch (error) {
    console.error('Error requesting handoff:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/whatsapp-ai/sessions/:id/end
 * End conversation session
 */
router.post('/sessions/:id/end', (req, res) => {
  try {
    const { id } = req.params;
    
    const result = WhatsAppAIService.endSession(id);
    
    res.json({
      success: true,
      session: result
    });
  } catch (error) {
    console.error('Error ending session:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ===== MESSAGE HANDLING =====

/**
 * POST /api/whatsapp-ai/messages/log
 * Log conversation message
 */
router.post('/messages/log', (req, res) => {
  try {
    const tenantId = req.body.tenant_id || 'default-tenant';
    const sessionId = req.body.session_id;
    
    if (!sessionId) {
      return res.status(400).json({ success: false, error: 'session_id required' });
    }
    
    const message = WhatsAppAIService.logMessage(sessionId, tenantId, req.body);
    
    res.json({
      success: true,
      message
    });
  } catch (error) {
    console.error('Error logging message:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/whatsapp-ai/messages/analyze
 * Analyze message with AI
 */
router.post('/messages/analyze', (req, res) => {
  try {
    const { message_text, session_context } = req.body;
    
    if (!message_text) {
      return res.status(400).json({ success: false, error: 'message_text required' });
    }
    
    const analysis = WhatsAppAIService.analyzeMessage(message_text, session_context || {});
    
    res.json({
      success: true,
      analysis
    });
  } catch (error) {
    console.error('Error analyzing message:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/whatsapp-ai/messages/session/:sessionId
 * Get messages for session
 */
router.get('/messages/session/:sessionId', (req, res) => {
  try {
    const { sessionId } = req.params;
    const limit = parseInt(req.query.limit) || 100;
    
    const messages = db.prepare(`
      SELECT * FROM ai_conversation_messages 
      WHERE session_id = ? 
      ORDER BY timestamp DESC 
      LIMIT ?
    `).all(sessionId, limit);
    
    res.json({
      success: true,
      messages: messages.map(m => ({
        ...m,
        detected_entities: m.detected_entities ? JSON.parse(m.detected_entities) : null
      }))
    });
  } catch (error) {
    console.error('Error fetching messages:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ===== SMART REPLIES =====

/**
 * POST /api/whatsapp-ai/smart-replies
 * Create smart reply template
 */
router.post('/smart-replies', (req, res) => {
  try {
    const tenantId = req.body.tenant_id || 'default-tenant';
    
    const reply = WhatsAppAIService.createSmartReply(tenantId, req.body);
    
    res.json({
      success: true,
      reply
    });
  } catch (error) {
    console.error('Error creating smart reply:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/whatsapp-ai/smart-replies
 * List smart reply templates
 */
router.get('/smart-replies', (req, res) => {
  try {
    const tenantId = req.query.tenant_id || 'default-tenant';
    const category = req.query.category;
    
    let query = 'SELECT * FROM smart_reply_templates WHERE tenant_id = ?';
    const params = [tenantId];
    
    if (category) {
      query += ' AND template_category = ?';
      params.push(category);
    }
    
    query += ' ORDER BY priority DESC, template_name';
    
    const replies = db.prepare(query).all(...params);
    
    res.json({
      success: true,
      replies: replies.map(r => ({
        ...r,
        intent_triggers: JSON.parse(r.intent_triggers || '[]'),
        keyword_triggers: JSON.parse(r.keyword_triggers || '[]'),
        sentiment_triggers: JSON.parse(r.sentiment_triggers || '[]'),
        context_triggers: JSON.parse(r.context_triggers || '{}'),
        reply_variants: JSON.parse(r.reply_variants || '[]')
      }))
    });
  } catch (error) {
    console.error('Error fetching smart replies:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/whatsapp-ai/smart-replies/suggest
 * Get reply suggestions for context
 */
router.post('/smart-replies/suggest', (req, res) => {
  try {
    const tenantId = req.body.tenant_id || 'default-tenant';
    const { intent, sentiment, context } = req.body;
    
    const suggestions = WhatsAppAIService.getSuggestedReplies(tenantId, intent, sentiment, context || {});
    
    res.json({
      success: true,
      suggestions
    });
  } catch (error) {
    console.error('Error getting suggestions:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/whatsapp-ai/smart-replies/:id/usage
 * Record smart reply usage
 */
router.post('/smart-replies/:id/usage', (req, res) => {
  try {
    const { id } = req.params;
    const { was_successful } = req.body;
    
    WhatsAppAIService.recordReplyUsage(id, was_successful !== false);
    
    res.json({
      success: true,
      message: 'Usage recorded'
    });
  } catch (error) {
    console.error('Error recording usage:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ===== BROADCAST CAMPAIGNS =====

/**
 * POST /api/whatsapp-ai/campaigns
 * Create broadcast campaign
 */
router.post('/campaigns', (req, res) => {
  try {
    const tenantId = req.body.tenant_id || 'default-tenant';
    
    const campaign = WhatsAppAIService.createCampaign(tenantId, req.body);
    
    res.json({
      success: true,
      campaign
    });
  } catch (error) {
    console.error('Error creating campaign:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/whatsapp-ai/campaigns
 * List broadcast campaigns
 */
router.get('/campaigns', (req, res) => {
  try {
    const tenantId = req.query.tenant_id || 'default-tenant';
    const status = req.query.status;
    
    let query = 'SELECT * FROM broadcast_campaigns WHERE tenant_id = ?';
    const params = [tenantId];
    
    if (status) {
      query += ' AND campaign_status = ?';
      params.push(status);
    }
    
    query += ' ORDER BY created_at DESC';
    
    const campaigns = db.prepare(query).all(...params);
    
    res.json({
      success: true,
      campaigns: campaigns.map(c => ({
        ...c,
        target_criteria: JSON.parse(c.target_criteria || '{}'),
        message_variables: JSON.parse(c.message_variables || '{}')
      }))
    });
  } catch (error) {
    console.error('Error fetching campaigns:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/whatsapp-ai/campaigns/:id
 * Get campaign details
 */
router.get('/campaigns/:id', (req, res) => {
  try {
    const { id } = req.params;
    
    const campaign = db.prepare('SELECT * FROM broadcast_campaigns WHERE id = ?').get(id);
    
    if (!campaign) {
      return res.status(404).json({ success: false, error: 'Campaign not found' });
    }
    
    // Get recipients
    const recipients = db.prepare('SELECT * FROM broadcast_recipients WHERE campaign_id = ?').all(id);
    
    res.json({
      success: true,
      campaign: {
        ...campaign,
        target_criteria: JSON.parse(campaign.target_criteria || '{}'),
        message_variables: JSON.parse(campaign.message_variables || '{}'),
        recipients
      }
    });
  } catch (error) {
    console.error('Error fetching campaign:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/whatsapp-ai/campaigns/:id/recipients
 * Add recipients to campaign
 */
router.post('/campaigns/:id/recipients', (req, res) => {
  try {
    const { id } = req.params;
    const tenantId = req.body.tenant_id || 'default-tenant';
    const { recipients } = req.body;
    
    if (!recipients || !Array.isArray(recipients)) {
      return res.status(400).json({ success: false, error: 'recipients array required' });
    }
    
    const result = WhatsAppAIService.addCampaignRecipients(id, tenantId, recipients);
    
    res.json({
      success: true,
      result
    });
  } catch (error) {
    console.error('Error adding recipients:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/whatsapp-ai/campaigns/:id/start
 * Start broadcast campaign
 */
router.post('/campaigns/:id/start', (req, res) => {
  try {
    const { id } = req.params;
    
    const result = WhatsAppAIService.startCampaign(id);
    
    res.json({
      success: true,
      campaign: result
    });
  } catch (error) {
    console.error('Error starting campaign:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * PUT /api/whatsapp-ai/campaigns/recipients/:id/status
 * Update recipient status
 */
router.put('/campaigns/recipients/:id/status', (req, res) => {
  try {
    const { id } = req.params;
    
    WhatsAppAIService.updateRecipientStatus(id, req.body);
    
    res.json({
      success: true,
      message: 'Recipient status updated'
    });
  } catch (error) {
    console.error('Error updating recipient:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ===== CONVERSATION CONTEXT =====

/**
 * POST /api/whatsapp-ai/context/set
 * Set conversation context
 */
router.post('/context/set', (req, res) => {
  try {
    const tenantId = req.body.tenant_id || 'default-tenant';
    const { session_id, context_key, context_value, expires_in_minutes } = req.body;
    
    if (!session_id || !context_key) {
      return res.status(400).json({ success: false, error: 'session_id and context_key required' });
    }
    
    const context = WhatsAppAIService.setContext(session_id, tenantId, context_key, context_value, expires_in_minutes);
    
    res.json({
      success: true,
      context
    });
  } catch (error) {
    console.error('Error setting context:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/whatsapp-ai/context/:sessionId
 * Get conversation context
 */
router.get('/context/:sessionId', (req, res) => {
  try {
    const { sessionId } = req.params;
    const contextKey = req.query.key;
    
    const context = WhatsAppAIService.getContext(sessionId, contextKey);
    
    res.json({
      success: true,
      context
    });
  } catch (error) {
    console.error('Error getting context:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * DELETE /api/whatsapp-ai/context/:sessionId
 * Clear conversation context
 */
router.delete('/context/:sessionId', (req, res) => {
  try {
    const { sessionId } = req.params;
    const contextKey = req.query.key;
    
    WhatsAppAIService.clearContext(sessionId, contextKey);
    
    res.json({
      success: true,
      message: 'Context cleared'
    });
  } catch (error) {
    console.error('Error clearing context:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ===== ANALYTICS =====

/**
 * GET /api/whatsapp-ai/analytics/performance
 * Get AI performance statistics
 */
router.get('/analytics/performance', (req, res) => {
  try {
    const tenantId = req.query.tenant_id || 'default-tenant';
    const startDate = req.query.start_date || new Date(Date.now() - 30*24*60*60*1000).toISOString().split('T')[0];
    const endDate = req.query.end_date || new Date().toISOString().split('T')[0];
    
    const stats = WhatsAppAIService.getPerformanceStats(tenantId, startDate, endDate);
    
    res.json({
      success: true,
      stats
    });
  } catch (error) {
    console.error('Error fetching performance stats:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/whatsapp-ai/analytics/conversations
 * Get conversation analytics
 */
router.get('/analytics/conversations', (req, res) => {
  try {
    const tenantId = req.query.tenant_id || 'default-tenant';
    const startDate = req.query.start_date || new Date(Date.now() - 7*24*60*60*1000).toISOString().split('T')[0];
    const endDate = req.query.end_date || new Date().toISOString().split('T')[0];
    
    const analytics = WhatsAppAIService.getConversationAnalytics(tenantId, startDate, endDate);
    
    res.json({
      success: true,
      analytics
    });
  } catch (error) {
    console.error('Error fetching conversation analytics:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/whatsapp-ai/analytics/campaign/:campaignId
 * Get campaign analytics
 */
router.get('/analytics/campaign/:campaignId', (req, res) => {
  try {
    const { campaignId } = req.params;
    
    const campaign = db.prepare('SELECT * FROM broadcast_campaigns WHERE id = ?').get(campaignId);
    
    if (!campaign) {
      return res.status(404).json({ success: false, error: 'Campaign not found' });
    }
    
    const recipientStats = db.prepare(`
      SELECT 
        send_status,
        COUNT(*) as count
      FROM broadcast_recipients
      WHERE campaign_id = ?
      GROUP BY send_status
    `).all(campaignId);
    
    const engagementStats = db.prepare(`
      SELECT 
        COUNT(CASE WHEN replied = 1 THEN 1 END) as replied_count,
        COUNT(CASE WHEN clicked_link = 1 THEN 1 END) as clicked_count,
        COUNT(CASE WHEN converted = 1 THEN 1 END) as converted_count,
        SUM(conversion_value) as total_revenue
      FROM broadcast_recipients
      WHERE campaign_id = ?
    `).get(campaignId);
    
    res.json({
      success: true,
      analytics: {
        campaign: {
          id: campaign.id,
          name: campaign.campaign_name,
          status: campaign.campaign_status,
          target_count: campaign.target_count,
          sent_count: campaign.sent_count,
          delivered_count: campaign.delivered_count,
          read_count: campaign.read_count,
          replied_count: campaign.replied_count,
          failed_count: campaign.failed_count
        },
        recipientStats,
        engagementStats
      }
    });
  } catch (error) {
    console.error('Error fetching campaign analytics:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ===== MESSAGE TEMPLATES =====

/**
 * POST /api/whatsapp-ai/templates
 * Create message template
 */
router.post('/templates', (req, res) => {
  try {
    const tenantId = req.body.tenant_id || 'default-tenant';
    const crypto = require('crypto');
    
    const {
      templateName,
      templateCategory,
      templateText,
      templateMediaUrl,
      templateMediaType,
      hasVariables,
      variableList,
      language = 'en',
      createdBy
    } = req.body;
    
    const id = crypto.randomBytes(16).toString('hex');
    
    db.prepare(`
      INSERT INTO message_templates (
        id, tenant_id, template_name, template_category, template_text,
        template_media_url, template_media_type, has_variables, variable_list,
        language, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, tenantId, templateName, templateCategory, templateText,
      templateMediaUrl, templateMediaType, hasVariables ? 1 : 0,
      variableList ? JSON.stringify(variableList) : null, language, createdBy
    );
    
    res.json({
      success: true,
      template: { id, templateName, templateCategory }
    });
  } catch (error) {
    console.error('Error creating template:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/whatsapp-ai/templates
 * List message templates
 */
router.get('/templates', (req, res) => {
  try {
    const tenantId = req.query.tenant_id || 'default-tenant';
    const category = req.query.category;
    
    let query = 'SELECT * FROM message_templates WHERE tenant_id = ?';
    const params = [tenantId];
    
    if (category) {
      query += ' AND template_category = ?';
      params.push(category);
    }
    
    query += ' ORDER BY template_category, template_name';
    
    const templates = db.prepare(query).all(...params);
    
    res.json({
      success: true,
      templates: templates.map(t => ({
        ...t,
        variable_list: t.variable_list ? JSON.parse(t.variable_list) : null
      }))
    });
  } catch (error) {
    console.error('Error fetching templates:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
