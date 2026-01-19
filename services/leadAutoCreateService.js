/**
 * Lead Auto-Creation Service
 * Automatically converts WhatsApp messages into leads with AI qualification
 */

const { dbClient } = require('./config');

/**
 * AI-powered lead qualification based on message content
 * Analyzes keywords, urgency, intent to determine heat and score
 */
function analyzeLeadQuality(messageBody) {
    if (!messageBody) {
        return { heat: 'COLD', score: 20, intent: 'unknown', urgency: 'low' };
    }

    const text = messageBody.toLowerCase();
    let score = 30; // Base score
    let urgency = 'low';
    let intent = 'inquiry';

    // HIGH INTENT KEYWORDS (purchase signals)
    const highIntentKeywords = [
        'buy', 'purchase', 'order', 'price', 'cost', 'quote', 'quotation',
        'invoice', 'payment', 'pay', 'book', 'reserve', 'confirm',
        'interested', 'want', 'need', 'require', 'urgent', 'asap',
        'immediately', 'today', 'now', 'ready'
    ];

    // WARM INTENT KEYWORDS (comparison/research)
    const warmIntentKeywords = [
        'details', 'information', 'info', 'tell me', 'looking for',
        'available', 'availability', 'stock', 'delivery', 'shipping',
        'specifications', 'features', 'options', 'variants'
    ];

    // URGENCY INDICATORS
    const urgentKeywords = [
        'urgent', 'asap', 'immediately', 'today', 'now', 'emergency',
        'right now', 'as soon as possible', 'quick', 'fast'
    ];

    // PREMIUM/HIGH VALUE INDICATORS
    const premiumKeywords = [
        'bulk', 'wholesale', 'business', 'company', 'corporate',
        'large order', 'multiple', 'quantity', 'dealer', 'distributor'
    ];

    // Count keyword matches
    let highIntentCount = 0;
    let warmIntentCount = 0;
    let urgentCount = 0;
    let premiumCount = 0;

    highIntentKeywords.forEach(keyword => {
        if (text.includes(keyword)) highIntentCount++;
    });

    warmIntentKeywords.forEach(keyword => {
        if (text.includes(keyword)) warmIntentCount++;
    });

    urgentKeywords.forEach(keyword => {
        if (text.includes(keyword)) urgentCount++;
    });

    premiumKeywords.forEach(keyword => {
        if (text.includes(keyword)) premiumCount++;
    });

    // SCORING LOGIC
    if (highIntentCount >= 3) {
        score += 40; // Very strong purchase intent (3+ keywords)
        intent = 'purchase';
    } else if (highIntentCount === 2) {
        score += 30; // Strong purchase intent (2 keywords)
        intent = 'purchase';
    } else if (highIntentCount === 1) {
        score += 15; // Moderate purchase intent (1 keyword)
        intent = 'inquiry';
    }

    if (warmIntentCount >= 3) {
        score += 20; // Strong research/comparison (3+ keywords)
    } else if (warmIntentCount === 2) {
        score += 15; // Moderate research (2 keywords)
    } else if (warmIntentCount === 1) {
        score += 8; // Light research (1 keyword)
    }

    if (urgentCount > 0) {
        score += 15; // Urgency boosts score
        urgency = urgentCount >= 2 ? 'critical' : 'high';
    }

    if (premiumCount > 0) {
        score += 20; // High-value opportunity
    }

    // Question mark indicates inquiry
    const questionCount = (text.match(/\?/g) || []).length;
    if (questionCount >= 2) {
        score += 5; // Engaged prospect asking questions
    }

    // Message length indicates engagement
    const wordCount = text.split(/\s+/).length;
    if (wordCount > 20) {
        score += 10; // Detailed inquiry
    } else if (wordCount < 5) {
        score -= 10; // Very short message may be low quality
    }

    // Cap score at 100
    score = Math.min(100, Math.max(0, score));

    // Determine heat based on score
    let heat = 'COLD';
    if (score >= 80) {
        heat = 'ON_FIRE';
    } else if (score >= 60) {
        heat = 'HOT';
    } else if (score >= 40) {
        heat = 'WARM';
    }

    return {
        heat,
        score,
        intent,
        urgency,
        analysis: {
            highIntentMatches: highIntentCount,
            warmIntentMatches: warmIntentCount,
            urgentMatches: urgentCount,
            premiumMatches: premiumCount,
            questionCount,
            wordCount
        }
    };
}

