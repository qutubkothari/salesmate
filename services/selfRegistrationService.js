// services/selfRegistrationService.js
// Handle customer self-registration via WhatsApp

const { supabase } = require('./config');
const crypto = require('crypto');

/**
 * Check if message is a registration request
 */
function isRegistrationRequest(message) {
    const lowerMsg = message.toLowerCase().trim();
    return /^(register|signup|sign up|create account|new account)$/i.test(lowerMsg);
}

/**
 * Check if message is a confirmation (yes/no)
 */
function isConfirmation(message) {
    const lowerMsg = message.toLowerCase().trim();
    return {
        isYes: /^(yes|yeah|yep|yup|sure|ok|okay|confirm|proceed|ha|haan|हाँ|yes please|👍)$/i.test(lowerMsg),
        isNo: /^(no|nope|nah|cancel|stop|na|nahi|नहीं|👎)$/i.test(lowerMsg)
    };
}

/**
 * Validate phone number format (WhatsApp format)
 */
function isValidPhoneNumber(phoneNumber) {
    // WhatsApp format: country code + number (e.g., 919876543210)
    // Should be 10-15 digits
    const cleanNumber = phoneNumber.replace(/[@c.us\s\-\(\)]/g, '');
    return /^\d{10,15}$/.test(cleanNumber);
}

/**
 * Format phone number to WhatsApp format
 */
function formatPhoneNumber(phoneNumber) {
    // Remove all non-digit characters except the initial +
    let cleaned = phoneNumber.replace(/[@c.us\s\-\(\)]/g, '');

    // Remove + if present
    cleaned = cleaned.replace(/^\+/, '');

    // Return cleaned number
    return cleaned;
}

/**
 * Start registration process - ask for confirmation
 */
async function startRegistration(phoneNumber, sendMessageFn, tenantId = null) {
    try {
        console.log('[SELF_REGISTRATION] Starting registration for:', phoneNumber);

        // Send confirmation message (we'll check for duplicates later after collecting bot/admin numbers)
        const confirmMessage = `🚀 *Welcome to WhatsApp AI Sales Assistant!*

You're about to create your own AI-powered sales bot! Here's what you get:

✅ *14-Day FREE Trial*
✅ AI-powered customer conversations
✅ Product catalog management
✅ Order processing & tracking
✅ Multi-language support (English, Hindi, Hinglish, Arabic)
✅ Discount negotiations
✅ Cart management

*What happens next:*
1. We'll ask for your bot phone number (Maytapi)
2. We'll ask for your admin phone number
3. We'll create your account
4. You get admin access immediately
5. Start adding products & serving customers
6. No credit card needed for trial

*Want to proceed with registration?*
Reply *YES* to confirm or *NO* to cancel.`;

        await sendMessageFn(phoneNumber, confirmMessage);

        // Set BOTH conversation state AND in-memory registration data
        if (tenantId) {
            // If calling from within a tenant context, update that conversation
            await updateConversationState(phoneNumber, tenantId, 'pending_registration_confirmation');
        }

        // CRITICAL: Set in-memory registration data so we can track the flow
        setRegistrationData(phoneNumber, {
            state: 'pending_registration_confirmation'
        });

        return {
            success: true,
            action: 'awaiting_confirmation',
            message: 'Confirmation message sent'
        };

    } catch (error) {
        console.error('[SELF_REGISTRATION] Error starting registration:', error);
        throw error;
    }
}

/**
 * Ask for bot phone number (Maytapi number)
 */
async function askForBotNumber(phoneNumber, sendMessageFn) {
    try {
        console.log('[SELF_REGISTRATION] Asking for bot number:', phoneNumber);

        const message = `📱 *Step 1: Bot Phone Number*

Please provide your *Maytapi WhatsApp Business number* that will be used as your AI bot.

This is the number your customers will message to place orders and get assistance.

*Example format:*
• 919876543210
• +919876543210
• 91-9876543210

Please enter your bot number:`;

        await sendMessageFn(phoneNumber, message);

        // Set registration state
        setRegistrationData(phoneNumber, {
            state: 'awaiting_bot_number'
        });

        return {
            success: true,
            action: 'awaiting_bot_number',
            message: 'Asked for bot number'
        };

    } catch (error) {
        console.error('[SELF_REGISTRATION] Error asking for bot number:', error);
        throw error;
    }
}

