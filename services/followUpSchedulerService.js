// services/followUpSchedulerService.js
const { dbClient } = require('./config');
const { sendMessage } = require('./whatsappService');
const { sendWebMessage, getClientStatus } = require('./whatsappWebService');
const { logMessage } = require('./historyService');
const { isUnsubscribed } = require('./unsubscribeService');

const toDigits = (value) => String(value || '').replace(/\D/g, '');

/**
 * Send follow-up message using the best available transport.
 * Prefers WhatsApp Web (desktop agent / QR) when ready, falls back to Maytapi.
 */
async function sendFollowUpSmart(tenantId, phoneNumber, messageText) {
    // Enforce opt-out list (no automated outbound to unsubscribed customers)
    if (await isUnsubscribed(phoneNumber)) {
        return { method: 'skipped', messageId: null, skipped: true, reason: 'User unsubscribed' };
    }

    const waWebStatus = getClientStatus(tenantId);
    if (waWebStatus?.status === 'ready' && waWebStatus?.hasClient) {
        const res = await sendWebMessage(tenantId, phoneNumber, messageText);
        return { method: 'whatsapp-web', messageId: res?.messageId || null };
    }

    // Fallback to Maytapi (expects digits)
    const to = toDigits(phoneNumber);
    if (!to) {
        throw new Error('Invalid recipient phone number');
    }

    const messageId = await sendMessage(to, messageText);
    if (!messageId) {
        const hint = process.env.USE_LOCAL_DB === 'true'
            ? 'Connect WhatsApp Web (QR) or configure Maytapi env vars.'
            : 'Check Maytapi configuration and connectivity.';
        throw new Error(`Failed to send follow-up message. ${hint}`);
    }
    return { method: 'maytapi', messageId };
}

/**
 * Follow-up detection patterns configuration
 * NOTE: Order matters! More specific patterns should come first
 */
const followUpPatterns = [
    {
        regex: /(?:call|remind|contact|follow.*up|check.*back).*(?:after|in)\s*(\d+)\s*(min|mins|minute|minutes|hr|hrs|hour|hours|day|days)/i,
        type: 'relative_time'
    },
    {
        regex: /(?:call|remind|contact|follow.*up).*(?:on|at)\s*(\d{1,2}[:/]?\d{0,2}\s*(?:am|pm)?)/i,
        type: 'specific_time'
    },
    {
        regex: /(?:call|remind|contact|follow.*up).*(?:tomorrow|next\s*week|next\s*month)/i,
        type: 'relative_day'
    },
    {
        regex: /(?:call|remind|contact|follow.*up).*(?:morning|afternoon|evening|night)/i,
        type: 'time_of_day'
    },
    {
        regex: /(?:call|remind|contact|phone).*(?:kar.*do|karna|please)/i,
        type: 'hinglish_request'
    },
    {
        regex: /(?:follow.*up|check.*back|get.*back.*to.*me|contact.*me.*later)/i,
        type: 'general_followup'
    }
];

/**
 * Detect follow-up scheduling requests from customer messages
 */
const detectFollowUpRequest = (userQuery) => {
    console.log('[FOLLOWUP_DETECT] Analyzing:', userQuery);
    
    const lowerQuery = userQuery.toLowerCase();
    
    // Use module-level patterns configuration
    for (const pattern of followUpPatterns) {
        const match = lowerQuery.match(pattern.regex);
        if (match) {
            console.log('[FOLLOWUP_DETECT] Matched pattern:', pattern.type, match[0]);
            return {
                detected: true,
                type: pattern.type,
                match: match[0],
                fullGroups: match,
                originalQuery: userQuery
            };
        }
    }
    
    console.log('[FOLLOWUP_DETECT] No follow-up pattern detected');
    return { detected: false };
};

/**
 * Parse follow-up time from detected patterns
 */
