/**
 * Heat Scoring Service - AI-Powered Lead Urgency Detection
 * Analyzes messages to assign heat levels: COLD → WARM → HOT → VERY_HOT → ON_FIRE
 */

const { db } = require('./config');
const openaiService = require('./openaiService');

// Heat levels
const HEAT_LEVELS = {
  COLD: 'COLD',
  WARM: 'WARM',
  HOT: 'HOT',
  VERY_HOT: 'VERY_HOT',
  ON_FIRE: 'ON_FIRE'
};

// Urgency keywords by category
const URGENCY_INDICATORS = {
  IMMEDIATE: ['urgent', 'asap', 'immediately', 'right now', 'today', 'emergency'],
  TIME_SENSITIVE: ['soon', 'quickly', 'fast', 'hurry', 'this week', 'by tomorrow'],
  BUDGET_CONFIRMED: ['budget approved', 'ready to pay', 'card ready', 'payment ready', 'can transfer'],
  BUYING_SIGNALS: ['buy now', 'purchase', 'order', 'book', 'confirm', 'proceed', 'go ahead'],
  DECISION_READY: ['decided', 'final decision', 'ready to move', 'let\'s do it', 'confirmed']
};

// Cooling indicators (reduce heat)
const COOLING_INDICATORS = {
  JUST_EXPLORING: ['just looking', 'just checking', 'maybe later', 'not sure', 'thinking'],
  PRICE_SHOPPING: ['compare prices', 'check other options', 'looking around', 'too expensive'],
  NOT_READY: ['not now', 'later', 'next month', 'in future', 'planning']
};

/**
 * Calculate heat score from message content
 * @param {string} message - Message text
 * @returns {object} { heat: string, confidence: number, reasons: string[] }
 */
function calculateHeatFromMessage(message) {
  if (!message) {
    return { heat: HEAT_LEVELS.COLD, confidence: 0.5, reasons: ['No message content'] };
  }

  const lower = message.toLowerCase();
  const reasons = [];
  let score = 0;

  // Check urgency indicators
  URGENCY_INDICATORS.IMMEDIATE.forEach(keyword => {
    if (lower.includes(keyword)) {
      score += 30;
      reasons.push(`Immediate urgency: "${keyword}"`);
    }
  });

  URGENCY_INDICATORS.TIME_SENSITIVE.forEach(keyword => {
    if (lower.includes(keyword)) {
      score += 15;
      reasons.push(`Time-sensitive: "${keyword}"`);
    }
  });

  URGENCY_INDICATORS.BUDGET_CONFIRMED.forEach(keyword => {
    if (lower.includes(keyword)) {
      score += 25;
      reasons.push(`Budget confirmed: "${keyword}"`);
    }
  });

  URGENCY_INDICATORS.BUYING_SIGNALS.forEach(keyword => {
    if (lower.includes(keyword)) {
      score += 20;
      reasons.push(`Buying signal: "${keyword}"`);
    }
  });

  URGENCY_INDICATORS.DECISION_READY.forEach(keyword => {
    if (lower.includes(keyword)) {
      score += 20;
      reasons.push(`Decision ready: "${keyword}"`);
    }
  });

  // Check cooling indicators (reduce score)
  COOLING_INDICATORS.JUST_EXPLORING.forEach(keyword => {
    if (lower.includes(keyword)) {
      score -= 15;
      reasons.push(`Exploratory: "${keyword}"`);
    }
  });

  COOLING_INDICATORS.PRICE_SHOPPING.forEach(keyword => {
    if (lower.includes(keyword)) {
      score -= 10;
      reasons.push(`Price shopping: "${keyword}"`);
    }
  });

  COOLING_INDICATORS.NOT_READY.forEach(keyword => {
    if (lower.includes(keyword)) {
      score -= 20;
      reasons.push(`Not ready: "${keyword}"`);
    }
  });

  // Determine heat level from score
  let heat;
  if (score >= 50) {
    heat = HEAT_LEVELS.ON_FIRE;
  } else if (score >= 30) {
    heat = HEAT_LEVELS.VERY_HOT;
  } else if (score >= 15) {
    heat = HEAT_LEVELS.HOT;
  } else if (score >= 5) {
    heat = HEAT_LEVELS.WARM;
  } else {
    heat = HEAT_LEVELS.COLD;
  }

  // Confidence based on number of indicators found
  const indicatorCount = reasons.length;
  const confidence = Math.min(0.9, 0.5 + (indicatorCount * 0.1));

  return { heat, confidence, reasons, score };
}

/**
 * AI-powered heat analysis using OpenAI/Gemini
 * @param {string} tenantId
 * @param {string} message
 * @param {object} conversationContext - Previous messages
 * @returns {Promise<object>}
 */
async function calculateHeatWithAI(tenantId, message, conversationContext = {}) {
  try {
    const prompt = `Analyze this customer message and determine the lead's urgency/heat level.

Customer Message: "${message}"

${conversationContext.previousMessages ? `Recent Conversation History:\n${conversationContext.previousMessages.slice(0, 5).map(m => `- ${m.sender}: ${m.message}`).join('\n')}` : ''}

Urgency Levels:
- ON_FIRE (90-100): Ready to buy NOW, urgent need, budget approved, decision made
- VERY_HOT (70-89): Strong buying intent, timeline this week, discussing pricing
- HOT (50-69): Active interest, asking detailed questions, comparing options
- WARM (30-49): Casual interest, exploring options, no timeline
- COLD (0-29): Just browsing, no clear need, price shopping only

Respond in JSON:
{
  "heat": "COLD|WARM|HOT|VERY_HOT|ON_FIRE",
  "confidence": 0.0-1.0,
  "reasoning": "Brief explanation why",
  "urgency_indicators": ["keyword1", "keyword2"],
  "suggested_response_priority": "low|medium|high|critical"
}`;

    const aiResponse = await openaiService.getChatCompletion(
      [{ role: 'user', content: prompt }],
      'gpt-3.5-turbo',
      0.3
    );

    const result = JSON.parse(aiResponse);
    return {
      heat: result.heat || HEAT_LEVELS.COLD,
      confidence: result.confidence || 0.5,
      reasons: result.urgency_indicators || [],
      reasoning: result.reasoning,
      priority: result.suggested_response_priority
    };
  } catch (error) {
    console.error('[HeatScoring] AI analysis failed:', error.message);
    // Fallback to keyword-based analysis
    return calculateHeatFromMessage(message);
  }
}