/**
 * Ask for admin phone number
 */
async function askForAdminNumber(phoneNumber, botNumber, sendMessageFn) {
    try {
        console.log('[SELF_REGISTRATION] Asking for admin number:', phoneNumber);

        const message = `📱 *Step 2: Admin Phone Number*

Please provide your *admin WhatsApp number* where you'll receive notifications and run admin commands.

This number will have full control over:
• Adding/managing products
• Viewing orders and analytics
• Broadcasting messages
• Managing bot settings

*Example format:*
• 919123456789
• +919123456789
• 91-9123456789

Please enter your admin number:`;

        await sendMessageFn(phoneNumber, message);

        // Update registration state
        setRegistrationData(phoneNumber, {
            state: 'awaiting_admin_number',
            botNumber: botNumber
        });

        return {
            success: true,
            action: 'awaiting_admin_number',
            message: 'Asked for admin number'
        };

    } catch (error) {
        console.error('[SELF_REGISTRATION] Error asking for admin number:', error);
        throw error;
    }
}

/**
 * Complete registration after collecting all info
 */
async function completeRegistration(phoneNumber, botNumber, adminNumber, sendMessageFn) {
    try {
        console.log('[SELF_REGISTRATION] Completing registration for:', phoneNumber);
        console.log('[SELF_REGISTRATION] Bot number:', botNumber);
        console.log('[SELF_REGISTRATION] Admin number:', adminNumber);

        // Format phone numbers
        const cleanBotNumber = formatPhoneNumber(botNumber);
        const cleanAdminNumber = formatPhoneNumber(adminNumber);
        const cleanOwnerNumber = phoneNumber.replace('@c.us', '');

        // Check if bot number is already in use
        const { data: existingBot } = await supabase
            .from('tenants')
            .select('id, business_name, bot_phone_number')
            .eq('bot_phone_number', cleanBotNumber)
            .single();

        if (existingBot) {
            const errorMessage = `❌ This bot number (${cleanBotNumber}) is already registered!

*Business:* ${existingBot.business_name || 'Not set'}

Please use a different Maytapi number or contact support if you believe this is an error.

To start over, type *"register"* again.`;

            await sendMessageFn(phoneNumber, errorMessage);
            clearRegistrationData(phoneNumber);

            return {
                success: false,
                reason: 'bot_number_already_exists',
                message: 'Bot number already in use'
            };
        }

        // Generate referral code
        const referralCode = `REF-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;

        // Calculate trial end date (14 days)
        const trialEndsAt = new Date();
        trialEndsAt.setDate(trialEndsAt.getDate() + 14);

        // Create new tenant
        const { data: newTenant, error: tenantError } = await supabase
            .from('tenants')
            .insert({
                business_name: null, // Will be set later by admin
                owner_whatsapp_number: phoneNumber,
                phone_number: cleanOwnerNumber,
                bot_language: 'English',
                subscription_status: 'trial',
                subscription_tier: 'standard',
                trial_ends_at: trialEndsAt.toISOString(),
                referral_code: referralCode,
                status: 'active',
                is_active: true,
                bot_phone_number: cleanBotNumber,
                currency_symbol: '₹',
                default_packaging_unit: 'piece',
                daily_summary_enabled: true,
                abandoned_cart_delay_hours: 2,
                abandoned_cart_message: "Hello! It looks like you left some items in your shopping cart. Would you like to complete your purchase?",
                admin_phones: [cleanAdminNumber]
            })
            .select()
            .single();

        if (tenantError) {
            console.error('[SELF_REGISTRATION] Failed to create tenant:', tenantError);

            // Check if it's a duplicate key error
            if (tenantError.code === '23505') {
                const errorMessage = `❌ Registration failed: This bot number is already in use.

Please try again with a different number.

To start over, type *"register"*.`;

                await sendMessageFn(phoneNumber, errorMessage);
                clearRegistrationData(phoneNumber);

                return {
                    success: false,
                    reason: 'duplicate_bot_number',
                    message: 'Bot number already exists'
                };
            }

            throw tenantError;
        }

        console.log('[SELF_REGISTRATION] Tenant created:', newTenant.id);

        // Clear registration data
        clearRegistrationData(phoneNumber);

        // Send welcome message with admin instructions
        const welcomeMessage = `🎉 *Registration Successful!*

Your AI Sales Assistant is ready! 🤖

*Your Account Details:*
🤖 Bot Number: ${cleanBotNumber}
📱 Admin Number: ${cleanAdminNumber}
🎟️ Referral Code: ${referralCode}
📅 Trial Ends: ${new Date(trialEndsAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
💎 Plan: Standard (Trial)

*Quick Start Guide:*

1️⃣ *Set Your Business Name*
   Send: /set_business YourBusinessName

2️⃣ *Add Products* (3 methods)
   • Manual: /add_product
   • Import: Upload product list
   • Sync from Zoho

3️⃣ *Configure Bot*
   • Language: /set_language Hinglish
   • Personality: /set_personality
   • Welcome message: /set_welcome

4️⃣ *Access Admin Dashboard*
   Visit: https://sak-whatsapp-ai-sales-assist.wl.r.appspot.com

*Admin Commands:*
• /help - Show all commands
• /stats - View your statistics
• /add_product - Add new product
• /view_products - List all products
• /broadcast - Send message to all customers

*Important:*
Admin commands should be sent from the admin number (${cleanAdminNumber}) to the bot number (${cleanBotNumber}).

*Need Help?*
Reply "help" anytime for assistance!

Ready to serve your first customer! 🚀`;

        await sendMessageFn(phoneNumber, welcomeMessage);

        return {
            success: true,
            tenant: newTenant,
            message: 'Registration completed'
        };

    } catch (error) {
        console.error('[SELF_REGISTRATION] Error completing registration:', error);

        // Clear registration data on error
        clearRegistrationData(phoneNumber);

        // Send error message to user
        const errorMessage = `❌ Registration failed. Please try again or contact support.

Error: ${error.message}`;

        await sendMessageFn(phoneNumber, errorMessage);

        throw error;
    }
}

/**
 * Handle registration cancellation
 */
async function cancelRegistration(phoneNumber, sendMessageFn, tenantId = null) {
    try {
        console.log('[SELF_REGISTRATION] Cancelling registration for:', phoneNumber);

        const cancelMessage = `Registration cancelled. ❌

No worries! You can start registration anytime by sending *"register"*.

If you have questions, just ask! I'm here to help. 😊`;

        await sendMessageFn(phoneNumber, cancelMessage);

        // Clear registration data
        clearRegistrationData(phoneNumber);

        // Clear conversation state
        if (tenantId) {
            await updateConversationState(phoneNumber, tenantId, 'active');
        }

        return {
            success: true,
            action: 'cancelled',
            message: 'Registration cancelled by user'
        };

    } catch (error) {
        console.error('[SELF_REGISTRATION] Error cancelling registration:', error);
        throw error;
    }
}

/**
 * Store temporary registration data in memory (for simplicity)
 * In production, you might want to use Redis or database
 */
const registrationData = new Map();

/**
 * Get registration data for a phone number
 */
function getRegistrationData(phoneNumber) {
    return registrationData.get(phoneNumber) || null;
}

/**
 * Set registration data for a phone number
 */
function setRegistrationData(phoneNumber, data) {
    registrationData.set(phoneNumber, {
        ...data,
        lastUpdated: new Date()
    });
}

/**
 * Clear registration data for a phone number
 */
function clearRegistrationData(phoneNumber) {
    registrationData.delete(phoneNumber);
}

/**
 * Update conversation state for registration flow
 */
async function updateConversationState(phoneNumber, tenantId, state, metadata = {}) {
    try {
        // Find active conversation
        const { data: conversation } = await supabase
            .from('conversations')
            .select('id')
            .eq('end_user_phone', phoneNumber)
            .eq('tenant_id', tenantId)
            .order('created_at', { ascending: false })
            .limit(1)
            .single();

        if (conversation) {
            await supabase
                .from('conversations')
                .update({
                    state,
                    metadata: { ...metadata, registration_flow: true }
                })
                .eq('id', conversation.id);

            console.log('[SELF_REGISTRATION] Updated conversation state:', state);
        }

    } catch (error) {
        console.error('[SELF_REGISTRATION] Error updating conversation state:', error);
    }
}

/**
 * Get conversation registration state
 */
async function getRegistrationState(phoneNumber, tenantId) {
    try {
        const { data: conversation } = await supabase
            .from('conversations')
            .select('state, metadata')
            .eq('end_user_phone', phoneNumber)
            .eq('tenant_id', tenantId)
            .order('created_at', { ascending: false })
            .limit(1)
            .single();

        if (conversation && conversation.metadata?.registration_flow) {
            return conversation.state;
        }

        return null;

    } catch (error) {
        console.error('[SELF_REGISTRATION] Error getting registration state:', error);
        return null;
    }
}

/**
 * Main handler for self-registration flow
 */
async function handleSelfRegistration(phoneNumber, message, sendMessageFn, tenantId = null) {
    try {
        console.log('[SELF_REGISTRATION] Handling message:', message, 'from:', phoneNumber);

        // Check if this is a registration request
        if (isRegistrationRequest(message)) {
            return await startRegistration(phoneNumber, sendMessageFn, tenantId);
        }

        // Get current registration state
        const regData = getRegistrationData(phoneNumber);
        const state = tenantId ? await getRegistrationState(phoneNumber, tenantId) : null;

        // Handle state machine for registration flow
        if (regData) {
            console.log('[SELF_REGISTRATION] Current registration state:', regData.state);

            switch (regData.state) {
                case 'pending_registration_confirmation':
                    // Check for YES/NO confirmation
                    const confirmation = isConfirmation(message);

                    if (confirmation.isYes) {
                        // Start collecting bot number
                        return await askForBotNumber(phoneNumber, sendMessageFn);
                    }

                    if (confirmation.isNo) {
                        return await cancelRegistration(phoneNumber, sendMessageFn, tenantId);
                    }

                    // If not yes/no, return null to let other handlers process it
                    return null;

                case 'awaiting_bot_number':
                    // Validate bot number
                    if (!isValidPhoneNumber(message)) {
                        await sendMessageFn(phoneNumber, `❌ Invalid phone number format.

Please enter a valid phone number (10-15 digits).

*Example:*
• 919876543210
• +919876543210

Please try again:`);
                        return {
                            success: false,
                            action: 'invalid_bot_number',
                            message: 'Invalid phone number format'
                        };
                    }

                    // Bot number received, ask for admin number
                    const botNumber = formatPhoneNumber(message);
                    return await askForAdminNumber(phoneNumber, botNumber, sendMessageFn);

                case 'awaiting_admin_number':
                    // Validate admin number
                    if (!isValidPhoneNumber(message)) {
                        await sendMessageFn(phoneNumber, `❌ Invalid phone number format.

Please enter a valid phone number (10-15 digits).

*Example:*
• 919123456789
• +919123456789

Please try again:`);
                        return {
                            success: false,
                            action: 'invalid_admin_number',
                            message: 'Invalid phone number format'
                        };
                    }

                    // Admin number received, complete registration
                    const adminNumber = formatPhoneNumber(message);
                    return await completeRegistration(phoneNumber, regData.botNumber, adminNumber, sendMessageFn);

                default:
                    console.log('[SELF_REGISTRATION] Unknown registration state:', regData.state);
                    return null;
            }
        }

        // Check if user is in pending confirmation state (from conversation state)
        if (state === 'pending_registration_confirmation' || !tenantId) {
            // Check for confirmation response
            const confirmation = isConfirmation(message);

            if (confirmation.isYes) {
                // Start collecting bot number
                return await askForBotNumber(phoneNumber, sendMessageFn);
            }

            if (confirmation.isNo) {
                return await cancelRegistration(phoneNumber, sendMessageFn, tenantId);
            }
        }

        return null; // Not a registration message

    } catch (error) {
        console.error('[SELF_REGISTRATION] Error handling registration:', error);
        throw error;
    }
}

module.exports = {
    isRegistrationRequest,
    isConfirmation,
    startRegistration,
    completeRegistration,
    cancelRegistration,
    handleSelfRegistration,
    getRegistrationState,
    getRegistrationData
};