const parseFollowUpTime = (detection) => {
    const { type, fullGroups, originalQuery } = detection;
    const now = new Date();
    let scheduledTime = null;
    let description = '';
    
    console.log('[FOLLOWUP_PARSE] Parsing type:', type, fullGroups);
    
    switch (type) {
        case 'relative_time':
            const timeValue = parseInt(fullGroups[1]);
            const timeUnit = fullGroups[2] ? fullGroups[2].toLowerCase() : 'minutes'; // Default fallback
            
            if (timeUnit.includes('day')) {
                scheduledTime = new Date(now.getTime() + (timeValue * 24 * 60 * 60 * 1000));
                description = `Follow up after ${timeValue} day${timeValue > 1 ? 's' : ''}`;
            } else if (timeUnit.includes('hour')) {
                scheduledTime = new Date(now.getTime() + (timeValue * 60 * 60 * 1000));
                description = `Follow up after ${timeValue} hour${timeValue > 1 ? 's' : ''}`;
            } else if (timeUnit.includes('min')) {
                scheduledTime = new Date(now.getTime() + (timeValue * 60 * 1000));
                description = `Follow up after ${timeValue} minute${timeValue > 1 ? 's' : ''}`;
            }
            break;
            
        case 'relative_day':
            if (originalQuery.toLowerCase().includes('tomorrow')) {
                scheduledTime = new Date(now.getTime() + (24 * 60 * 60 * 1000));
                scheduledTime.setHours(10, 0, 0, 0); // 10 AM next day
                description = 'Follow up tomorrow morning';
            } else if (originalQuery.toLowerCase().includes('next week')) {
                scheduledTime = new Date(now.getTime() + (7 * 24 * 60 * 60 * 1000));
                scheduledTime.setHours(10, 0, 0, 0);
                description = 'Follow up next week';
            } else if (originalQuery.toLowerCase().includes('next month')) {
                scheduledTime = new Date(now.getFullYear(), now.getMonth() + 1, now.getDate(), 10, 0, 0);
                description = 'Follow up next month';
            }
            break;
            
        case 'specific_time':
            // Parse "3pm", "5:30pm", "3:00", "15:30"
            const timeStr = fullGroups[1]; // e.g., "3pm", "5:30pm", "15:30"
            scheduledTime = new Date(now);
            
            let hour = 0;
            let minute = 0;
            let isPM = /pm/i.test(timeStr);
            let isAM = /am/i.test(timeStr);
            
            // Remove am/pm for parsing
            const cleanTime = timeStr.replace(/[ap]m/i, '').trim();
            
            if (cleanTime.includes(':')) {
                // Format: "5:30" or "15:30"
                const [h, m] = cleanTime.split(':');
                hour = parseInt(h);
                minute = parseInt(m);
            } else {
                // Format: "3" or "15"
                hour = parseInt(cleanTime);
                minute = 0;
            }
            
            // Convert 12-hour to 24-hour format
            if (isPM && hour < 12) {
                hour += 12;
            } else if (isAM && hour === 12) {
                hour = 0;
            }
            
            // Set the time
            scheduledTime.setHours(hour, minute, 0, 0);
            
            // If the time has already passed today, schedule for tomorrow
            if (scheduledTime <= now) {
                scheduledTime.setDate(scheduledTime.getDate() + 1);
                description = `Follow up tomorrow at ${timeStr}`;
            } else {
                description = `Follow up today at ${timeStr}`;
            }
            break;
            
        case 'time_of_day':
            const timeOfDay = originalQuery.toLowerCase();
            scheduledTime = new Date(now);
            
            if (timeOfDay.includes('morning')) {
                scheduledTime.setDate(scheduledTime.getDate() + 1);
                scheduledTime.setHours(9, 0, 0, 0);
                description = 'Follow up tomorrow morning';
            } else if (timeOfDay.includes('afternoon')) {
                scheduledTime.setDate(scheduledTime.getDate() + 1);
                scheduledTime.setHours(14, 0, 0, 0);
                description = 'Follow up tomorrow afternoon';
            } else if (timeOfDay.includes('evening')) {
                // Check if they mean today evening or tomorrow
                const currentHour = now.getHours();
                if (currentHour < 18) {
                    // Today evening
                    scheduledTime.setHours(18, 0, 0, 0);
                    description = 'Follow up this evening';
                } else {
                    // Tomorrow evening
                    scheduledTime.setDate(scheduledTime.getDate() + 1);
                    scheduledTime.setHours(18, 0, 0, 0);
                    description = 'Follow up tomorrow evening';
                }
            } else if (timeOfDay.includes('night')) {
                scheduledTime.setDate(scheduledTime.getDate() + 1);
                scheduledTime.setHours(20, 0, 0, 0);
                description = 'Follow up tomorrow night';
            }
            break;
            
        case 'hinglish_request':
        case 'general_followup':
            // Default to 1 day follow-up
            scheduledTime = new Date(now.getTime() + (24 * 60 * 60 * 1000));
            scheduledTime.setHours(10, 0, 0, 0);
            description = 'Follow up tomorrow';
            break;
    }
    
    console.log('[FOLLOWUP_PARSE] Scheduled time:', scheduledTime, description);
    
    return {
        scheduledTime,
        description,
        isValid: scheduledTime !== null
    };
};

