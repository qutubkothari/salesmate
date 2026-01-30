// Modular customer handler: delegates all logic to mainHandler.js
const { handleCustomerMessage } = require('./modules/mainHandler');

// Convenience handler used by existing code paths (e.g. WAHA webhook bridge and /api_new/customer)
// Expects JSON body: { tenant_id, customer_phone, customer_message }
const handleCustomerTextMessage = async (req, res) => {
    const body = req.body || {};
    const tenantId = body.tenant_id || body.tenantId;
    const customerPhoneRaw = body.customer_phone || body.from || body.phone;
    const customerMessage = body.customer_message || body.message || body.text;

    if (!tenantId || !customerPhoneRaw || typeof customerMessage !== 'string') {
        return res.status(400).json({
            ok: false,
            error: 'Missing required fields',
            required: ['tenant_id', 'customer_phone', 'customer_message']
        });
    }

    const from = String(customerPhoneRaw).replace(/@c\.us$/i, '').trim();

    const { dbClient } = require('../../services/config');
    const { data: tenant, error } = await dbClient
        .from('tenants')
        .select('*')
        .eq('id', tenantId)
        .single();

    if (error || !tenant) {
        return res.status(404).json({
            ok: false,
            error: 'Tenant not found'
        });
    }

    // Build the request shape expected by handleCustomer()
    req.tenant = tenant;
    req.message = {
        from,
        to: tenant.bot_phone_number || null,
        type: 'text',
        text: { body: String(customerMessage) }
    };

    return handleCustomer(req, res);
};

const handleCustomer = async (req, res) => {
    const { message, tenant } = req;
    const from = message.from;
    let userQuery = '';
    if (message && message.text && typeof message.text.body === 'string') {
        userQuery = message.text.body.trim();
    } else if (typeof message === 'string') {
        userQuery = message.trim();
    } else {
        userQuery = '';
    }
    let conversation = null;
    const { dbClient } = require('../../services/config');
    const customerProfileService = require('../../services/customerProfileService');
    const { normalizePhone } = require('../../utils/phoneUtils');
    const { sendMessage } = require('../../services/whatsappService');
    const { createLeadFromWhatsApp } = require('../../services/leadAutoCreateService');
    
    let detailsRequest = { needed: false, leadId: null };
    try {
        // If customer shares structured details, capture immediately
        try {
            const text = String(userQuery || '');
            const nameMatch = text.match(/\bname\s*[:=]\s*([^\n\r]+)/i);
            const companyMatch = text.match(/\b(company|business)\s*[:=]\s*([^\n\r]+)/i);
            const emailMatch = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);

            const parsed = {
                name: nameMatch ? nameMatch[1].trim() : null,
                company: companyMatch ? companyMatch[2].trim() : null,
                email: emailMatch ? emailMatch[0].trim() : null
            };

            if (parsed.name || parsed.company || parsed.email) {
                console.log('[CUSTOMER_HANDLER] Parsed customer details:', parsed);
                await customerProfileService.upsertCustomerByPhone(tenant.id, from, {
                    contact_person: parsed.name || undefined,
                    business_name: parsed.company || undefined,
                    email: parsed.email || undefined
                });

                const cleanPhone = normalizePhone(from);
                if (cleanPhone) {
                    await dbClient
                        .from('crm_leads')
                        .update({
                            name: parsed.name || undefined,
                            company: parsed.company || undefined,
                            email: parsed.email || undefined,
                            updated_at: new Date().toISOString()
                        })
                        .eq('tenant_id', tenant.id)
                        .eq('phone', cleanPhone);
                }
            }
        } catch (detailsParseErr) {
            console.warn('[CUSTOMER_HANDLER] Failed to parse/save customer details:', detailsParseErr?.message || detailsParseErr);
        }

        // Fetch latest conversation context
        const { data: conversationData, error } = await dbClient
            .from('conversations_new')
            .select('*')
            .eq('tenant_id', tenant.id)
            .eq('end_user_phone', from)
            .single();
        
        if (conversationData) {
            conversation = conversationData;
        } else if (error && error.code === 'PGRST116') {
            // No conversation found, create a new one
            console.log('[CUSTOMER_HANDLER] No conversation found, creating new one for:', from);
            const { data: newConv, error: createError } = await dbClient
                .from('conversations_new')
                .insert({
                    tenant_id: tenant.id,
                    end_user_phone: from,
                    created_at: new Date().toISOString(),
                    updated_at: new Date().toISOString(),
                    last_message_at: new Date().toISOString()
                })
                .select()
                .single();
            
            if (newConv) {
                conversation = newConv;
                console.log('[CUSTOMER_HANDLER] Created new conversation:', newConv.id);
            } else {
                console.error('[CUSTOMER_HANDLER] Failed to create conversation:', createError);
            }
        }
        
        // AUTO-CREATE CUSTOMER PROFILE (if it doesn't exist)
        try {
            const { customer: existingCustomer } = await customerProfileService.getCustomerByPhone(tenant.id, from);
            if (!existingCustomer) {
                console.log('[CUSTOMER_HANDLER] Creating new customer profile for:', from);
                await customerProfileService.upsertCustomerByPhone(tenant.id, from, {
                    name: null, // Will be updated later when AI extracts name
                    lead_score: 0
                });
                console.log('[CUSTOMER_HANDLER] Customer profile created');
            }
        } catch (customerError) {
            console.error('[CUSTOMER_HANDLER] Error creating customer profile:', customerError);
            // Continue even if customer creation fails
        }

        // Ensure lead exists and track missing customer details for follow-up
        try {
            const leadResult = await createLeadFromWhatsApp({
                tenantId: tenant.id,
                phone: from,
                name: null,
                messageBody: userQuery,
                salesmanId: null,
                sessionName: 'customer_handler'
            });

            if (leadResult.success && leadResult.needsCustomerDetails) {
                detailsRequest = { needed: true, leadId: leadResult.lead.id };
                console.log('[CUSTOMER_HANDLER] Missing customer details; will ask after reply');
            }
        } catch (detailsErr) {
            console.warn('[CUSTOMER_HANDLER] Details request check failed:', detailsErr?.message || detailsErr);
        }
    } catch (e) {
        console.error('[CUSTOMER_HANDLER] Error fetching/creating conversation:', e);
        conversation = null;
    }

    const response = await handleCustomerMessage(req, res, tenant, from, userQuery, conversation);

    if (detailsRequest.needed && detailsRequest.leadId) {
        try {
            const detailsMsg = `By the way, to serve you better, could you please share your name, company name, and email (optional)?\n\nReply in this format:\nName: Your Name\nCompany: Your Company\nEmail (optional): yourname [at] domain [dot] com`;
            await sendMessage(from, detailsMsg, tenant.id);

            await dbClient.from('crm_lead_events').insert({
                id: require('crypto').randomUUID(),
                tenant_id: tenant.id,
                lead_id: detailsRequest.leadId,
                event_type: 'DETAILS_REQUESTED',
                event_payload: { source: 'customer_handler', timing: 'post_reply' },
                created_at: new Date().toISOString()
            });
        } catch (sendErr) {
            console.warn('[CUSTOMER_HANDLER] Failed to send follow-up details request:', sendErr?.message || sendErr);
        }
    }
    
    return response;
};

module.exports = {
    handleCustomer,
    handleCustomerTextMessage
};