/**
 * Auto-create or update lead from WhatsApp message
 */
async function createLeadFromWhatsApp({ 
    tenantId, 
    phone, 
    name, 
    messageBody, 
    salesmanId = null,
    sessionName = 'default'
}) {
    try {
        console.log('[LEAD_AUTO_CREATE] Processing WhatsApp message to lead:', {
            tenantId,
            phone,
            salesmanId,
            sessionName
        });

        // Normalize phone number
        const cleanPhone = String(phone || '').replace(/@c\.us$/, '').replace(/\D/g, '');

        if (!cleanPhone) {
            console.warn('[LEAD_AUTO_CREATE] No valid phone number');
            return { success: false, error: 'No valid phone number' };
        }

        // Check if lead already exists (dedupe by phone)
        const { data: existingLead, error: checkErr } = await dbClient
            .from('crm_leads')
            .select('*')
            .eq('tenant_id', tenantId)
            .eq('phone', cleanPhone)
            .maybeSingle();

        if (checkErr && checkErr.code !== 'PGRST116') {
            console.error('[LEAD_AUTO_CREATE] Check error:', checkErr);
        }

        let lead;
        let isNew = false;

        if (existingLead) {
            // Update existing lead with AI re-analysis
            console.log('[LEAD_AUTO_CREATE] Updating existing lead:', existingLead.id);
            
            // Re-analyze message to potentially increase heat/score
            const aiAnalysis = analyzeLeadQuality(messageBody);
            console.log('[LEAD_AUTO_CREATE] AI Re-analysis for existing lead:', aiAnalysis);
            
            const updates = {
                updated_at: new Date().toISOString(),
                last_activity_at: new Date().toISOString()
            };

            // Update name if missing
            if (name && !existingLead.name) {
                updates.name = name;
            }

            // SMART HEAT ESCALATION: Only increase heat, never decrease
            // This ensures leads get hotter with engagement but don't cool down
            const heatLevels = { 'COLD': 1, 'WARM': 2, 'HOT': 3, 'ON_FIRE': 4 };
            const currentHeatLevel = heatLevels[existingLead.heat] || 1;
            const newHeatLevel = heatLevels[aiAnalysis.heat] || 1;
            
            if (newHeatLevel > currentHeatLevel) {
                updates.heat = aiAnalysis.heat;
                console.log(`[LEAD_AUTO_CREATE] Heat escalated: ${existingLead.heat} → ${aiAnalysis.heat}`);
            }

            // SCORE BLENDING: Take weighted average (70% existing, 30% new)
            // This prevents wild swings while allowing upward trend
            const blendedScore = Math.round(
                (existingLead.score || 30) * 0.7 + aiAnalysis.score * 0.3
            );
            updates.score = Math.max(existingLead.score || 0, blendedScore);

            const { data: updated, error: updateErr } = await dbClient
                .from('crm_leads')
                .update(updates)
                .eq('id', existingLead.id)
                .select('*')
                .single();

            if (updateErr) {
                console.error('[LEAD_AUTO_CREATE] Update error:', updateErr);
                lead = existingLead;
            } else {
                lead = updated;
                
                // Log heat change if it happened
                if (updates.heat && updates.heat !== existingLead.heat) {
                    await dbClient.from('crm_lead_events').insert({
                        tenant_id: tenantId,
                        lead_id: lead.id,
                        event_type: 'HEAT_CHANGED',
                        event_payload: {
                            old_heat: existingLead.heat,
                            new_heat: updates.heat,
                            trigger: 'ai_reanalysis',
                            ai_analysis: aiAnalysis
                        }
                    });
                }
            }

        } else {
            // Create new lead
            console.log('[LEAD_AUTO_CREATE] Creating new lead');
            isNew = true;

            // Determine assignment based on source
            let assignedUserId = null;
            let createdByUserId = null;
            let channel = 'WHATSAPP';

            // If message came from salesman's WhatsApp, auto-assign to them
            if (salesmanId) {
                assignedUserId = salesmanId;
                createdByUserId = salesmanId;
                console.log('[LEAD_AUTO_CREATE] Auto-assigning to salesman:', salesmanId);
            } else {
                // Message from central bot - will go to triage
                console.log('[LEAD_AUTO_CREATE] From central bot - will route to triage');
            }

            // AI-powered lead qualification
            const aiAnalysis = analyzeLeadQuality(messageBody);
            console.log('[LEAD_AUTO_CREATE] AI Analysis:', aiAnalysis);

            const { data: newLead, error: createErr } = await dbClient
                .from('crm_leads')
                .insert({
                    tenant_id: tenantId,
                    phone: cleanPhone,
                    name: name || null,
                    channel,
                    status: 'NEW',
                    heat: aiAnalysis.heat, // AI-determined heat level
                    score: aiAnalysis.score, // AI-calculated score
                    created_by_user_id: createdByUserId,
                    assigned_user_id: assignedUserId,
                    last_activity_at: new Date().toISOString()
                })
                .select('*')
                .single();

            if (createErr) {
                console.error('[LEAD_AUTO_CREATE] Create error:', createErr);
                throw createErr;
            }

            lead = newLead;

            // Log lead creation event with AI analysis
            await dbClient
                .from('crm_lead_events')
                .insert({
                    tenant_id: tenantId,
                    lead_id: lead.id,
                    actor_user_id: createdByUserId,
                    event_type: 'LEAD_CREATED',
                    event_payload: { 
                        source: 'whatsapp_auto',
                        session_name: sessionName,
                        salesman_id: salesmanId,
                        ai_qualification: aiAnalysis,
                        initial_message: messageBody?.substring(0, 200)
                    }
                });
        }

        // Create message record
        if (messageBody) {
            const { error: msgErr } = await dbClient
                .from('crm_messages')
                .insert({
                    tenant_id: tenantId,
                    lead_id: lead.id,
                    direction: 'INBOUND',
                    channel: 'WHATSAPP',
                    body: messageBody,
                    created_at: new Date().toISOString()
                });

            if (msgErr) {
                console.error('[LEAD_AUTO_CREATE] Message error:', msgErr);
            }
        }

        // If unassigned, create triage item
        if (!lead.assigned_user_id) {
            console.log('[LEAD_AUTO_CREATE] Creating triage item for unassigned lead');
            
            const { error: triageErr } = await dbClient
                .from('crm_triage_items')
                .insert({
                    tenant_id: tenantId,
                    lead_id: lead.id,
                    status: 'OPEN',
                    reason: 'New WhatsApp enquiry',
                    created_at: new Date().toISOString()
                });

            if (triageErr) {
                console.error('[LEAD_AUTO_CREATE] Triage error:', triageErr);
            }
        }

        console.log('[LEAD_AUTO_CREATE] Success:', {
            leadId: lead.id,
            isNew,
            assigned: !!lead.assigned_user_id,
            needsTriage: !lead.assigned_user_id
        });

        return {
            success: true,
            lead,
            isNew,
            needsAssignment: !lead.assigned_user_id
        };

    } catch (error) {
        console.error('[LEAD_AUTO_CREATE] Error:', error);
        return {
            success: false,
            error: error.message
        };
    }
}