/**
 * Create follow-up schedule in database
 */
const scheduleFollowUp = async (tenantId, endUserPhone, followUpData, conversationContext = null) => {
    try {
        console.log('[FOLLOWUP_SCHEDULE] Creating follow-up:', followUpData);
        
        const { data: followUp, error } = await dbClient
            .from('scheduled_followups')
            .insert({
                tenant_id: tenantId,
                end_user_phone: endUserPhone,
                scheduled_time: followUpData.scheduledTime.toISOString(),
                description: followUpData.description,
                original_request: followUpData.originalRequest || '',
                conversation_context: conversationContext || {},
                status: 'scheduled',
                created_at: new Date().toISOString()
            })
            .select('*')
            .single();
            
        if (error) {
            console.error('[FOLLOWUP_SCHEDULE] Database error:', error.message);
            throw error;
        }
        
        console.log('[FOLLOWUP_SCHEDULE] Created follow-up:', followUp.id);
        return followUp;
        
    } catch (error) {
        console.error('[FOLLOWUP_SCHEDULE] Error creating follow-up:', error.message);
        throw error;
    }
};

/**
 * Generate confirmation message for scheduled follow-up
 */
const generateFollowUpConfirmation = (followUpData, userLanguage = 'english') => {
    const { scheduledTime, description } = followUpData;
    const scheduledDate = scheduledTime.toLocaleDateString('en-IN', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    });
    const scheduledTimeStr = scheduledTime.toLocaleTimeString('en-IN', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: true
    });
    
    if (userLanguage === 'hinglish') {
        return `✅ **Follow-up scheduled!**\n\n` +
               `Main aapko **${scheduledDate}** ko **${scheduledTimeStr}** par contact karunga.\n\n` +
               `${description}\n\n` +
               `Agar aapko koi urgent help chahiye toh message kar sakte hain. Thank you! 🙏`;
    } else {
        return `✅ **Follow-up scheduled!**\n\n` +
               `I'll contact you on **${scheduledDate}** at **${scheduledTimeStr}**.\n\n` +
               `${description}\n\n` +
               `If you need any urgent help before then, feel free to message anytime. Thank you! 🙏`;
    }
};

/**
 * Main function to handle follow-up scheduling requests
 */
