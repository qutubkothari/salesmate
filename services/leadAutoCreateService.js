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

            // Auto-qualify if strong intent or hot lead
            const shouldQualify = aiAnalysis.intent === 'purchase' || ['HOT', 'ON_FIRE'].includes(aiAnalysis.heat);
            if (shouldQualify && String(existingLead.status || '').toUpperCase() !== 'QUALIFIED') {
                updates.status = 'QUALIFIED';
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

            const shouldQualify = aiAnalysis.intent === 'purchase' || ['HOT', 'ON_FIRE'].includes(aiAnalysis.heat);

            const { data: newLead, error: createErr } = await dbClient
                .from('crm_leads')
                .insert({
                    tenant_id: tenantId,
                    phone: cleanPhone,
                    name: name || null,
                    channel,
                    status: shouldQualify ? 'QUALIFIED' : 'NEW',
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

        // Capture contact details into customer profile when provided
        let profileMissingDetails = false;
        if (messageBody) {
            try {
                const customerProfileService = require('./customerProfileService');
                const text = String(messageBody || '');
                
                // Enhanced extraction patterns
                const emailMatch = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
                
                // Try structured format first (Name: John Doe)
                let nameMatch = text.match(/(?:name|naam)\s*[:=]\s*([A-Za-z][A-Za-z\s]{1,50})/i);
                // Fallback to conversational format
                if (!nameMatch) {
                    nameMatch = text.match(/(?:my name is|i am|this is|i'm)\s+([A-Za-z][A-Za-z\s]{1,40})/i);
                }
                
                // Company extraction
                let companyMatch = text.match(/(?:company|business|firm|organisation|organization)\s*[:=]\s*([A-Za-z0-9][A-Za-z0-9\s&.]{2,60})/i);
                if (!companyMatch) {
                    companyMatch = text.match(/(?:from|representing|work at|at)\s+([A-Z][A-Za-z0-9\s&.]{2,50}(?:\s+(?:Ltd|Pvt|Inc|Corp|Co|Limited|Private))?)/);
                }
                
                const extracted = {
                    name: nameMatch ? nameMatch[1].trim() : undefined,
                    email: emailMatch ? emailMatch[0].trim() : undefined
                };
                
                // Add company to address field for now (can be separated later)
                if (companyMatch) {
                    extracted.address = companyMatch[1].trim();
                }

                if (extracted.name || extracted.email || extracted.address) {
                    await customerProfileService.upsertCustomerByPhone(tenantId, cleanPhone, extracted);
                    console.log('[LEAD_AUTO_CREATE] Customer profile updated:', extracted);
                }
                
                // Check if we still need customer details
                const { customer } = await customerProfileService.getCustomerByPhone(tenantId, cleanPhone);
                profileMissingDetails = !customer || (!customer.name && !customer.email);
                
            } catch (profileErr) {
                console.warn('[LEAD_AUTO_CREATE] Customer profile update failed:', profileErr?.message || profileErr);
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
            needsAssignment: !lead.assigned_user_id,
            needsCustomerDetails: profileMissingDetails && isNew
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
        // Prefer assignment_config (supports custom_rules)
        let config = null;
        let error = null;

        const assignmentResult = await dbClient
            .from('assignment_config')
            .select('*')
            .eq('tenant_id', tenantId)
            .maybeSingle();

        config = assignmentResult.data;
        error = assignmentResult.error;

        if (!config && (!error || error.code === 'PGRST116')) {
            const legacyResult = await dbClient
                .from('triage_assignment_config')
                .select('*')
                .eq('tenant_id', tenantId)
                .maybeSingle();
            config = legacyResult.data;
            error = legacyResult.error;
        }

        if (error && error.code !== 'PGRST116') {
            console.error('[LEAD_SETTINGS] Error:', error);
        }

        const customRules = parseJsonSafe(config?.custom_rules) || {};
        const assignmentMode = (customRules.assignment_mode || config?.strategy || 'ROUND_ROBIN').toUpperCase();

        return {
            autoAssign: config?.auto_assign === 1 || config?.auto_assign === true,
            strategy: config?.strategy || 'ROUND_ROBIN',
            considerCapacity: config?.consider_capacity === 1 || config?.consider_capacity === true,
            considerScore: config?.consider_score === 1 || config?.consider_score === true,
            assignmentMode,
            caps: customRules.caps || {},
            weights: customRules.weights || { conversion: 0.5, repeat: 0.3, revenue: 0.2 },
            windowDays: customRules.window_days || 30,
            rrIndex: customRules.rr_index || 0,
            customRules
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
            .in('is_active', [true, 1]);

        if (salesmenErr || !salesmen || salesmen.length === 0) {
            console.log('[AUTO_ASSIGN] No active salesmen available');
            return { success: false, reason: 'no_salesmen' };
        }

        let selectedSalesman;

        if (settings.assignmentMode === 'AUTO_TRAIN') {
            selectedSalesman = await selectSalesmanAutoTrain({ tenantId, salesmen, settings });
            if (selectedSalesman) {
                console.log('[AUTO_ASSIGN] AUTO_TRAIN selected:', selectedSalesman.name);
            }
        }

        if (!selectedSalesman) {
            if (settings.strategy === 'LEAST_ACTIVE') {
                const salesmenWithCounts = await getSalesmenWithActiveLeads(tenantId, salesmen);
                salesmenWithCounts.sort((a, b) => a.activeLeads - b.activeLeads);
                selectedSalesman = salesmenWithCounts[0];
                console.log('[AUTO_ASSIGN] LEAST_ACTIVE strategy - selected:', selectedSalesman.name, 'with', selectedSalesman.activeLeads, 'active leads');
            } else {
                selectedSalesman = await selectSalesmanRoundRobin({ tenantId, salesmen, settings });
                if (!selectedSalesman) {
                    const randomIndex = Math.floor(Math.random() * salesmen.length);
                    selectedSalesman = salesmen[randomIndex];
                }
                console.log('[AUTO_ASSIGN] ROUND_ROBIN strategy - selected:', selectedSalesman.name);
            }
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

function parseJsonSafe(value) {
    if (!value) return null;
    if (typeof value === 'object') return value;
    try {
        return JSON.parse(value);
    } catch (e) {
        return null;
    }
}

async function tableExists(table) {
    const { error } = await dbClient.from(table).select('id').limit(1);
    if (!error) return true;
    return !String(error.message || '').includes('Could not find the table');
}

function resolveCaps(caps = {}) {
    const day = caps.day || {};
    const week = caps.week || {};
    const month = caps.month || {};

    const maxPerDay = day.max ?? (week.max ? Math.ceil(week.max / 7) : (month.max ? Math.ceil(month.max / 30) : null));
    const minPerDay = day.min ?? (week.min ? Math.ceil(week.min / 7) : (month.min ? Math.ceil(month.min / 30) : null));

    return { minPerDay, maxPerDay };
}

async function getLeadCounts({ tenantId }) {
    const counts = new Map();
    const now = new Date();
    const startOfDay = new Date(now);
    startOfDay.setHours(0, 0, 0, 0);

    const hasLeads = await tableExists('crm_leads');
    if (!hasLeads) return { counts, source: 'none' };

    const { data } = await dbClient
        .from('crm_leads')
        .select('assigned_user_id, created_at')
        .eq('tenant_id', tenantId)
        .gte('created_at', startOfDay.toISOString());

    for (const row of data || []) {
        if (!row.assigned_user_id) continue;
        counts.set(row.assigned_user_id, (counts.get(row.assigned_user_id) || 0) + 1);
    }

    return { counts, source: 'crm_leads' };
}

async function getSalesmenWithActiveLeads(tenantId, salesmen) {
    const hasLeads = await tableExists('crm_leads');
    if (!hasLeads) {
        return salesmen.map(s => ({ ...s, activeLeads: 0 }));
    }

    const results = await Promise.all(
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

    return results;
}

async function selectSalesmanRoundRobin({ tenantId, salesmen, settings }) {
    const { minPerDay, maxPerDay } = resolveCaps(settings.caps || {});
    const { counts } = await getLeadCounts({ tenantId });

    let index = settings.rrIndex || 0;
    const maxAttempts = salesmen.length;
    let attempts = 0;

    while (attempts < maxAttempts) {
        const salesman = salesmen[index % salesmen.length];
        const assignedToday = counts.get(salesman.id) || 0;
        if (!maxPerDay || assignedToday < maxPerDay) {
            await updateRoundRobinIndex(tenantId, index + 1, settings.customRules || {});
            return salesman;
        }
        index += 1;
        attempts += 1;
    }

    await updateRoundRobinIndex(tenantId, index + 1, settings.customRules || {});
    return null;
}

async function updateRoundRobinIndex(tenantId, rrIndex, customRules) {
    const rules = { ...customRules, rr_index: rrIndex };
    const payload = {
        tenant_id: tenantId,
        strategy: 'ROUND_ROBIN',
        auto_assign: 1,
        consider_capacity: 1,
        consider_score: 1,
        custom_rules: JSON.stringify(rules),
        updated_at: new Date().toISOString()
    };

    await dbClient
        .from('assignment_config')
        .upsert(payload, { onConflict: 'tenant_id' });
}

async function selectSalesmanAutoTrain({ tenantId, salesmen, settings }) {
    const { minPerDay, maxPerDay } = resolveCaps(settings.caps || {});
    const { counts } = await getLeadCounts({ tenantId });

    const windowDays = settings.windowDays || 30;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - windowDays);

    const { data: visits } = await dbClient
        .from('visits')
        .select('salesman_id, created_at')
        .eq('tenant_id', tenantId)
        .gte('created_at', startDate.toISOString());

    const { data: orders } = await dbClient
        .from('orders_new')
        .select('salesman_id, customer_id, actual_amount, created_at')
        .eq('tenant_id', tenantId)
        .gte('created_at', startDate.toISOString());

    const stats = new Map();
    for (const s of salesmen) {
        stats.set(s.id, { visits: 0, orders: 0, revenue: 0, repeatCustomers: 0 });
    }

    for (const v of visits || []) {
        const s = stats.get(v.salesman_id);
        if (s) s.visits += 1;
    }

    const customerCounts = new Map();
    for (const o of orders || []) {
        const s = stats.get(o.salesman_id);
        if (s) {
            s.orders += 1;
            s.revenue += Number(o.actual_amount || 0);
            const key = o.salesman_id + ':' + o.customer_id;
            customerCounts.set(key, (customerCounts.get(key) || 0) + 1);
        }
    }

    for (const [key, count] of customerCounts.entries()) {
        if (count >= 2) {
            const salesmanId = key.split(':')[0];
            const s = stats.get(salesmanId);
            if (s) s.repeatCustomers += 1;
        }
    }

    const maxRevenue = Math.max(1, ...Array.from(stats.values()).map(s => s.revenue || 0));

    const weights = settings.weights || { conversion: 0.5, repeat: 0.3, revenue: 0.2 };
    const candidates = [];

    for (const s of salesmen) {
        const stat = stats.get(s.id) || { visits: 0, orders: 0, revenue: 0, repeatCustomers: 0 };
        const conversion = stat.visits > 0 ? stat.orders / stat.visits : 0;
        const repeatRate = stat.orders > 0 ? stat.repeatCustomers / stat.orders : 0;
        const revenueScore = stat.revenue / maxRevenue;

        let score = (weights.conversion || 0) * conversion
            + (weights.repeat || 0) * repeatRate
            + (weights.revenue || 0) * revenueScore;

        const assignedToday = counts.get(s.id) || 0;
        if (maxPerDay && assignedToday >= maxPerDay) {
            continue;
        }

        if (minPerDay && assignedToday < minPerDay) {
            score += 0.5; // fairness boost
        }

        candidates.push({ salesman: s, weight: Math.max(0.05, score) });
    }

    if (!candidates.length) return null;

    const total = candidates.reduce((sum, c) => sum + c.weight, 0);
    let pick = Math.random() * total;
    for (const c of candidates) {
        pick -= c.weight;
        if (pick <= 0) return c.salesman;
    }

    return candidates[0].salesman;
}

module.exports = {
    createLeadFromWhatsApp,
    getLeadAssignmentSettings,
    autoAssignLead
};
