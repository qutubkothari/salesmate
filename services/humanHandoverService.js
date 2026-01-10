// services/humanHandoverService.js
const { dbClient } = require('./config');
const { sendMessage } = require('./whatsappService');
const { logMessage } = require('./historyService');

const detectHandoverTriggers = (userQuery) => {
    // âœ… CRITICAL FIX: Remove ALL discount/pricing patterns
    // Discount negotiation should be handled by discountNegotiationService, NOT handover
    
    const handoverPatterns = [
        // âœ… ONLY explicit human interaction requests
        /(?:speak|talk)\s+(?:to|with)\s+(?:a\s+)?(?:human|person|someone|agent|representative|team|manager)/i,
        /(?:connect|transfer)\s+me\s+(?:to|with)\s+(?:a\s+)?(?:human|person|agent|team)/i,
        /\bneed\s+(?:to\s+)?(?:speak|talk)\s+(?:to|with)\s+(?:a\s+)?(?:human|person|someone)/i,
        /\breal\s+(?:person|human|agent)\b/i,
        /\bactual\s+(?:person|human)\b/i,
        /\bcustomer\s+(?:service|support|care)\b/i,
        
        // âœ… Complaints and issues (but NOT pricing complaints)
        /\b(?:complaint|complain|not\s+happy|disappointed|angry|furious)\b/i,
        /\b(?:broken|damaged|defective|faulty|wrong\s+item)\b/i,
        /\bnot\s+working\b/i,
        /\bvery\s+(?:bad|poor|terrible)\s+(?:service|quality|experience)\b/i,
        
        // âœ… Custom/special requirements
        /\bcustom\s+(?:order|product|solution|requirement)\b/i,
        /\bspecial\s+(?:requirement|request|order)\b/i,
        /\bmodification\b/i,
        
        // âœ… Urgent matters
        /\b(?:urgent|emergency|asap|immediately|right\s+now)\b.*(?:help|need|require)/i,
        
        // âœ… Hinglish patterns for human interaction
        /\b(?:insaan|aadmi|vyakti)\s+(?:se|ko)\s+(?:baat|bat)\b/i,
        /\bmanushya\s+se\s+(?:baat|sampark)\b/i
    ];
    
    const hasHandoverTrigger = handoverPatterns.some(pattern => pattern.test(userQuery.toLowerCase()));
    
    if (hasHandoverTrigger) {
        console.log('[HANDOVER] âœ… Explicit human interaction request detected');
    }
    
    return hasHandoverTrigger;
};

const notifySalesTeam = async (tenant, customerPhone, userQuery, conversationContext = {}) => {
    try {
        const salesNumbers = await getSalesNumbers(tenant.id);
        if (salesNumbers.length === 0) {
            console.warn('[HANDOVER] No sales numbers configured for tenant:', tenant.id);
            return false;
        }
        
        // Create handover notification message
        const handoverMessage = createHandoverMessage(tenant, customerPhone, userQuery, conversationContext);
        
        // Send to all sales team members
        for (const salesPhone of salesNumbers) {
            await sendMessage(salesPhone, handoverMessage);
            await logMessage(tenant.id, salesPhone, 'bot', handoverMessage, 'sales_notification');
        }
        
        console.log(`[HANDOVER] Notified ${salesNumbers.length} sales team members for tenant ${tenant.id}`);
        return true;
        
    } catch (error) {
        console.error('[HANDOVER] Error notifying sales team:', error.message);
        return false;
    }
};

const getSalesNumbers = async (tenantId) => {
    try {
        const { data: tenant } = await dbClient
            .from('tenants')
            .select('sales_phone_primary, sales_phone_secondary, sales_team_phones')
            .eq('id', tenantId)
            .single();
            
        if (!tenant) return [];
        
        const salesNumbers = [];
        
        // Add primary sales number
        if (tenant.sales_phone_primary) {
            salesNumbers.push(tenant.sales_phone_primary);
        }
        
        // Add secondary sales number
        if (tenant.sales_phone_secondary) {
            salesNumbers.push(tenant.sales_phone_secondary);
        }
        
        // Add additional team numbers from JSONB array
        if (tenant.sales_team_phones && Array.isArray(tenant.sales_team_phones)) {
            salesNumbers.push(...tenant.sales_team_phones);
        }
        
        return [...new Set(salesNumbers)]; // Remove duplicates
        
    } catch (error) {
        console.error('[HANDOVER] Error getting sales numbers:', error.message);
        return [];
    }
};

const createHandoverMessage = (tenant, customerPhone, userQuery, context) => {
    const timestamp = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
    
    return `ðŸ”” **Customer Needs Assistance**
    
**Business:** ${tenant.business_name}
**Customer:** ${customerPhone}
**Time:** ${timestamp}

**Customer Query:**
"${userQuery}"

**Context:**
${context.lastProduct ? `Last discussed: ${context.lastProduct}` : ''}
${context.cartItems ? `Cart: ${context.cartItems} items` : ''}
${context.orderValue ? `Order Value: â‚¹${context.orderValue}` : ''}

**Action Required:**
${getActionSuggestion(userQuery)}

Reply to this customer on WhatsApp: ${customerPhone}`;
};

const getActionSuggestion = (query) => {
    const lowerQuery = query.toLowerCase();
    
    if (/complaint|problem|issue|not\s+working|broken|damaged/i.test(lowerQuery)) {
        return "âš ï¸ Customer has a complaint/issue - needs immediate attention";
    } else if (/custom|special|modification/i.test(lowerQuery)) {
        return "ðŸ”§ Customer needs custom solution or special requirements";
    } else if (/urgent|emergency|asap/i.test(lowerQuery)) {
        return "ðŸš¨ URGENT: Customer needs immediate assistance";
    } else {
        return "ðŸ’¬ Customer requesting human assistance";
    }
};

const sendHandoverResponse = async (customerPhone, tenantId, userLanguage = 'english') => {
    const responses = {
        english: "I've connected you with our sales team for personalized assistance. A team member will contact you shortly to help with your specific requirements. Thank you for your patience! ðŸ™",
        hinglish: "Main aapko hamare sales team se connect kar diya hai personalized help ke liye. Ek team member aapko jaldi contact karega aapki specific requirements ke liye. Thank you for your patience! ðŸ™"
    };
    
    const message = responses[userLanguage] || responses.english;
    await logMessage(tenantId, customerPhone, 'bot', message, 'handover_response');
    return message;
};

module.exports = {
    detectHandoverTriggers,
    notifySalesTeam,
    sendHandoverResponse,
    getSalesNumbers
};