const handleFollowUpRequest = async (tenantId, endUserPhone, userQuery, userLanguage = 'english') => {
    try {
        console.log('[FOLLOWUP_HANDLER] Processing request:', userQuery);
        
        // Detect if it's a follow-up request
        const detection = detectFollowUpRequest(userQuery);
        
        if (!detection.detected) {
            console.log('[FOLLOWUP_HANDLER] No follow-up request detected');
            return { handled: false };
        }
        
        // Parse the timing
        const timeData = parseFollowUpTime(detection);
        
        if (!timeData.isValid) {
            console.log('[FOLLOWUP_HANDLER] Invalid time data');
            return { 
                handled: true,
                response: "I understand you'd like a follow-up, but I couldn't determine the exact timing. Could you please specify when you'd like me to contact you?"
            };
        }
        
        // Get comprehensive conversation context for follow-up
        let conversationContext = {
            last_query: userQuery,
            detected_type: detection.type,
            scheduling_time: new Date().toISOString()
        };
        
        // Fetch recent conversation data for context
        try {
            const { data: conversation } = await dbClient
                .from('conversations_new')
                .select('last_quoted_products, last_product_discussed, state, metadata')
                .eq('tenant_id', tenantId)
                .eq('end_user_phone', endUserPhone)
                .single();
            
            if (conversation) {
                // Add quoted products context
                if (conversation.last_quoted_products) {
                    try {
                        const quotedProducts = typeof conversation.last_quoted_products === 'string'
                            ? JSON.parse(conversation.last_quoted_products)
                            : conversation.last_quoted_products;
                        conversationContext.quoted_products = quotedProducts;
                    } catch (e) {
                        console.warn('[FOLLOWUP_CONTEXT] Could not parse quoted_products:', e.message);
                    }
                }
                
                // Add discount context if available
                if (conversation.metadata) {
                    try {
                        const metadata = typeof conversation.metadata === 'string'
                            ? JSON.parse(conversation.metadata)
                            : conversation.metadata;
                        if (metadata.approvedDiscount) {
                            conversationContext.approved_discount = metadata.approvedDiscount;
                        }
                        if (metadata.discountTimestamp) {
                            conversationContext.discount_timestamp = metadata.discountTimestamp;
                        }
                    } catch (e) {
                        console.warn('[FOLLOWUP_CONTEXT] Could not parse metadata:', e.message);
                    }
                }
                
                // Add conversation state
                conversationContext.conversation_state = conversation.state;
                
                // Add last discussed product
                if (conversation.last_product_discussed) {
                    conversationContext.last_product = conversation.last_product_discussed;
                }
            }
            
            // Fetch cart items if any
            const { data: cart } = await dbClient
                .from('carts')
                .select(`
                    id,
                    cart_items (
                        quantity,
                        carton_price_override,
                        product:products (product_code, product_name, price, units_per_carton)
                    )
                `)
                .eq('conversation_id', conversation?.id)
                .single();
            
            if (cart && cart.cart_items && cart.cart_items.length > 0) {
                conversationContext.cart_items = cart.cart_items.map(item => ({
                    product_code: item.product.product_code,
                    product_name: item.product.product_name,
                    quantity: item.quantity,
                    price: item.carton_price_override || item.product.price
                }));
            }
            
            console.log('[FOLLOWUP_CONTEXT] Captured context:', {
                hasQuotedProducts: !!conversationContext.quoted_products,
                hasCartItems: !!conversationContext.cart_items,
                hasDiscount: !!conversationContext.approved_discount,
                state: conversationContext.conversation_state
            });
            
        } catch (contextError) {
            console.warn('[FOLLOWUP_CONTEXT] Error fetching context:', contextError.message);
            // Continue with minimal context
        }
        
        // Schedule the follow-up
        const followUp = await scheduleFollowUp(
            tenantId, 
            endUserPhone, 
            {
                ...timeData,
                originalRequest: userQuery
            },
            conversationContext
        );
        
        // Generate confirmation message
        const confirmationMessage = generateFollowUpConfirmation(timeData, userLanguage);
        
        console.log('[FOLLOWUP_HANDLER] Successfully scheduled follow-up:', followUp.id);
        
        return {
            handled: true,
            response: confirmationMessage,
            followUpId: followUp.id,
            scheduledTime: timeData.scheduledTime
        };
        
    } catch (error) {
        console.error('[FOLLOWUP_HANDLER] Error handling follow-up request:', error.message);
        return {
            handled: true,
            response: "I understand you'd like a follow-up. I've noted your request and will get back to you soon!"
        };
    }
};

/**
 * Process scheduled follow-ups (to be called by a cron job or scheduler)
 */
const processScheduledFollowUps = async () => {
    try {
        const now = new Date();
        const fiveMinutesFromNow = new Date(now.getTime() + (5 * 60 * 1000));
        
        console.log('[FOLLOWUP_PROCESSOR] Checking for follow-ups due before:', fiveMinutesFromNow.toISOString());
        
        // Get follow-ups that are due
        const { data: dueFollowUps, error } = await dbClient
            .from('scheduled_followups')
            .select('*')
            .eq('status', 'scheduled')
            .lte('scheduled_time', fiveMinutesFromNow.toISOString())
            .order('scheduled_time');
            
        if (error) {
            console.error('[FOLLOWUP_PROCESSOR] Database error:', error.message);
            return;
        }
        
        if (!dueFollowUps || dueFollowUps.length === 0) {
            console.log('[FOLLOWUP_PROCESSOR] No follow-ups due');
            return;
        }
        
        console.log('[FOLLOWUP_PROCESSOR] Processing', dueFollowUps.length, 'follow-ups');
        
        // Process each follow-up
        for (const followUp of dueFollowUps) {
            try {
                await processIndividualFollowUp(followUp);
            } catch (error) {
                console.error('[FOLLOWUP_PROCESSOR] Error processing follow-up:', followUp.id, error.message);
            }
        }
        
    } catch (error) {
        console.error('[FOLLOWUP_PROCESSOR] Error in processScheduledFollowUps:', error.message);
    }
};

