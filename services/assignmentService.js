/**
 * Assignment Service - Smart Lead Distribution
 * Implements: ROUND_ROBIN, LEAST_ACTIVE, SKILLS_BASED, GEOGRAPHIC
 */

const { db } = require('./config');

// Assignment strategies
const STRATEGIES = {
  ROUND_ROBIN: 'ROUND_ROBIN',
  LEAST_ACTIVE: 'LEAST_ACTIVE',
  SKILLS_BASED: 'SKILLS_BASED',
  GEOGRAPHIC: 'GEOGRAPHIC'
};

/**
 * Get assignment configuration for tenant
 */
function getAssignmentConfig(tenantId) {
  let config = db.prepare('SELECT * FROM assignment_config WHERE tenant_id = ?').get(tenantId);
  
  // Create default config if doesn't exist
  if (!config) {
    db.prepare(`
      INSERT INTO assignment_config (tenant_id, strategy, auto_assign, consider_capacity)
      VALUES (?, 'ROUND_ROBIN', 1, 1)
    `).run(tenantId);
    
    config = db.prepare('SELECT * FROM assignment_config WHERE tenant_id = ?').get(tenantId);
  }
  
  return config;
}

/**
 * Get all active salesmen for tenant
 */
function getActiveSalesmen(tenantId) {
  return db.prepare(`
    SELECT * FROM salesman
    WHERE tenant_id = ? AND active = 1
    ORDER BY id ASC
  `).all(tenantId);
}

/**
 * Get salesman's current workload
 */
function getSalesmanWorkload(tenantId, salesmanId) {
  const activeLeads = db.prepare(`
    SELECT COUNT(*) as count
    FROM conversations
    WHERE tenant_id = ? AND assigned_to = ? AND status = 'OPEN'
  `).get(tenantId, salesmanId.toString());
  
  return activeLeads.count || 0;
}

/**
 * Round-robin assignment
 * Assigns to next salesman in rotation, skipping overloaded ones
 */
function assignRoundRobin(tenantId, conversationId, config) {
  const salesmen = getActiveSalesmen(tenantId);
  
  if (salesmen.length === 0) {
    console.log('[Assignment] No active salesmen available');
    return null;
  }
  
  // Get last assigned salesman from lead_events
  const lastAssignment = db.prepare(`
    SELECT payload FROM lead_events
    WHERE tenant_id = ? AND event_type = 'ASSIGNED'
    ORDER BY created_at DESC
    LIMIT 1
  `).get(tenantId);
  
  let lastSalesmanId = null;
  if (lastAssignment) {
    try {
      const payload = JSON.parse(lastAssignment.payload);
      lastSalesmanId = payload.salesman_id;
    } catch (e) {}
  }
  
  // Find next salesman in rotation
  let startIndex = 0;
  if (lastSalesmanId) {
    startIndex = salesmen.findIndex(s => s.id === lastSalesmanId);
    if (startIndex === -1) startIndex = 0;
    startIndex = (startIndex + 1) % salesmen.length;
  }
  
  // Try each salesman starting from next in rotation
  for (let i = 0; i < salesmen.length; i++) {
    const index = (startIndex + i) % salesmen.length;
    const salesman = salesmen[index];
    
    // Check capacity if configured
    if (config.consider_capacity) {
      const workload = getSalesmanWorkload(tenantId, salesman.id);
      
      // Allow override for high heat leads
      const conversation = db.prepare('SELECT heat FROM conversations WHERE id = ?').get(conversationId);
      const isHighHeat = conversation && (conversation.heat === 'VERY_HOT' || conversation.heat === 'ON_FIRE');
      
      if (workload >= salesman.max_leads_per_month) {
        if (!salesman.use_intelligent_override || !isHighHeat) {
          console.log(`[Assignment] Skipping salesman ${salesman.name} - at capacity (${workload}/${salesman.max_leads_per_month})`);
          continue;
        } else {
          console.log(`[Assignment] Intelligent override - assigning high heat lead to ${salesman.name} despite capacity`);
        }
      }
    }
    
    return salesman;
  }
  
  // If all are at capacity, assign to first one anyway
  console.log('[Assignment] All salesmen at capacity, assigning to first salesman');
  return salesmen[0];
}