/**
 * Get lead assignment settings for tenant
 */
async function getLeadAssignmentSettings(tenantId) {
    try {
        // Check if tenant has auto-assignment configured
        const { data: config, error } = await dbClient
            .from('triage_assignment_config')
            .select('*')
            .eq('tenant_id', tenantId)
            .maybeSingle();

        if (error && error.code !== 'PGRST116') {
            console.error('[LEAD_SETTINGS] Error:', error);
        }

        return {
            autoAssign: config?.auto_assign === 1 || config?.auto_assign === true,
            strategy: config?.strategy || 'LEAST_ACTIVE',
            considerCapacity: config?.consider_capacity === 1,
            considerScore: config?.consider_score === 1
        };

    } catch (error) {
        console.error('[LEAD_SETTINGS] Error:', error);
        return {
            autoAssign: false,
            strategy: 'MANUAL'
        };
    }
}

/**
 * Auto-assign lead based on tenant settings
 */
async function autoAssignLead(tenantId, leadId) {
    try {
        const settings = await getLeadAssignmentSettings(tenantId);

        if (!settings.autoAssign) {
            console.log('[AUTO_ASSIGN] Auto-assignment disabled for tenant:', tenantId);
            return { success: false, reason: 'auto_assign_disabled' };
        }

        // Get available salesmen
        const { data: salesmen, error: salesmenErr } = await dbClient
            .from('salesmen')
            .select('id, name')
            .eq('tenant_id', tenantId)
            .eq('is_active', 1);

        if (salesmenErr || !salesmen || salesmen.length === 0) {
            console.log('[AUTO_ASSIGN] No active salesmen available');
            return { success: false, reason: 'no_salesmen' };
        }

        let selectedSalesman;

        if (settings.strategy === 'LEAST_ACTIVE') {
            // Find salesman with fewest active leads
            const salesmenWithCounts = await Promise.all(
                salesmen.map(async (s) => {
                    const { count } = await dbClient
                        .from('crm_leads')
                        .select('*', { count: 'exact', head: true })
                        .eq('tenant_id', tenantId)
                        .eq('assigned_user_id', s.id)
                        .in('status', ['NEW', 'CONTACTED', 'QUALIFIED']);

                    return { ...s, activeLeads: count || 0 };
                })
            );

            salesmenWithCounts.sort((a, b) => a.activeLeads - b.activeLeads);
            selectedSalesman = salesmenWithCounts[0];

            console.log('[AUTO_ASSIGN] LEAST_ACTIVE strategy - selected:', selectedSalesman.name, 'with', selectedSalesman.activeLeads, 'active leads');

        } else {
            // ROUND_ROBIN - simple rotation
            const randomIndex = Math.floor(Math.random() * salesmen.length);
            selectedSalesman = salesmen[randomIndex];

            console.log('[AUTO_ASSIGN] ROUND_ROBIN strategy - selected:', selectedSalesman.name);
        }

        // Assign lead
        const { error: assignErr } = await dbClient
            .from('crm_leads')
            .update({
                assigned_user_id: selectedSalesman.id,
                updated_at: new Date().toISOString()
            })
            .eq('id', leadId);

        if (assignErr) {
            console.error('[AUTO_ASSIGN] Assignment error:', assignErr);
            return { success: false, error: assignErr.message };
        }

        // Update triage item
        await dbClient
            .from('crm_triage_items')
            .update({
                status: 'ASSIGNED',
                assigned_user_id: selectedSalesman.id,
                updated_at: new Date().toISOString()
            })
            .eq('lead_id', leadId)
            .eq('status', 'OPEN');

        // Log assignment event
        await dbClient
            .from('crm_lead_events')
            .insert({
                tenant_id: tenantId,
                lead_id: leadId,
                event_type: 'LEAD_ASSIGNED',
                event_payload: {
                    assigned_to: selectedSalesman.id,
                    assigned_by: 'AUTO_ASSIGN',
                    strategy: settings.strategy
                }
            });

        console.log('[AUTO_ASSIGN] Success - assigned to:', selectedSalesman.name);

        return {
            success: true,
            assignedTo: selectedSalesman
        };

    } catch (error) {
        console.error('[AUTO_ASSIGN] Error:', error);
        return {
            success: false,
            error: error.message
        };
    }
}

module.exports = {
    createLeadFromWhatsApp,
    getLeadAssignmentSettings,
    autoAssignLead
};