/**
 * Process an individual follow-up
 */
const processIndividualFollowUp = async (followUp, options = {}) => {
    const { throwOnError = false } = options;
    try {
        console.log('[FOLLOWUP_PROCESS_INDIVIDUAL] Processing:', followUp.id);
        
        // Generate context-aware follow-up message
        let followUpMessage = `👋 Hi! This is your scheduled follow-up.\n\n`;
        
        // Parse conversation context
        const context = followUp.conversation_context || {};
        let hasContext = false;
        
        // Add quoted products context
        if (context.quoted_products && Array.isArray(context.quoted_products) && context.quoted_products.length > 0) {
            hasContext = true;
            const products = context.quoted_products.slice(0, 3); // Show max 3 products
            followUpMessage += `Following up on the products you were interested in:\n\n`;
            
            for (const product of products) {
                const productCode = product.productCode || product.product_code;
                const productName = product.productName || product.product_name;
                const quantity = product.quantity || 1;
                const price = product.price;
                
                if (price) {
                    const unitsPerCarton = product.unitsPerCarton || product.units_per_carton || 1;
                    const pricePerPiece = (price / unitsPerCarton).toFixed(2);
                    followUpMessage += `• ${productCode} - ${quantity} carton${quantity > 1 ? 's' : ''} @ ₹${pricePerPiece}/pc\n`;
                } else {
                    followUpMessage += `• ${productCode || productName}\n`;
                }
            }
            
            if (context.quoted_products.length > 3) {
                followUpMessage += `...and ${context.quoted_products.length - 3} more\n`;
            }
            followUpMessage += `\n`;
        }
        
        // Add cart items context
        if (!hasContext && context.cart_items && Array.isArray(context.cart_items) && context.cart_items.length > 0) {
            hasContext = true;
            const items = context.cart_items.slice(0, 3);
            followUpMessage += `Following up on your cart:\n\n`;
            
            for (const item of items) {
                followUpMessage += `• ${item.product_code} - ${item.quantity} carton${item.quantity > 1 ? 's' : ''}\n`;
            }
            
            if (context.cart_items.length > 3) {
                followUpMessage += `...and ${context.cart_items.length - 3} more items\n`;
            }
            followUpMessage += `\n`;
        }
        
        // Add discount context
        if (context.approved_discount) {
            followUpMessage += `Reminder: You have ${context.approved_discount}% discount approved! ✅\n\n`;
            hasContext = true;
        }
        
        // Add conversation state context
        if (context.conversation_state === 'pricing_inquiry') {
            followUpMessage += `Ready to proceed with your order?\n\n`;
            hasContext = true;
        } else if (context.conversation_state === 'discount_approved') {
            followUpMessage += `Ready to place your order with the approved discount?\n\n`;
            hasContext = true;
        }
        
        // Generic ending
        if (hasContext) {
            followUpMessage += `Would you like to proceed? Let me know how I can help! 😊`;
        } else {
            // Fallback for no context
            followUpMessage += `${followUp.description}\n\nHow can I help you today?`;
        }
        
        // Send the follow-up message (smart transport)
        const sendResult = await sendFollowUpSmart(followUp.tenant_id, followUp.end_user_phone, followUpMessage);

        if (sendResult?.skipped) {
            await dbClient
                .from('scheduled_followups')
                .update({
                    status: 'skipped',
                    delivery_method: sendResult?.method || null,
                    whatsapp_message_id: null,
                    error_message: sendResult?.reason || 'User unsubscribed',
                    completed_at: new Date().toISOString()
                })
                .eq('id', followUp.id);

            console.log('[FOLLOWUP_PROCESS_INDIVIDUAL] Skipped follow-up (unsubscribed):', followUp.id);
            return;
        }

        // Log the follow-up message only when actually sent
        await logMessage(
            followUp.tenant_id,
            followUp.end_user_phone,
            'bot',
            followUpMessage,
            'scheduled_followup'
        );

        // Update follow-up status
        await dbClient
            .from('scheduled_followups')
            .update({
                status: 'completed',
                delivery_method: sendResult?.method || null,
                whatsapp_message_id: sendResult?.messageId || null,
                completed_at: new Date().toISOString()
            })
            .eq('id', followUp.id);
            
        console.log('[FOLLOWUP_PROCESS_INDIVIDUAL] Completed follow-up:', followUp.id);
        
    } catch (error) {
        console.error('[FOLLOWUP_PROCESS_INDIVIDUAL] Error processing follow-up:', followUp.id, error.message);
        
        // Mark as failed
        await dbClient
            .from('scheduled_followups')
            .update({
                status: 'failed',
                error_message: error.message,
                completed_at: new Date().toISOString()
            })
            .eq('id', followUp.id);

        if (throwOnError) {
            throw error;
        }
    }
};

