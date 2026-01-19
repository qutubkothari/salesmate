/**
 * Objection Handling Service
 * 
 * AI-powered detection and handling of sales objections:
 * - Objection detection with NLP pattern matching
 * - Sentiment analysis
 * - Smart response suggestions
 * - Escalation management
 */

const Database = require('better-sqlite3');

class ObjectionHandlingService {
  /**
   * Detect objection in customer message
   * @param {string} tenantId - Tenant ID
   * @param {string} message - Customer's message
   * @param {Object} context - Conversation context
   * @returns {Object} Detection result with suggested response
   */
  static detectObjection(tenantId, message, context = {}) {
    const db = new Database(process.env.DB_PATH || 'local-database.db');

    try {
      const normalizedMessage = message.toLowerCase().trim();

      // Get all active objections for tenant (or use defaults)
      const objections = db.prepare(`
        SELECT * FROM sales_objections
        WHERE (tenant_id = ? OR tenant_id = 'default')
          AND is_active = 1
        ORDER BY objection_severity DESC
      `).all(tenantId);

      let bestMatch = null;
      let highestConfidence = 0;

      // Check each objection for keyword matches
      for (const objection of objections) {
        const keywords = JSON.parse(objection.keywords || '[]');
        let matchCount = 0;

        for (const keyword of keywords) {
          if (normalizedMessage.includes(keyword.toLowerCase())) {
            matchCount++;
          }
        }

        const confidence = keywords.length > 0 ? matchCount / keywords.length : 0;

        if (confidence > highestConfidence && confidence > 0.3) {
          highestConfidence = confidence;
          bestMatch = objection;
        }
      }

      if (!bestMatch) {
        return {
          detected: false,
          message: 'No objection detected',
          confidence: 0
        };
      }

      // Analyze sentiment
      const sentiment = this._analyzeSentiment(message);

      // Get best response
      const response = this._getBestResponse(db, bestMatch.id, context);

      // Log detection
      const logId = db.prepare(`
        INSERT INTO objection_detection_log (
          tenant_id, conversation_id, customer_id, deal_id, salesman_id,
          detected_objection_id, original_message, confidence_score,
          sentiment, sentiment_score, urgency_level,
          suggested_response_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        tenantId,
        context.conversationId || 'unknown',
        context.customerId || null,
        context.dealId || null,
        context.salesmanId || null,
        bestMatch.id,
        message,
        highestConfidence,
        sentiment.label,
        sentiment.score,
        this._determineUrgency(sentiment, highestConfidence),
        response?.id || null
      ).lastInsertRowid;

      // Update objection detection count
      db.prepare(`
        UPDATE sales_objections
        SET detection_count = detection_count + 1
        WHERE id = ?
      `).run(bestMatch.id);

      // Check for escalation
      const escalation = this._checkEscalation(db, tenantId, bestMatch, sentiment, context);

      return {
        detected: true,
        objection: {
          id: bestMatch.id,
          category: bestMatch.objection_category,
          severity: bestMatch.objection_severity,
          text: bestMatch.objection_text
        },
        confidence: highestConfidence,
        sentiment,
        suggestedResponse: response ? this._personalizeResponse(response, context) : null,
        escalation,
        logId
      };

    } finally {
      db.close();
    }
  }

  /**
   * Analyze message sentiment
   */
  static _analyzeSentiment(message) {
    const normalized = message.toLowerCase();

    // Simple keyword-based sentiment analysis
    const positiveWords = ['great', 'excellent', 'good', 'interested', 'yes', 'perfect', 'thank'];
    const negativeWords = ['expensive', 'costly', 'no', 'not', 'never', 'can\'t', 'won\'t', 'doubt', 'skeptical'];
    const veryNegativeWords = ['hate', 'terrible', 'awful', 'waste', 'scam', 'fraud'];

    let score = 0;
    let label = 'neutral';

    for (const word of veryNegativeWords) {
      if (normalized.includes(word)) {
        score -= 2;
      }
    }

    for (const word of negativeWords) {
      if (normalized.includes(word)) {
        score -= 1;
      }
    }

    for (const word of positiveWords) {
      if (normalized.includes(word)) {
        score += 1;
      }
    }

    // Normalize score to -1 to +1
    const normalizedScore = Math.max(-1, Math.min(1, score / 5));

    if (normalizedScore < -0.6) label = 'very_negative';
    else if (normalizedScore < -0.2) label = 'negative';
    else if (normalizedScore > 0.2) label = 'positive';

    return { label, score: normalizedScore };
  }

  /**
   * Determine urgency level
   */
  static _determineUrgency(sentiment, confidence) {
    if (sentiment.label === 'very_negative' || confidence > 0.8) {
      return 'urgent';
    } else if (sentiment.label === 'negative' || confidence > 0.6) {
      return 'high';
    } else if (confidence > 0.4) {
      return 'normal';
    }
    return 'low';
  }

  /**
   * Get best response for objection
   */
  static _getBestResponse(db, objectionId, context) {
    const responses = db.prepare(`
      SELECT * FROM objection_responses
      WHERE objection_id = ?
        AND is_active = 1
      ORDER BY success_rate DESC, times_used ASC
      LIMIT 1
    `).get(objectionId);

    return responses;
  }

  /**
   * Personalize response with context
   */
  static _personalizeResponse(response, context) {
    let personalizedText = response.response_text;

    // Replace placeholders
    if (context.customerName) {
      personalizedText = personalizedText.replace(/\{\{customer_name\}\}/g, context.customerName);
    }
    if (context.productName) {
      personalizedText = personalizedText.replace(/\{\{product_name\}\}/g, context.productName);
    }
    if (context.companyName) {
      personalizedText = personalizedText.replace(/\{\{company_name\}\}/g, context.companyName);
    }

    return {
      id: response.id,
      text: personalizedText,
      type: response.response_type,
      tone: response.response_tone
    };
  }

  /**
   * Check if objection should be escalated
   */
  static _checkEscalation(db, tenantId, objection, sentiment, context) {
    const rules = db.prepare(`
      SELECT * FROM objection_escalation_rules
      WHERE tenant_id = ?
        AND (objection_category IS NULL OR objection_category = ?)
        AND is_active = 1
      ORDER BY id ASC
    `).all(tenantId, objection.objection_category);

    for (const rule of rules) {
      let shouldEscalate = false;

      // Check sentiment threshold
      if (rule.sentiment_threshold !== null && sentiment.score < rule.sentiment_threshold) {
        shouldEscalate = true;
      }

      // Check repeated objection
      if (rule.repeated_objection_count && context.customerId) {
        const count = db.prepare(`
          SELECT COUNT(*) as count
          FROM objection_detection_log
          WHERE tenant_id = ?
            AND customer_id = ?
            AND detected_objection_id = ?
            AND detected_at >= DATE('now', '-7 days')
        `).get(tenantId, context.customerId, objection.id);

        if (count.count >= rule.repeated_objection_count) {
          shouldEscalate = true;
        }
      }

      // Check high value deal
      if (rule.high_value_deal_threshold && context.dealValue >= rule.high_value_deal_threshold) {
        shouldEscalate = true;
      }

      if (shouldEscalate) {
        return {
          required: true,
          rule: rule.rule_name,
          escalateTo: rule.escalate_to_role,
          method: rule.notification_method,
          delayMinutes: rule.delay_minutes
        };
      }
    }

    return { required: false };
  }

  /**
   * Mark objection as resolved
   */
  static markResolved(tenantId, logId, resolutionMethod = 'ai_response', dealProgressed = false) {
    const db = new Database(process.env.DB_PATH || 'local-database.db');

    try {
      const log = db.prepare(`
        SELECT * FROM objection_detection_log
        WHERE id = ? AND tenant_id = ?
      `).get(logId, tenantId);

      if (!log) {
        throw new Error('Objection log not found');
      }

      db.prepare(`
        UPDATE objection_detection_log
        SET was_resolved = 1,
            resolution_method = ?,
            deal_progressed = ?
        WHERE id = ?
      `).run(resolutionMethod, dealProgressed ? 1 : 0, logId);

      // Update objection success rate
      if (log.detected_objection_id && dealProgressed) {
        db.prepare(`
          UPDATE sales_objections
          SET successful_resolution_count = successful_resolution_count + 1,
              resolution_rate = CAST(successful_resolution_count AS REAL) / CAST(detection_count AS REAL)
          WHERE id = ?
        `).run(log.detected_objection_id);
      }

      // Update response success rate
      if (log.suggested_response_id && dealProgressed) {
        db.prepare(`
          UPDATE objection_responses
          SET times_used = times_used + 1,
              success_rate = (success_rate * times_used + 1.0) / (times_used + 1)
          WHERE id = ?
        `).run(log.suggested_response_id);
      }

      return { success: true };

    } finally {
      db.close();
    }
  }

  /**
   * Add custom objection
   */
  static addObjection(tenantId, objectionData) {
    const db = new Database(process.env.DB_PATH || 'local-database.db');

    try {
      const result = db.prepare(`
        INSERT INTO sales_objections (
          tenant_id, objection_text, objection_category, objection_severity,
          keywords, industry, customer_type, deal_stage
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        tenantId,
        objectionData.text,
        objectionData.category,
        objectionData.severity || 'medium',
        JSON.stringify(objectionData.keywords || []),
        objectionData.industry || null,
        objectionData.customerType || null,
        objectionData.dealStage || null
      );

      return { objectionId: result.lastInsertRowid };

    } finally {
      db.close();
    }
  }

  /**
   * Add custom response
   */
  static addResponse(tenantId, objectionId, responseData) {
    const db = new Database(process.env.DB_PATH || 'local-database.db');

    try {
      const result = db.prepare(`
        INSERT INTO objection_responses (
          objection_id, tenant_id, response_text, response_type, response_tone,
          uses_customer_name, uses_product_name
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        objectionId,
        tenantId,
        responseData.text,
        responseData.type || 'empathize_clarify_respond',
        responseData.tone || 'professional',
        responseData.usesCustomerName ? 1 : 0,
        responseData.usesProductName ? 1 : 0
      );

      return { responseId: result.lastInsertRowid };

    } finally {
      db.close();
    }
  }

  /**
   * Get objection analytics
   */
  static getAnalytics(tenantId, options = {}) {
    const db = new Database(process.env.DB_PATH || 'local-database.db');

    try {
      const { startDate, endDate } = options;

      // Overall stats
      const stats = db.prepare(`
        SELECT 
          COUNT(*) as total_detections,
          SUM(CASE WHEN was_resolved = 1 THEN 1 ELSE 0 END) as resolved_count,
          AVG(confidence_score) as avg_confidence,
          COUNT(DISTINCT customer_id) as unique_customers
        FROM objection_detection_log
        WHERE tenant_id = ?
          ${startDate ? 'AND detected_at >= ?' : ''}
          ${endDate ? 'AND detected_at <= ?' : ''}
      `).get(tenantId, ...[startDate, endDate].filter(Boolean));

      // By category
      const byCategory = db.prepare(`
        SELECT 
          so.objection_category,
          COUNT(*) as count,
          AVG(odl.confidence_score) as avg_confidence,
          SUM(CASE WHEN odl.was_resolved = 1 THEN 1 ELSE 0 END) as resolved
        FROM objection_detection_log odl
        JOIN sales_objections so ON so.id = odl.detected_objection_id
        WHERE odl.tenant_id = ?
          ${startDate ? 'AND odl.detected_at >= ?' : ''}
          ${endDate ? 'AND odl.detected_at <= ?' : ''}
        GROUP BY so.objection_category
        ORDER BY count DESC
      `).all(tenantId, ...[startDate, endDate].filter(Boolean));

      // Top objections
      const topObjections = db.prepare(`
        SELECT 
          so.objection_text,
          so.objection_category,
          COUNT(*) as detection_count,
          AVG(odl.confidence_score) as avg_confidence
        FROM objection_detection_log odl
        JOIN sales_objections so ON so.id = odl.detected_objection_id
        WHERE odl.tenant_id = ?
          ${startDate ? 'AND odl.detected_at >= ?' : ''}
          ${endDate ? 'AND odl.detected_at <= ?' : ''}
        GROUP BY so.id
        ORDER BY detection_count DESC
        LIMIT 10
      `).all(tenantId, ...[startDate, endDate].filter(Boolean));

      return {
        overview: stats,
        byCategory,
        topObjections,
        resolutionRate: stats.total_detections > 0 
          ? (stats.resolved_count / stats.total_detections) * 100 
          : 0
      };

    } finally {
      db.close();
    }
  }
}

module.exports = ObjectionHandlingService;
