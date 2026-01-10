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
    
    try {
        // Fetch latest conversation context
        const { data: conversationData, error } = await dbClient
            .from('conversations')
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
                .from('conversations')
                .insert({
                    tenant_id: tenant.id,
                    phone_number: from,
                    end_user_phone: from,
                    state: 'IDLE',
                    metadata: {},
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
    } catch (e) {
        console.error('[CUSTOMER_HANDLER] Error fetching/creating conversation:', e);
        conversation = null;
    }
    
    return await handleCustomerMessage(req, res, tenant, from, userQuery, conversation);
};

module.exports = {
    handleCustomer,
    handleCustomerTextMessage
};

