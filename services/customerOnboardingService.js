// services/customerOnboardingService.js
const { dbClient } = require('./config');
const { sendMessage } = require('./whatsappService');
const OpenAI = require('openai');

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    ...(process.env.OPENAI_BASE_URL || process.env.AI_BASE_URL ? { baseURL: process.env.OPENAI_BASE_URL || process.env.AI_BASE_URL } : {})
});

/**
 * AI-powered detection of customer information from natural language
 * @param {string} message - User's message
 * @param {string} context - Current onboarding stage context
 * @returns {Promise<Object>} Extracted information
 */
async function extractCustomerInfoAI(message, context = 'name') {
    try {
        console.log('[ONBOARDING_AI] Extracting info from:', message, '| Context:', context);
        
        const systemPrompt = context === 'name' 
            ? `You are a customer information extractor. Extract the customer's name and optionally company name from their message.
            
Examples:
- "I am Rajesh from ABC Foods" → {name: "Rajesh", company: "ABC Foods"}
- "Rajesh kumar" → {name: "Rajesh Kumar", company: null}
- "ABC Trading Company" → {name: null, company: "ABC Trading Company"}
- "My name is Suresh and I work at XYZ Distributors" → {name: "Suresh", company: "XYZ Distributors"}

Return ONLY valid JSON with 'name' and 'company' fields (null if not found).
If the message doesn't contain name/company info, return {name: null, company: null}.`
            : `You are a GST and business information extractor. Extract GST number, company name, and address from the message.

Examples:
- "29ABCDE1234F1Z5" → {gst: "29ABCDE1234F1Z5", company: null, address: null}
- "Our GST is 27AABCU9603R1ZM and company is Tech Solutions Pvt Ltd" → {gst: "27AABCU9603R1ZM", company: "Tech Solutions Pvt Ltd", address: null}
- "GST: 29ABCDE1234F1Z5, Address: 123 MG Road, Bangalore" → {gst: "29ABCDE1234F1Z5", company: null, address: "123 MG Road, Bangalore"}

Return ONLY valid JSON with 'gst', 'company', and 'address' fields (null if not found).`;

        const response = await openai.chat.completions.create({
            model: process.env.AI_MODEL_FAST || 'grok-code-fast-1',
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: message }
            ],
            temperature: 0.1,
            max_tokens: 200,
            response_format: { type: 'json_object' }
        });

        const extracted = JSON.parse(response.choices[0].message.content);
        console.log('[ONBOARDING_AI] Extracted:', extracted);
        
        return extracted;
    } catch (error) {
        console.error('[ONBOARDING_AI] Error:', error.message);
        return context === 'name' 
            ? { name: null, company: null }
            : { gst: null, company: null, address: null };
    }
}

/**
 * Check if customer needs onboarding
 * @param {string} tenantId 
 * @param {string} phone 
 * @returns {Promise<Object>} Onboarding status
 */
async function checkOnboardingStatus(tenantId, phone) {
    try {
        // Check if customer profile exists with basic info
        const { data: profile } = await dbClient
            .from('customer_profiles_new')
            .select('id, first_name, company, gst_number, phone, onboarding_completed, onboarding_stage')
            .eq('tenant_id', tenantId)
            .eq('phone', phone.replace(/@.*$/, ''))
            .maybeSingle();

        if (!profile) {
            console.log('[ONBOARDING] No profile found - needs full onboarding');
            return {
                needsOnboarding: true,
                stage: 'welcome',
                profile: null
            };
        }

        // Check if onboarding is complete
        if (profile.onboarding_completed) {
            console.log('[ONBOARDING] Profile complete:', profile.first_name);
            return {
                needsOnboarding: false,
                stage: 'completed',
                profile: profile
            };
        }

        // Determine current stage
        let stage = 'welcome';
        if (!profile.first_name) {
            stage = 'name';
        } else if (!profile.company && !profile.gst_number) {
            stage = 'business_info';
        }

        console.log('[ONBOARDING] Incomplete profile - stage:', stage);
        return {
            needsOnboarding: true,
            stage: stage,
            profile: profile
        };
    } catch (error) {
        console.error('[ONBOARDING] Error checking status:', error.message);
        return {
            needsOnboarding: true,
            stage: 'welcome',
            profile: null
        };
    }
}