/**
 * Least-active assignment
 * Assigns to salesman with fewest active leads
 */
function assignLeastActive(tenantId, conversationId, config) {
  const salesmen = getActiveSalesmen(tenantId);
  
  if (salesmen.length === 0) {
    return null;
  }
  
  // Calculate workload for each salesman
  const salesmenWithWorkload = salesmen.map(salesman => ({
    ...salesman,
    workload: getSalesmanWorkload(tenantId, salesman.id)
  }));
  
  // Sort by workload (ascending)
  salesmenWithWorkload.sort((a, b) => a.workload - b.workload);
  
  // Return salesman with least workload
  const chosen = salesmenWithWorkload[0];
  console.log(`[Assignment] Least active: ${chosen.name} with ${chosen.workload} active leads`);
  
  return chosen;
}

/**
 * Skills-based assignment
 * Match product keywords or language to salesman skills
 */
function assignSkillsBased(tenantId, conversationId, config) {
  const salesmen = getActiveSalesmen(tenantId);
  
  if (salesmen.length === 0) {
    return null;
  }
  
  // Get conversation context
  const conversation = db.prepare('SELECT context FROM conversations WHERE id = ?').get(conversationId);
  
  let contextData = {};
  if (conversation?.context) {
    try {
      contextData = JSON.parse(conversation.context);
    } catch (e) {}
  }
  
  // Extract keywords from context
  const productKeywords = (contextData.mentioned_products || []).map(p => p.toLowerCase());
  const language = contextData.detected_language || 'en';
  
  // Score each salesman by skill match
  const salesmenWithScores = salesmen.map(salesman => {
    let score = 0;
    
    // Product skills match
    if (salesman.product_skills) {
      try {
        const skills = JSON.parse(salesman.product_skills);
        const matchingSkills = skills.filter(skill => 
          productKeywords.some(keyword => keyword.includes(skill.toLowerCase()))
        );
        score += matchingSkills.length * 10;
      } catch (e) {}
    }
    
    // Language skills match
    if (salesman.language_skills) {
      try {
        const languages = JSON.parse(salesman.language_skills);
        if (languages.includes(language)) {
          score += 20;
        }
      } catch (e) {}
    }
    
    // Factor in performance score if configured
    if (config.consider_score) {
      score += salesman.score * 0.5;
    }
    
    return { ...salesman, matchScore: score };
  });
  
  // Sort by match score (descending)
  salesmenWithScores.sort((a, b) => b.matchScore - a.matchScore);
  
  // Return best match (or first if no matches)
  const chosen = salesmenWithScores[0];
  console.log(`[Assignment] Skills match: ${chosen.name} with score ${chosen.matchScore}`);
  
  return chosen;
}

/**
 * Geographic assignment
 * Match customer location to salesman territory
 */
function assignGeographic(tenantId, conversationId, config) {
  const salesmen = getActiveSalesmen(tenantId);
  
  if (salesmen.length === 0) {
    return null;
  }
  
  // Get customer profile
  const conversation = db.prepare('SELECT end_user_phone FROM conversations WHERE id = ?').get(conversationId);
  const customer = db.prepare('SELECT * FROM customer_profiles WHERE phone_number = ?').get(conversation?.end_user_phone);
  
  if (!customer || !customer.address) {
    console.log('[Assignment] No customer location data, falling back to round-robin');
    return assignRoundRobin(tenantId, conversationId, config);
  }
  
  // Extract location from address (simple keyword matching)
  const address = customer.address.toLowerCase();
  
  // Find salesman with matching geographic zone
  const matchingSalesman = salesmen.find(salesman => {
    if (!salesman.geographic_zone) return false;
    const zone = salesman.geographic_zone.toLowerCase();
    return address.includes(zone) || zone.includes(address);
  });
  
  if (matchingSalesman) {
    console.log(`[Assignment] Geographic match: ${matchingSalesman.name} for zone ${matchingSalesman.geographic_zone}`);
    return matchingSalesman;
  }
  
  // No match, fallback to round-robin
  console.log('[Assignment] No geographic match, falling back to round-robin');
  return assignRoundRobin(tenantId, conversationId, config);
}

/**
 * Assign conversation to salesman using configured strategy
 */