// followUp parsing + scheduling helper (robust)
// Put near your follow-up service's other functions.

/**
 * Parse a follow-up request and schedule it.
 * @param {string} text - raw user message
 * @param {string} from - user id / phone (e.g. '919106886259@c.us' or digits)
 * @param {string} tenantId - tenant.uuid
 * @param {object} opts - optional: { note, createdBy }
 */
async function parseAndScheduleFollowUp(text, from, tenantId, opts = {}) {
  try {
    if (!text) throw new Error('empty text for follow-up parse');

    // Accept optional unit (e.g., "30mins", "30 min", "30")
    const re = /(?:call|remind|contact|follow.*up).*(?:after|in)\s*(\d+)\s*(min|mins|minute|minutes|hr|hrs|hour|hours|day|days)?/i;
    const m = String(text || '').match(re);
    if (!m) {
      console.log('[FOLLOWUP_PARSE] no relative-time match for:', text);
      return { ok: false, reason: 'no-match' };
    }

    const amount = parseInt(m[1], 10) || 0;
    // default to minutes when unit missing
    const rawUnit = (m[2] || 'min').toString();
    const unit = rawUnit.toLowerCase();

    const unitMap = {
      min: 1, mins: 1, minute: 1, minutes: 1,
      hr: 60, hrs: 60, hour: 60, hours: 60,
      day: 60 * 24, days: 60 * 24
    };

    const multiplier = unitMap[unit] ?? 1;
    const minutes = Math.max(1, amount) * multiplier;
    const dueAt = new Date(Date.now() + minutes * 60_000).toISOString();

    const payload = {
      tenant_id: tenantId || null,
      phone: typeof from === 'string' ? String(from).replace(/\D/g,'') : null,
      original_text: text,
      message: opts.note || null,
      status: 'scheduled',
      due_at: dueAt,
      created_at: new Date().toISOString(),
      meta: { parsed: { amount, rawUnit, unit, minutes } }
    };

    const { data, error } = await dbClient
      .from('scheduled_followups')
      .insert(payload)
      .select('*')
      .limit(1);

    if (error) {
      console.warn('[FOLLOWUP_HANDLER] dbClient insert failed:', error?.message || error);
      return { ok: false, error: String(error?.message || error) };
    }

    console.log('[FOLLOWUP_HANDLER] scheduled follow-up', { phone: payload.phone, dueAt, tenantId });
    return { ok: true, data };

  } catch (err) {
    console.error('[FOLLOWUP_HANDLER] Error handling follow-up request:', err?.message || err);
    return { ok: false, error: String(err?.message || err) };
  }
}

/*
Example usage inside your flow:

// robust: call the shared helper
const followResult = await parseAndScheduleFollowUp(userMessageText, from, tenantId, { note: 'user requested follow-up' });

if (!followResult.ok) {
  console.warn('[FOLLOWUP] scheduling failed', followResult);
  // optional: notify user something went wrong
  // await sendMessage(from, "Sorry, I couldn't schedule that follow-up. Try: 'call me after 30mins'");
} else {
  const row = Array.isArray(followResult.data) ? followResult.data[0] : (followResult.data && followResult.data[0]) ;
  const due = row?.due_at || (followResult.data && followResult.data.due_at) || 'the scheduled time';
  await sendMessage(from, `Okay — I'll remind you at ${due}.`);
}
*/

module.exports = {
    detectFollowUpRequest,
    parseFollowUpTime,
    scheduleFollowUp,
    handleFollowUpRequest,
    processScheduledFollowUps,
    processIndividualFollowUp,
    parseAndScheduleFollowUp
};