/**
 * Initialize onboarding for new customer
 * @param {string} tenantId 
 * @param {string} phone 
 * @returns {Promise<string>} Welcome message
 */
async function startOnboarding(tenantId, phone) {
    try {
        console.log('[ONBOARDING] Starting for:', phone);

        // Create or get customer profile
        const normalizedPhone = phone.replace(/@.*$/, '');
        
        const { data: existingProfile } = await dbClient
            .from('customer_profiles_new')
            .select('id')
            .eq('tenant_id', tenantId)
            .eq('phone', normalizedPhone)
            .maybeSingle();

        if (!existingProfile) {
            // Create new profile
            const { data: newProfile, error: createError } = await dbClient
                .from('customer_profiles_new')
                .insert({
                    tenant_id: tenantId,
                    phone: normalizedPhone,
                    onboarding_completed: false,
                    onboarding_stage: 'name',
                    created_at: new Date().toISOString()
                })
                .select('id')
                .single();

            if (createError) {
                console.error('[ONBOARDING] Error creating profile:', createError);
            } else {
                console.log('[ONBOARDING] Created new profile:', newProfile.id);
            }
        } else {
            // Update existing profile to start onboarding
            await dbClient
                .from('customer_profiles_new')
                .update({
                    onboarding_stage: 'name',
                    onboarding_completed: false
                })
                .eq('id', existingProfile.id);
        }

        // Update conversation state
        await dbClient
            .from('conversations_new')
            .update({
                state: 'onboarding_name',
                updated_at: new Date().toISOString()
            })
            .eq('tenant_id', tenantId)
            .eq('end_user_phone', phone);

        return `👋 Welcome to SAK Foods!\n\nI'm your AI assistant here to help you with product inquiries and orders.\n\nTo serve you better, may I know your name?`;
    } catch (error) {
        console.error('[ONBOARDING] Error starting:', error.message);
        return 'Welcome! How can I help you today?';
    }
}

/**
 * Process name response from customer
 * @param {string} tenantId 
 * @param {string} phone 
 * @param {string} message 
 * @returns {Promise<Object>} Processing result
 */
async function processNameResponse(tenantId, phone, message) {
    try {
        console.log('[ONBOARDING] Processing name response:', message);

        // Use AI to extract name and company
        const extracted = await extractCustomerInfoAI(message, 'name');

        if (!extracted.name && !extracted.company) {
            console.log('[ONBOARDING] No name/company found in response');
            return {
                success: false,
                message: 'I didn\'t quite catch that. Could you please share your name?\n\nFor example: "My name is Rajesh" or "I am Suresh from ABC Trading"'
            };
        }

        const normalizedPhone = phone.replace(/@.*$/, '');
        const updateData = {
            onboarding_stage: 'business_info',
            updated_at: new Date().toISOString()
        };

        if (extracted.name) {
            updateData.first_name = extracted.name;
        }
        if (extracted.company) {
            updateData.company = extracted.company;
        }

        // Update customer profile
        await dbClient
            .from('customer_profiles_new')
            .update(updateData)
            .eq('tenant_id', tenantId)
            .eq('phone', normalizedPhone);

        // Update conversation
        await dbClient
            .from('conversations_new')
            .update({
                customer_name: extracted.name || extracted.company,
                state: 'onboarding_business_info',
                updated_at: new Date().toISOString()
            })
            .eq('tenant_id', tenantId)
            .eq('end_user_phone', phone);

        const greeting = extracted.name 
            ? `Nice to meet you, ${extracted.name}!` 
            : `Great!`;
        
        const companyAck = extracted.company 
            ? ` I've noted your company as ${extracted.company}.` 
            : '';

        return {
            success: true,
            message: `${greeting}${companyAck}\n\n📋 To help with GST invoicing and faster service, could you share:\n\n• Your GST Number (if registered)\n• Company name and address\n\nYou can also send a photo of your business card! 📸\n\n_Or type "skip" if you'd like to do this later._`
        };
    } catch (error) {
        console.error('[ONBOARDING] Error processing name:', error.message);
        return {
            success: false,
            message: 'Sorry, there was an error saving your information. Please try again.'
        };
    }
}

/**
 * Process business info response from customer
 * @param {string} tenantId 
 * @param {string} phone 
 * @param {string} message 
 * @returns {Promise<Object>} Processing result
 */
