/**
 * WhatsApp AI Enhancement Service
 * Conversational AI, smart replies, broadcast campaigns, context tracking
 */

const crypto = require('crypto');
const { db } = require('./config');

class WhatsAppAIService {
  
  // ===== CONVERSATION SESSIONS =====
  
  /**
   * Start new AI conversation session
   */
  static startSession(tenantId, sessionData) {
    const {
      customerId,
      phoneNumber,
      language = 'en',
      channel = 'whatsapp',
      deviceInfo = null
    } = sessionData;
    
    const id = crypto.randomBytes(16).toString('hex');
    
    db.prepare(`
      INSERT INTO ai_conversation_sessions (
        id, tenant_id, customer_id, phone_number, language, channel, device_info
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, tenantId, customerId, phoneNumber, language, channel, deviceInfo ? JSON.stringify(deviceInfo) : null);
    
    return { id, customerId, phoneNumber, sessionStart: new Date().toISOString() };
  }
  
  /**
   * Get active session for customer
   */
  static getActiveSession(tenantId, customerId) {
    return db.prepare(`
      SELECT * FROM ai_conversation_sessions 
      WHERE tenant_id = ? AND customer_id = ? AND session_status = 'active'
      ORDER BY session_start DESC LIMIT 1
    `).get(tenantId, customerId);
  }
  
  /**
   * Update session context
   */
  static updateSessionContext(sessionId, contextData) {
    const {
      currentIntent,
      currentTopic,
      conversationStage,
      customerSentiment,
      aiConfidenceScore
    } = contextData;
    
    const updates = [];
    const values = [];
    
    if (currentIntent) {
      updates.push('current_intent = ?');
      values.push(currentIntent);
    }
    if (currentTopic) {
      updates.push('current_topic = ?');
      values.push(currentTopic);
    }
    if (conversationStage) {
      updates.push('conversation_stage = ?');
      values.push(conversationStage);
    }
    if (customerSentiment) {
      updates.push('customer_sentiment = ?');
      values.push(customerSentiment);
    }
    if (aiConfidenceScore !== undefined) {
      updates.push('ai_confidence_score = ?');
      values.push(aiConfidenceScore);
    }
    
    updates.push('updated_at = CURRENT_TIMESTAMP');
    values.push(sessionId);
    
    db.prepare(`UPDATE ai_conversation_sessions SET ${updates.join(', ')} WHERE id = ?`).run(...values);
  }
  
  /**
   * Request human handoff
   */
  static requestHumanHandoff(sessionId, reason, agentId = null) {
    db.prepare(`
      UPDATE ai_conversation_sessions 
      SET human_handoff_requested = 1, handoff_reason = ?, human_agent_id = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(reason, agentId, sessionId);
    
    return { handoffRequested: true, reason, agentId };
  }
  
  /**
   * End conversation session
   */
  static endSession(sessionId) {
    const session = db.prepare('SELECT * FROM ai_conversation_sessions WHERE id = ?').get(sessionId);
    
    if (!session) return null;
    
    const sessionStart = new Date(session.session_start);
    const sessionEnd = new Date();
    const duration = Math.floor((sessionEnd - sessionStart) / 1000); // seconds
    
    db.prepare(`
      UPDATE ai_conversation_sessions 
      SET session_status = 'completed', session_end = ?, session_duration = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(sessionEnd.toISOString(), duration, sessionId);
    
    return { sessionId, duration, status: 'completed' };
  }
  
  // ===== MESSAGE HANDLING =====
  
  /**
   * Log conversation message with AI analysis
   */
  static logMessage(sessionId, tenantId, messageData) {
    const {
      messageDirection,
      messageType = 'text',
      messageContent,
      detectedIntent = null,
      detectedEntities = null,
      sentimentScore = null,
      urgencyLevel = 'low',
      isAiResponse = false,
      aiModelUsed = null,
      aiConfidence = null,
      responseTime = null
    } = messageData;
    
    const id = crypto.randomBytes(16).toString('hex');
    
    db.prepare(`
      INSERT INTO ai_conversation_messages (
        id, session_id, tenant_id, message_direction, message_type, message_content,
        detected_intent, detected_entities, sentiment_score, urgency_level,
        is_ai_response, ai_model_used, ai_confidence, response_time
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, sessionId, tenantId, messageDirection, messageType, messageContent,
      detectedIntent, detectedEntities ? JSON.stringify(detectedEntities) : null,
      sentimentScore, urgencyLevel, isAiResponse ? 1 : 0,
      aiModelUsed, aiConfidence, responseTime
    );
    
    // Update session message count
    db.prepare(`
      UPDATE ai_conversation_sessions 
      SET message_count = message_count + 1,
          ${isAiResponse ? 'ai_response_count = ai_response_count + 1' : 'human_response_count = human_response_count + 1'},
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(sessionId);
    
    return { id, sessionId, messageDirection, detectedIntent, sentimentScore };
  }
  
  /**
   * Analyze message with AI (intent, entities, sentiment)
   */
  static analyzeMessage(messageText, sessionContext = {}) {
    // Simplified AI analysis (in production, use OpenAI/custom model)
    
    // Intent detection (rule-based fallback)
    let intent = 'general';
    const lowerText = messageText.toLowerCase();
    
    if (lowerText.match(/price|cost|rate|how much|quotation/)) intent = 'pricing_inquiry';
    else if (lowerText.match(/order|buy|purchase|need/)) intent = 'order_intent';
    else if (lowerText.match(/delivery|shipping|when will|eta/)) intent = 'delivery_inquiry';
    else if (lowerText.match(/complaint|issue|problem|not working/)) intent = 'complaint';
    else if (lowerText.match(/help|support|assist/)) intent = 'support_request';
    else if (lowerText.match(/hi|hello|hey|good morning|good evening/)) intent = 'greeting';
    else if (lowerText.match(/bye|thanks|thank you|goodbye/)) intent = 'farewell';
    
    // Entity extraction (simple regex patterns)
    const entities = {};
    
    // Extract product mentions
    const productMatch = lowerText.match(/(?:product|item|part)\s+([A-Z0-9-]+)/i);
    if (productMatch) entities.product_code = productMatch[1];
    
    // Extract quantities
    const quantityMatch = lowerText.match(/(\d+)\s+(?:pieces|pcs|units|nos)/i);
    if (quantityMatch) entities.quantity = parseInt(quantityMatch[1]);
    
    // Extract prices
    const priceMatch = lowerText.match(/(?:rs|₹|inr)?\s*(\d+(?:,\d{3})*(?:\.\d{2})?)/i);
    if (priceMatch) entities.price = parseFloat(priceMatch[1].replace(/,/g, ''));
    
    // Sentiment analysis (rule-based)
    let sentimentScore = 0;
    if (lowerText.match(/excellent|great|awesome|wonderful|perfect|happy|satisfied/)) sentimentScore = 0.8;
    else if (lowerText.match(/good|nice|fine|ok|okay/)) sentimentScore = 0.4;
    else if (lowerText.match(/bad|terrible|awful|disappointed|angry|frustrated/)) sentimentScore = -0.8;
    else if (lowerText.match(/issue|problem|not working|complaint/)) sentimentScore = -0.4;
    
    // Urgency detection
    let urgencyLevel = 'low';
    if (lowerText.match(/urgent|asap|immediately|emergency|critical/)) urgencyLevel = 'high';
    else if (lowerText.match(/soon|today|quickly/)) urgencyLevel = 'medium';
    
    return {
      intent,
      entities: Object.keys(entities).length > 0 ? entities : null,
      sentimentScore,
      urgencyLevel,
      confidence: 0.75 // confidence in analysis
    };
  }
  
  // ===== SMART REPLIES =====
  
  /**
   * Create smart reply template
   */
  static createSmartReply(tenantId, replyData) {
    const {
      templateName,
      templateCategory,
      intentTriggers = [],
      keywordTriggers = [],
      sentimentTriggers = [],
      contextTriggers = {},
      replyText,
      replyVariants = [],
      language = 'en',
      priority = 50,
      createdBy
    } = replyData;
    
    const id = crypto.randomBytes(16).toString('hex');
    
    db.prepare(`
      INSERT INTO smart_reply_templates (
        id, tenant_id, template_name, template_category,
        intent_triggers, keyword_triggers, sentiment_triggers, context_triggers,
        reply_text, reply_variants, language, priority, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, tenantId, templateName, templateCategory,
      JSON.stringify(intentTriggers), JSON.stringify(keywordTriggers),
      JSON.stringify(sentimentTriggers), JSON.stringify(contextTriggers),
      replyText, JSON.stringify(replyVariants), language, priority, createdBy
    );
    
    return { id, templateName, templateCategory };
  }
  
  /**
   * Get smart reply suggestions based on context
   */
  static getSuggestedReplies(tenantId, intent, sentiment, conversationContext = {}) {
    const replies = db.prepare(`
      SELECT * FROM smart_reply_templates 
      WHERE tenant_id = ? AND is_active = 1
      ORDER BY priority DESC, usage_count DESC
      LIMIT 20
    `).all(tenantId);
    
    // Score and rank replies
    const scoredReplies = replies.map(reply => {
      let score = reply.priority;
      
      // Check intent match
      const intentTriggers = JSON.parse(reply.intent_triggers || '[]');
      if (intentTriggers.includes(intent)) score += 30;
      
      // Check sentiment match
      const sentimentTriggers = JSON.parse(reply.sentiment_triggers || '[]');
      if (sentimentTriggers.includes(sentiment)) score += 20;
      
      // Boost by success rate
      if (reply.success_rate) score += reply.success_rate * 10;
      
      return { ...reply, matchScore: score };
    });
    
    // Sort by score and return top 3
    return scoredReplies
      .sort((a, b) => b.matchScore - a.matchScore)
      .slice(0, 3)
      .map(r => ({
        id: r.id,
        text: r.reply_text,
        category: r.template_category,
        variants: JSON.parse(r.reply_variants || '[]'),
        matchScore: r.matchScore
      }));
  }
  
  /**
   * Record smart reply usage
   */
  static recordReplyUsage(replyId, wasSuccessful) {
    const reply = db.prepare('SELECT * FROM smart_reply_templates WHERE id = ?').get(replyId);
    
    if (!reply) return;
    
    const newUsageCount = reply.usage_count + 1;
    const currentSuccess = reply.success_rate || 0.5;
    const newSuccessRate = ((currentSuccess * reply.usage_count) + (wasSuccessful ? 1 : 0)) / newUsageCount;
    
    db.prepare(`
      UPDATE smart_reply_templates 
      SET usage_count = ?, success_rate = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(newUsageCount, newSuccessRate, replyId);
  }
  
  // ===== BROADCAST CAMPAIGNS =====
  
  /**
   * Create broadcast campaign
   */
  static createCampaign(tenantId, campaignData) {
    const {
      campaignName,
      campaignType,
      targetSegment = 'all',
      targetCriteria = {},
      messageTemplate,
      messageVariables = {},
      mediaUrl = null,
      mediaType = null,
      scheduledStart = null,
      aiOptimizationEnabled = false,
      createdBy
    } = campaignData;
    
    const id = crypto.randomBytes(16).toString('hex');
    
    db.prepare(`
      INSERT INTO broadcast_campaigns (
        id, tenant_id, campaign_name, campaign_type, target_segment, target_criteria,
        message_template, message_variables, media_url, media_type,
        scheduled_start, ai_optimization_enabled, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, tenantId, campaignName, campaignType, targetSegment,
      JSON.stringify(targetCriteria), messageTemplate, JSON.stringify(messageVariables),
      mediaUrl, mediaType, scheduledStart, aiOptimizationEnabled ? 1 : 0, createdBy
    );
    
    return { id, campaignName, campaignType, status: 'draft' };
  }
  
  /**
   * Add recipients to campaign
   */
  static addCampaignRecipients(campaignId, tenantId, recipients) {
    const campaign = db.prepare('SELECT * FROM broadcast_campaigns WHERE id = ?').get(campaignId);
    
    if (!campaign) throw new Error('Campaign not found');
    
    const recipientIds = [];
    
    for (const recipient of recipients) {
      const id = crypto.randomBytes(16).toString('hex');
      
      // Personalize message
      let personalizedMessage = campaign.message_template;
      const variables = JSON.parse(campaign.message_variables || '{}');
      
      for (const [key, value] of Object.entries(recipient)) {
        personalizedMessage = personalizedMessage.replace(new RegExp(`{{${key}}}`, 'g'), value || '');
      }
      
      db.prepare(`
        INSERT INTO broadcast_recipients (
          id, campaign_id, tenant_id, customer_id, phone_number, customer_name, personalized_message
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(id, campaignId, tenantId, recipient.customer_id, recipient.phone_number, recipient.customer_name, personalizedMessage);
      
      recipientIds.push(id);
    }
    
    // Update campaign target count
    db.prepare('UPDATE broadcast_campaigns SET target_count = ? WHERE id = ?')
      .run(recipients.length, campaignId);
    
    return { campaignId, recipientsAdded: recipientIds.length };
  }
  
  /**
   * Start broadcast campaign
   */
  static startCampaign(campaignId) {
    db.prepare(`
      UPDATE broadcast_campaigns 
      SET campaign_status = 'sending', updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(campaignId);
    
    return { campaignId, status: 'sending' };
  }
  
  /**
   * Update recipient status
   */
  static updateRecipientStatus(recipientId, statusData) {
    const {
      sendStatus,
      failureReason = null,
      replied = false,
      replyContent = null
    } = statusData;
    
    const updates = ['send_status = ?'];
    const values = [sendStatus];
    
    const timestampField = {
      sent: 'sent_at',
      delivered: 'delivered_at',
      read: 'read_at',
      replied: 'replied_at',
      failed: 'failed_at'
    }[sendStatus];
    
    if (timestampField) {
      updates.push(`${timestampField} = CURRENT_TIMESTAMP`);
    }
    
    if (failureReason) {
      updates.push('failure_reason = ?');
      values.push(failureReason);
    }
    
    if (replied) {
      updates.push('replied = 1, reply_content = ?');
      values.push(replyContent);
    }
    
    values.push(recipientId);
    
    db.prepare(`UPDATE broadcast_recipients SET ${updates.join(', ')} WHERE id = ?`).run(...values);
    
    // Update campaign counters
    const recipient = db.prepare('SELECT campaign_id FROM broadcast_recipients WHERE id = ?').get(recipientId);
    if (recipient) {
      const counterField = {
        sent: 'sent_count',
        delivered: 'delivered_count',
        read: 'read_count',
        replied: 'replied_count',
        failed: 'failed_count'
      }[sendStatus];
      
      if (counterField) {
        db.prepare(`UPDATE broadcast_campaigns SET ${counterField} = ${counterField} + 1 WHERE id = ?`)
          .run(recipient.campaign_id);
      }
    }
  }
  
  // ===== CONVERSATION CONTEXT =====
  
  /**
   * Set conversation context
   */
  static setContext(sessionId, tenantId, contextKey, contextValue, expiresInMinutes = null) {
    const id = crypto.randomBytes(16).toString('hex');
    
    let expiresAt = null;
    if (expiresInMinutes) {
      const expiry = new Date();
      expiry.setMinutes(expiry.getMinutes() + expiresInMinutes);
      expiresAt = expiry.toISOString();
    }
    
    // Upsert: deactivate existing key first
    db.prepare('UPDATE conversation_context SET is_active = 0 WHERE session_id = ? AND context_key = ?')
      .run(sessionId, contextKey);
    
    db.prepare(`
      INSERT INTO conversation_context (
        id, session_id, tenant_id, context_key, context_value, expires_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, sessionId, tenantId, contextKey, String(contextValue), expiresAt);
    
    return { contextKey, contextValue };
  }
  
  /**
   * Get conversation context
   */
  static getContext(sessionId, contextKey = null) {
    if (contextKey) {
      return db.prepare(`
        SELECT * FROM conversation_context 
        WHERE session_id = ? AND context_key = ? AND is_active = 1
        AND (expires_at IS NULL OR expires_at > datetime('now'))
        ORDER BY created_at DESC LIMIT 1
      `).get(sessionId, contextKey);
    } else {
      return db.prepare(`
        SELECT * FROM conversation_context 
        WHERE session_id = ? AND is_active = 1
        AND (expires_at IS NULL OR expires_at > datetime('now'))
        ORDER BY created_at DESC
      `).all(sessionId);
    }
  }
  
  /**
   * Clear conversation context
   */
  static clearContext(sessionId, contextKey = null) {
    if (contextKey) {
      db.prepare('UPDATE conversation_context SET is_active = 0 WHERE session_id = ? AND context_key = ?')
        .run(sessionId, contextKey);
    } else {
      db.prepare('UPDATE conversation_context SET is_active = 0 WHERE session_id = ?')
        .run(sessionId);
    }
  }
  
  // ===== ANALYTICS =====
  
  /**
   * Record AI performance metrics
   */
  static recordMetrics(tenantId, metricsData) {
    const today = new Date().toISOString().split('T')[0];
    const currentHour = new Date().getHours();
    
    const existing = db.prepare(`
      SELECT * FROM ai_performance_metrics 
      WHERE tenant_id = ? AND metric_date = ? AND metric_hour = ?
    `).get(tenantId, today, currentHour);
    
    if (existing) {
      // Update existing
      const updates = [];
      const values = [];
      
      for (const [key, value] of Object.entries(metricsData)) {
        if (key.startsWith('avg_') || key.endsWith('_accuracy') || key.endsWith('_score')) {
          // Average fields: recalculate
          updates.push(`${key} = ?`);
          values.push(value);
        } else {
          // Count fields: increment
          updates.push(`${key} = ${key} + ?`);
          values.push(value);
        }
      }
      
      values.push(existing.id);
      db.prepare(`UPDATE ai_performance_metrics SET ${updates.join(', ')} WHERE id = ?`).run(...values);
    } else {
      // Insert new
      const id = crypto.randomBytes(16).toString('hex');
      const fields = Object.keys(metricsData);
      const placeholders = fields.map(() => '?').join(', ');
      
      db.prepare(`
        INSERT INTO ai_performance_metrics (id, tenant_id, metric_date, metric_hour, ${fields.join(', ')})
        VALUES (?, ?, ?, ?, ${placeholders})
      `).run(id, tenantId, today, currentHour, ...Object.values(metricsData));
    }
  }
  
  /**
   * Get AI performance statistics
   */
  static getPerformanceStats(tenantId, startDate, endDate) {
    return db.prepare(`
      SELECT 
        metric_date,
        SUM(total_sessions) as total_sessions,
        SUM(ai_handled_sessions) as ai_handled_sessions,
        SUM(human_handoff_sessions) as human_handoff_sessions,
        AVG(avg_ai_confidence) as avg_ai_confidence,
        AVG(avg_response_time) as avg_response_time,
        SUM(positive_sentiment_count) as positive_sentiment,
        SUM(neutral_sentiment_count) as neutral_sentiment,
        SUM(negative_sentiment_count) as negative_sentiment,
        AVG(customer_satisfaction_score) as avg_satisfaction
      FROM ai_performance_metrics
      WHERE tenant_id = ? AND metric_date BETWEEN ? AND ?
      GROUP BY metric_date
      ORDER BY metric_date
    `).all(tenantId, startDate, endDate);
  }
  
  /**
   * Get conversation analytics
   */
  static getConversationAnalytics(tenantId, startDate, endDate) {
    return {
      sessionStats: db.prepare(`
        SELECT 
          COUNT(*) as total_sessions,
          AVG(message_count) as avg_messages_per_session,
          AVG(session_duration) as avg_duration_seconds,
          SUM(CASE WHEN human_handoff_requested = 1 THEN 1 ELSE 0 END) as handoff_count
        FROM ai_conversation_sessions
        WHERE tenant_id = ? AND session_start BETWEEN ? AND ?
      `).get(tenantId, startDate, endDate),
      
      intentDistribution: db.prepare(`
        SELECT 
          detected_intent,
          COUNT(*) as count
        FROM ai_conversation_messages
        WHERE tenant_id = ? AND timestamp BETWEEN ? AND ? AND detected_intent IS NOT NULL
        GROUP BY detected_intent
        ORDER BY count DESC
      `).all(tenantId, startDate, endDate),
      
      sentimentTrend: db.prepare(`
        SELECT 
          DATE(timestamp) as date,
          AVG(sentiment_score) as avg_sentiment,
          COUNT(*) as message_count
        FROM ai_conversation_messages
        WHERE tenant_id = ? AND timestamp BETWEEN ? AND ? AND sentiment_score IS NOT NULL
        GROUP BY DATE(timestamp)
        ORDER BY date
      `).all(tenantId, startDate, endDate)
    };
  }
}

module.exports = WhatsAppAIService;