async function assignConversation(tenantId, conversationId, options = {}) {
  const config = getAssignmentConfig(tenantId);
  
  // Check if already assigned
  const conversation = db.prepare('SELECT assigned_to FROM conversations WHERE id = ?').get(conversationId);
  if (conversation?.assigned_to) {
    console.log(`[Assignment] Conversation ${conversationId} already assigned to ${conversation.assigned_to}`);
    return { success: false, reason: 'Already assigned', assignedTo: conversation.assigned_to };
  }
  
  // Skip if auto-assign is disabled
  if (!config.active || !config.auto_assign) {
    console.log('[Assignment] Auto-assignment is disabled');
    return { success: false, reason: 'Auto-assignment disabled' };
  }
  
  // Select strategy
  const strategy = options.strategy || config.strategy;
  let selectedSalesman;
  
  switch (strategy) {
    case STRATEGIES.LEAST_ACTIVE:
      selectedSalesman = assignLeastActive(tenantId, conversationId, config);
      break;
    
    case STRATEGIES.SKILLS_BASED:
      selectedSalesman = assignSkillsBased(tenantId, conversationId, config);
      break;
    
    case STRATEGIES.GEOGRAPHIC:
      selectedSalesman = assignGeographic(tenantId, conversationId, config);
      break;
    
    case STRATEGIES.ROUND_ROBIN:
    default:
      selectedSalesman = assignRoundRobin(tenantId, conversationId, config);
      break;
  }
  
  if (!selectedSalesman) {
    console.log('[Assignment] No salesman available for assignment');
    return { success: false, reason: 'No salesman available' };
  }
  
  // Assign conversation
  db.prepare('UPDATE conversations SET assigned_to = ? WHERE id = ?')
    .run(selectedSalesman.id.toString(), conversationId);
  
  // Update salesman capacity
  db.prepare('UPDATE salesman SET capacity = capacity + 1 WHERE id = ?')
    .run(selectedSalesman.id);
  
  // Log assignment event
  db.prepare(`
    INSERT INTO lead_events (tenant_id, event_type, conversation_id, triggered_by, payload)
    VALUES (?, 'ASSIGNED', ?, 'SYSTEM', ?)
  `).run(tenantId, conversationId, JSON.stringify({
    salesman_id: selectedSalesman.id,
    salesman_name: selectedSalesman.name,
    strategy: strategy
  }));
  
  console.log(`[Assignment] ✅ Assigned conversation ${conversationId} to ${selectedSalesman.name} (strategy: ${strategy})`);
  
  return {
    success: true,
    salesman: selectedSalesman,
    strategy: strategy
  };
}

/**
 * Reassign conversation to different salesman
 */
function reassignConversation(tenantId, conversationId, newSalesmanId, reason = '') {
  const conversation = db.prepare('SELECT assigned_to FROM conversations WHERE id = ?').get(conversationId);
  const oldSalesmanId = conversation?.assigned_to;
  
  // Update conversation
  db.prepare('UPDATE conversations SET assigned_to = ? WHERE id = ?')
    .run(newSalesmanId.toString(), conversationId);
  
  // Update capacity
  if (oldSalesmanId) {
    db.prepare('UPDATE salesman SET capacity = capacity - 1 WHERE id = ?').run(oldSalesmanId);
  }
  db.prepare('UPDATE salesman SET capacity = capacity + 1 WHERE id = ?').run(newSalesmanId);
  
  // Log reassignment
  db.prepare(`
    INSERT INTO lead_events (tenant_id, event_type, conversation_id, triggered_by, payload)
    VALUES (?, 'REASSIGNED', ?, 'MANUAL', ?)
  `).run(tenantId, conversationId, JSON.stringify({
    old_salesman_id: oldSalesmanId,
    new_salesman_id: newSalesmanId,
    reason: reason
  }));
  
  console.log(`[Assignment] Reassigned conversation ${conversationId}: ${oldSalesmanId} → ${newSalesmanId}`);
  
  return { success: true };
}

module.exports = {
  STRATEGIES,
  getAssignmentConfig,
  getActiveSalesmen,
  getSalesmanWorkload,
  assignConversation,
  reassignConversation,
  assignRoundRobin,
  assignLeastActive,
  assignSkillsBased,
  assignGeographic
};