async function processBusinessInfoResponse(tenantId, phone, message) {
    try {
        console.log('[ONBOARDING] Processing business info:', message);

        // Check for skip
        if (/^skip$/i.test(message.trim()) || /later/i.test(message)) {
            return await completeOnboarding(tenantId, phone, true);
        }

        // Use AI to extract GST and business details
        const extracted = await extractCustomerInfoAI(message, 'business');

        if (!extracted.gst && !extracted.company && !extracted.address) {
            console.log('[ONBOARDING] No business info found');
            return {
                success: false,
                message: 'I couldn\'t find business details in your message.\n\nPlease share:\n• GST Number (15 digits)\n• Company name\n• Address\n\nOr type "skip" to continue without this information.'
            };
        }

        const normalizedPhone = phone.replace(/@.*$/, '');
        const updateData = {
            updated_at: new Date().toISOString()
        };

        if (extracted.gst) {
            updateData.gst_number = extracted.gst;
        }
        if (extracted.company) {
            updateData.company = extracted.company;
        }
        if (extracted.address) {
            updateData.address = extracted.address;
        }

        // Update customer profile
        await dbClient
            .from('customer_profiles_new')
            .update(updateData)
            .eq('tenant_id', tenantId)
            .eq('phone', normalizedPhone);

        // Complete onboarding
        return await completeOnboarding(tenantId, phone, false);
    } catch (error) {
        console.error('[ONBOARDING] Error processing business info:', error.message);
        return {
            success: false,
            message: 'Sorry, there was an error saving your information. Please try again.'
        };
    }
}

/**
 * Complete onboarding process
 * @param {string} tenantId 
 * @param {string} phone 
 * @param {boolean} skipped 
 * @returns {Promise<Object>} Completion result
 */
async function completeOnboarding(tenantId, phone, skipped = false) {
    try {
        const normalizedPhone = phone.replace(/@.*$/, '');

        // Mark onboarding as complete
        await dbClient
            .from('customer_profiles_new')
            .update({
                onboarding_completed: true,
                onboarding_stage: 'completed',
                updated_at: new Date().toISOString()
            })
            .eq('tenant_id', tenantId)
            .eq('phone', normalizedPhone);

        // Reset conversation state
        await dbClient
            .from('conversations_new')
            .update({
                state: 'active',
                updated_at: new Date().toISOString()
            })
            .eq('tenant_id', tenantId)
            .eq('end_user_phone', phone);

        const skipMessage = skipped 
            ? '\n\n_You can update your business details anytime by typing "update profile"._' 
            : '\n\n✅ Your profile is all set!';

        return {
            success: true,
            completed: true,
            message: `🎉 Thank you!${skipMessage}\n\n*How can I help you today?*\n\n💡 You can:\n• Ask for product prices (e.g., "8x80 price?")\n• Place orders (e.g., "10x120 - 50 cartons")\n• Check order status\n• Get product catalogs`
        };
    } catch (error) {
        console.error('[ONBOARDING] Error completing:', error.message);
        return {
            success: false,
            message: 'Welcome! How can I help you today?'
        };
    }
}

/**
 * Handle onboarding flow based on conversation state
 * @param {string} tenantId 
 * @param {string} phone 
 * @param {string} message 
 * @param {Object} conversation 
 * @returns {Promise<Object|null>} Result or null if not in onboarding
 */
async function handleOnboardingFlow(tenantId, phone, message, conversation) {
    try {
        const state = conversation?.state;
        
        console.log('[ONBOARDING] Checking flow - state:', state);

        if (state === 'onboarding_name') {
            console.log('[ONBOARDING] Processing name stage');
            return await processNameResponse(tenantId, phone, message);
        }

        if (state === 'onboarding_business_info') {
            console.log('[ONBOARDING] Processing business info stage');
            return await processBusinessInfoResponse(tenantId, phone, message);
        }

        return null; // Not in onboarding flow
    } catch (error) {
        console.error('[ONBOARDING] Error in flow:', error.message);
        return null;
    }
}

module.exports = {
    checkOnboardingStatus,
    startOnboarding,
    handleOnboardingFlow,
    extractCustomerInfoAI,
    processNameResponse,
    processBusinessInfoResponse,
    completeOnboarding
};


