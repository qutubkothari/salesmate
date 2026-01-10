/**
 * Desktop Agent API Routes
 * Handles communication between PC desktop agents and cloud server
 */

const express = require('express');
const router = express.Router();
const { dbClient } = require('../../services/config');
const openaiService = require('../../services/openaiService');
const productService = require('../../services/productService');
const orderService = require('../../services/orderService');

// Middleware: API Key Authentication
const authenticateAgent = (req, res, next) => {
    const apiKey = req.headers['x-api-key'];
    
    if (!apiKey) {
        return res.status(401).json({ error: 'API key required' });
    }
    
    // Verify API key belongs to a tenant
    // In production, validate against database
    // For now, accept any non-empty key
    req.agentAuthenticated = true;
    next();
};

router.use(authenticateAgent);

/**
 * Register Desktop Agent
 * Called when agent starts up and connects to WhatsApp
 */
router.post('/register', async (req, res) => {
    try {
        const { tenantId, phoneNumber, deviceName, status } = req.body;
        
        console.log(`ðŸ“± Desktop Agent registered: ${tenantId} - ${phoneNumber}`);
        
        // Update tenant's desktop agent status
        const { error } = await dbClient
            .from('tenants')
            .update({
                desktop_agent_status: status,
                desktop_agent_phone: phoneNumber,
                desktop_agent_device: deviceName,
                desktop_agent_last_seen: new Date().toISOString()
            })
            .eq('id', tenantId);
        
        if (error) throw error;
        
        res.json({
            success: true,
            message: 'Agent registered successfully',
            tenantId: tenantId
        });
        
    } catch (error) {
        console.error('Error registering agent:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * Process Message from WhatsApp
 * Desktop agent forwards incoming messages here for AI processing
 */
router.post('/process-message', async (req, res) => {
    try {
        const { tenantId, from, message, timestamp, messageId } = req.body;
        
        console.log(`ðŸ’¬ Processing message for ${tenantId} from ${from}`);
        
        // Get tenant configuration
        const { data: tenant, error: tenantError } = await dbClient
            .from('tenants')
            .select('*')
            .eq('id', tenantId)
            .single();
        
        if (tenantError || !tenant) {
            throw new Error('Tenant not found');
        }
        
        // Extract customer phone number (remove @c.us suffix)
        const customerPhone = from.replace('@c.us', '');
        
        // Get or create customer profile
        let { data: customer } = await dbClient
            .from('customer_profiles')
            .select('*')
            .eq('tenant_id', tenantId)
            .eq('phone', customerPhone)
            .single();
        
        if (!customer) {
            // Create new customer
            const { data: newCustomer, error: createError } = await dbClient
                .from('customer_profiles')
                .insert({
                    tenant_id: tenantId,
                    phone: customerPhone,
                    conversation_state: 'greeting',
                    created_at: new Date().toISOString()
                })
                .select()
                .single();
            
            if (createError) throw createError;
            customer = newCustomer;
        }
        
        // Store incoming message
        await dbClient
            .from('messages')
            .insert({
                tenant_id: tenantId,
                customer_phone: customerPhone,
                message_text: message,
                direction: 'incoming',
                timestamp: timestamp,
                external_id: messageId
            });
        
        // Generate AI response using existing service
        const conversationHistory = await getConversationHistory(tenantId, customerPhone);
        
        const aiResponse = await openaiService.generateResponse({
            tenantId: tenantId,
            customerMessage: message,
            conversationHistory: conversationHistory,
            customerProfile: customer,
            tenantConfig: tenant
        });
        
        // Store outgoing message
        await dbClient
            .from('messages')
            .insert({
                tenant_id: tenantId,
                customer_phone: customerPhone,
                message_text: aiResponse,
                direction: 'outgoing',
                timestamp: new Date().toISOString()
            });
        
        // Update customer last interaction
        await dbClient
            .from('customer_profiles')
            .update({
                last_interaction: new Date().toISOString()
            })
            .eq('id', customer.id);
        
        res.json({
            success: true,
            reply: aiResponse,
            customerId: customer.id
        });
        
    } catch (error) {
        console.error('Error processing message:', error);
        res.status(500).json({ 
            error: error.message,
            reply: 'Sorry, I am temporarily unable to process your message. Please try again.'
        });
    }
});

/**
 * Message Sent Confirmation
 * Desktop agent confirms message was delivered
 */
router.post('/message-sent', async (req, res) => {
    try {
        const { tenantId, messageId, sentAt } = req.body;
        
        // Update message status
        await dbClient
            .from('messages')
            .update({
                status: 'sent',
                sent_at: sentAt
            })
            .eq('external_id', messageId);
        
        res.json({ success: true });
        
    } catch (error) {
        console.error('Error updating message status:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * Agent Disconnect
 * Called when agent shuts down
 */
router.post('/disconnect', async (req, res) => {
    try {
        const { tenantId } = req.body;
        
        console.log(`ðŸ“´ Desktop Agent disconnected: ${tenantId}`);
        
        await dbClient
            .from('tenants')
            .update({
                desktop_agent_status: 'offline',
                desktop_agent_last_seen: new Date().toISOString()
            })
            .eq('id', tenantId);
        
        res.json({ success: true });
        
    } catch (error) {
        console.error('Error disconnecting agent:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * Get Agent Status
 * Check if desktop agent is online
 */
router.get('/status/:tenantId', async (req, res) => {
    try {
        const { tenantId } = req.params;
        
        const { data: tenant, error } = await dbClient
            .from('tenants')
            .select('desktop_agent_status, desktop_agent_phone, desktop_agent_device, desktop_agent_last_seen')
            .eq('id', tenantId)
            .single();
        
        if (error) throw error;
        
        res.json({
            status: tenant.desktop_agent_status || 'offline',
            phone: tenant.desktop_agent_phone,
            device: tenant.desktop_agent_device,
            lastSeen: tenant.desktop_agent_last_seen
        });
        
    } catch (error) {
        console.error('Error getting agent status:', error);
        res.status(500).json({ error: error.message });
    }
});

// Helper: Get conversation history
async function getConversationHistory(tenantId, customerPhone, limit = 10) {
    const { data: messages } = await dbClient
        .from('messages')
        .select('message_text, direction, timestamp')
        .eq('tenant_id', tenantId)
        .eq('customer_phone', customerPhone)
        .order('timestamp', { ascending: false })
        .limit(limit);
    
    if (!messages) return [];
    
    return messages.reverse().map(m => ({
        role: m.direction === 'incoming' ? 'user' : 'assistant',
        content: m.message_text
    }));
}

module.exports = router;