/**
 * Update conversation heat level
 * @param {string} tenantId
 * @param {number} conversationId
 * @param {string} newHeat
 * @param {number} confidence
 * @param {string[]} reasons
 */
async function updateConversationHeat(tenantId, conversationId, newHeat, confidence, reasons = []) {
  try {
    // Get current heat
    const conversation = db
      .prepare('SELECT heat FROM conversations WHERE id = ? AND tenant_id = ?')
      .get(conversationId, tenantId);
    const oldHeat = conversation?.heat;

    // Update heat in conversations table
    db.prepare(`
      UPDATE conversations 
      SET heat = ?, ai_confidence = ?, last_activity_at = CURRENT_TIMESTAMP
      WHERE id = ? AND tenant_id = ?
    `).run(newHeat, confidence, conversationId, tenantId);

    // Log heat change event
    if (oldHeat && oldHeat !== newHeat) {
      db.prepare(`
        INSERT INTO lead_events (tenant_id, event_type, conversation_id, triggered_by, payload, created_at)
        VALUES (?, 'HEAT_CHANGED', ?, 'SYSTEM_AI', ?, CURRENT_TIMESTAMP)
      `).run(tenantId, conversationId, JSON.stringify({
        old_heat: oldHeat,
        new_heat: newHeat,
        confidence: confidence,
        reasons: reasons
      }));
    }

    console.log(`[HeatScoring] Updated conversation ${conversationId}: ${oldHeat || 'UNKNOWN'} → ${newHeat} (confidence: ${confidence.toFixed(2)})`);
    
    return { success: true, oldHeat, newHeat, confidence };
  } catch (error) {
    console.error('[HeatScoring] Error updating heat:', error);
    throw error;
  }
}

/**
 * Analyze message and update heat automatically
 * @param {string} tenantId
 * @param {number} conversationId
 * @param {string} message
 * @param {object} options
 */
async function analyzeAndUpdateHeat(tenantId, conversationId, message, options = {}) {
  const { useAI = true, conversationContext = {} } = options;
  
  let heatAnalysis;
  
  if (useAI) {
    heatAnalysis = await calculateHeatWithAI(tenantId, message, conversationContext);
  } else {
    heatAnalysis = calculateHeatFromMessage(message);
  }
  
  await updateConversationHeat(
    tenantId,
    conversationId,
    heatAnalysis.heat,
    heatAnalysis.confidence,
    heatAnalysis.reasons
  );
  
  return heatAnalysis;
}

/**
 * Get conversations by heat level
 * @param {string} tenantId
 * @param {string} heatLevel
 * @returns {Array}
 */
function getConversationsByHeat(tenantId, heatLevel) {
  return db.prepare(`
    SELECT c.*, cp.name, cp.phone_number, cp.email
    FROM conversations c
    LEFT JOIN customer_profiles cp ON c.end_user_phone = cp.phone_number
    WHERE c.tenant_id = ? AND c.heat = ?
    ORDER BY c.last_activity_at DESC
  `).all(tenantId, heatLevel);
}

/**
 * Get heat distribution for analytics
 * @param {string} tenantId
 * @returns {object}
 */
function getHeatDistribution(tenantId) {
  const distribution = db.prepare(`
    SELECT heat, COUNT(*) as count
    FROM conversations
    WHERE tenant_id = ?
    GROUP BY heat
  `).all(tenantId);
  
  const result = {
    COLD: 0,
    WARM: 0,
    HOT: 0,
    VERY_HOT: 0,
    ON_FIRE: 0
  };
  
  distribution.forEach(row => {
    result[row.heat] = row.count;
  });
  
  return result;
}

/**
 * Auto-escalate high heat leads to triage
 * @param {string} tenantId
 * @param {number} conversationId
 * @param {string} heat
 */
async function escalateHighHeatLead(tenantId, conversationId, heat) {
  if (heat === HEAT_LEVELS.ON_FIRE || heat === HEAT_LEVELS.VERY_HOT) {
    // Check if already in triage
    const existing = db
      .prepare('SELECT id FROM triage_queue WHERE tenant_id = ? AND conversation_id = ? AND status = ?')
      .get(tenantId, conversationId, 'open');
    
    if (!existing) {
      const conversation = db
        .prepare('SELECT end_user_phone FROM conversations WHERE id = ? AND tenant_id = ?')
        .get(conversationId, tenantId);
      
      db.prepare(`
        INSERT INTO triage_queue (tenant_id, conversation_id, end_user_phone, type, status, created_at)
        VALUES (?, ?, ?, 'high_value', 'open', CURRENT_TIMESTAMP)
      `).run(tenantId, conversationId, conversation.end_user_phone);
      
      console.log(`[HeatScoring] Auto-escalated ${heat} lead to triage: conversation ${conversationId}`);
    }
  }
}

module.exports = {
  HEAT_LEVELS,
  calculateHeatFromMessage,
  calculateHeatWithAI,
  updateConversationHeat,
  analyzeAndUpdateHeat,
  getConversationsByHeat,
  getHeatDistribution,
  escalateHighHeatLead
};

