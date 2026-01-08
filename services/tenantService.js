/**
 * @title Tenant Management Service
 * @description Handles the logic for finding and creating tenants in the database.
 */
const { supabase } = require('./config');
const { generateReferralCode } = require('./referralService'); // Import the code generator

/**
 * Finds a tenant by their phone number, or creates a new one if they don't exist.
 * Assigns a unique referral code to new tenants.
 * @param {string} phoneNumber The tenant's WhatsApp phone number.
 * @param {string} botPhoneNumber The WhatsApp number of the bot they are interacting with.
 * @returns {Promise<object>} The tenant object from the database.
 */
const findOrCreateTenant = async (phoneNumber, botPhoneNumber) => {
    try {
        // 1. Check if the tenant already exists.
        let { data: tenant, error: findError } = await supabase
            .from('tenants')
            .select('*')
            .eq('owner_whatsapp_number', phoneNumber)  // FIXED
            .single();

        if (findError && findError.code !== 'PGRST116') {
            throw findError;
        }

        // 2. If the tenant exists, return their data.
        if (tenant) {
            return tenant;
        }

        // 3. If the tenant does not exist, create a new one.
        const trialEndsAt = new Date();
        trialEndsAt.setDate(trialEndsAt.getDate() + 14);

        const newReferralCode = generateReferralCode();

        const { data: newTenant, error: createError } = await supabase
            .from('tenants')
            .insert({
                owner_whatsapp_number: phoneNumber,  // FIXED
                bot_phone_number: botPhoneNumber,
                trial_ends_at: trialEndsAt.toISOString(),
                referral_code: newReferralCode
            })
            .select('*')
            .single();

        if (createError) {
            if (createError.code === '23505') {
                console.warn('Referral code collision, retrying tenant creation...');
                return findOrCreateTenant(phoneNumber, botPhoneNumber);
            }
            throw createError;
        }

        console.log(`New tenant created with referral code: ${newTenant.referral_code}`);
        return newTenant;

    } catch (error) {
        console.error('Error in findOrCreateTenant:', error.message);
        throw new Error('Failed to find or create a tenant.');
    }
};

// --- ADD: Auto-provision tenant by bot number ---
async function ensureTenantByBot(botPhone) {
  // Try to find an existing row
  const { data: existing, error: qErr } = await supabase
    .from('tenants')
    .select('id')
    .eq('bot_phone_number', botPhone)
    .maybeSingle();
  if (qErr) throw qErr;
  if (existing?.id) return existing;

  // Create a minimal row using env defaults
  const payload = {
    bot_phone_number: botPhone,
    owner_whatsapp_number: process.env.OWNER_WHATSAPP_NUMBER, // must be set
    maytapi_product_id: process.env.MAYTAPI_PRODUCT_ID,
    maytapi_phone_id: process.env.MAYTAPI_PHONE_ID,
    admin_phones: [process.env.OWNER_WHATSAPP_NUMBER].filter(Boolean),
    status: 'active',
  };

  const { data: created, error: iErr } = await supabase
    .from('tenants')
    .insert(payload)
    .select('id')
    .single();
  if (iErr) throw iErr;
  return created;
}

/**
 * Initialize tenant with dynamic configuration
 * @param {string} tenantId The tenant ID
 * @param {Object} options Configuration options
 */
const initializeTenantConfig = async (tenantId, options = {}) => {
    try {
        // Get existing tenant data
        const { data: tenant } = await supabase
            .from('tenants')
            .select('*')
            .eq('id', tenantId)
            .single();

        if (!tenant) return false;

        // Set dynamic defaults based on existing data or options
        const config = {
            industry_type: options.industry_type || 'general',
            currency_symbol: options.currency_symbol || '₹',
            default_packaging_unit: options.default_packaging_unit || 'piece',
            order_confirmation_phrases: options.order_confirmation_phrases || ['yes go ahead', 'confirm', 'proceed'],
            bot_language: tenant.bot_language || options.bot_language || 'en'
        };

        // Update tenant with config
        await supabase
            .from('tenants')
            .update(config)
            .eq('id', tenantId);

        return true;
    } catch (error) {
        console.error('Error initializing tenant config:', error.message);
        return false;
    }
};

/**
 * Get tenant's order confirmation patterns dynamically
 * @param {string} tenantId The tenant ID
 * @returns {Promise<Array>} Array of regex patterns
 */
const getOrderConfirmationPatterns = async (tenantId) => {
    try {
        const { data: tenant } = await supabase
            .from('tenants')
            .select('order_confirmation_phrases, bot_language')
            .eq('id', tenantId)
            .single();

        const language = tenant?.bot_language || 'en';
        const phrases = tenant?.order_confirmation_phrases || [];

        // Create regex patterns from phrases
        const patterns = phrases.map(phrase => new RegExp(`\\b${phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i'));

        // Add language-specific defaults if no custom phrases
        if (patterns.length === 0) {
            const defaults = {
                'en': ['yes go ahead', 'confirm', 'checkout', 'proceed'],
                'hi': ['haan kar do', 'confirm kar do', 'order karna hai', 'final price kya hogi'],
                'hinglish': ['yes kar do', 'confirm karo', 'place kar do']
            };

            const defaultPhrases = defaults[language] || defaults['en'];
            patterns.push(...defaultPhrases.map(phrase => new RegExp(`\\b${phrase}\\b`, 'i')));
        }

        return patterns;
    } catch (error) {
        console.error('Error getting order confirmation patterns:', error.message);
        return [/\b(yes.*go.*ahead|confirm|checkout)\b/i];
    }
};

/**
 * Enhanced getOrderConfirmationPatterns with better error handling and defaults
 */
const getOrderConfirmationPatternsEnhanced = async (tenantId) => {
    try {
        const { data: tenant, error } = await supabase
            .from('tenants')
            .select('order_confirmation_phrases, bot_language, industry_type')
            .eq('id', tenantId)
            .single();

        if (error) {
            console.warn('Could not fetch tenant config:', error.message);
            return getDefaultOrderPatterns();
        }

        const language = tenant?.bot_language?.toLowerCase() || 'en';
        let phrases = [];

        // Parse phrases from database
        if (tenant?.order_confirmation_phrases) {
            if (Array.isArray(tenant.order_confirmation_phrases)) {
                phrases = tenant.order_confirmation_phrases;
            } else if (typeof tenant.order_confirmation_phrases === 'string') {
                try {
                    phrases = JSON.parse(tenant.order_confirmation_phrases);
                } catch (e) {
                    phrases = [tenant.order_confirmation_phrases];
                }
            }
        }

        // Add language-specific defaults if no custom phrases
        if (phrases.length === 0) {
            phrases = getDefaultPhrasesForLanguage(language, tenant?.industry_type);
        }

        // Convert phrases to regex patterns with error handling
        const patterns = phrases.map(phrase => {
            try {
                // Escape special regex characters and create pattern
                const escapedPhrase = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                return new RegExp(`\\b${escapedPhrase}\\b`, 'i');
            } catch (error) {
                console.warn('Invalid phrase pattern:', phrase, error.message);
                return null;
            }
        }).filter(Boolean);

        // Ensure we always have at least one pattern
        if (patterns.length === 0) {
            return getDefaultOrderPatterns();
        }

        return patterns;

    } catch (error) {
        console.error('Error getting order confirmation patterns:', error.message);
        return getDefaultOrderPatterns();
    }
};

/**
 * Get default order confirmation patterns
 */
const getDefaultOrderPatterns = () => {
    return [
        /\b(yes.*go.*ahead|confirm|checkout|proceed|place.*order)\b/i,
        /\b(final.*price|total.*amount|complete.*order)\b/i,
        /\b(kar.*do|confirm.*kar|order.*kar)\b/i  // Hindi/Hinglish
    ];
};

/**
 * Get default phrases for different languages and industries
 */
const getDefaultPhrasesForLanguage = (language, industryType = 'general') => {
    const defaults = {
        'en': [
            'yes go ahead',
            'confirm',
            'checkout',
            'proceed',
            'place order',
            'final price',
            'complete order'
        ],
        'hi': [
            'haan kar do',
            'confirm kar do',
            'order karna hai',
            'final price kya hogi',
            'checkout kar do'
        ],
        'hinglish': [
            'yes kar do',
            'confirm karo',
            'place kar do',
            'final price',
            'checkout karo'
        ]
    };

    // Industry-specific additions
    const industryAdditions = {
        'hardware': ['quote confirm', 'material order', 'supply confirm'],
        'retail': ['buy this', 'purchase confirm', 'add to order'],
        'food': ['order ready', 'confirm booking', 'place order']
    };

    let phrases = defaults[language] || defaults['en'];
    
    if (industryType && industryAdditions[industryType]) {
        phrases = [...phrases, ...industryAdditions[industryType]];
    }

    return phrases;
};

/**
 * Initialize or update tenant configuration for order processing
 */
const setupTenantOrderConfig = async (tenantId, config = {}) => {
    try {
        const {
            industry_type = 'general',
            bot_language = 'en',
            currency_symbol = '₹',
            order_confirmation_phrases,
            default_packaging_unit = 'piece'
        } = config;

        // Get default phrases if not provided
        const phrases = order_confirmation_phrases || 
                       getDefaultPhrasesForLanguage(bot_language, industry_type);

        const updateData = {
            industry_type,
            bot_language,
            currency_symbol,
            order_confirmation_phrases: phrases,
            default_packaging_unit,
            updated_at: new Date().toISOString()
        };

        const { error } = await supabase
            .from('tenants')
            .update(updateData)
            .eq('id', tenantId);

        if (error) throw error;

        console.log(`Tenant ${tenantId} order config updated successfully`);
        return { success: true, config: updateData };

    } catch (error) {
        console.error('Error setting up tenant order config:', error.message);
        return { success: false, error: error.message };
    }
};

/**
 * Get tenant's complete configuration for order processing
 */
const getTenantOrderConfig = async (tenantId) => {
    try {
        const { data: tenant, error } = await supabase
            .from('tenants')
            .select(`
                id,
                business_name,
                industry_type,
                bot_language,
                currency_symbol,
                order_confirmation_phrases,
                default_packaging_unit,
                bot_personality,
                welcome_message
            `)
            .eq('id', tenantId)
            .single();

        if (error) throw error;

        return {
            success: true,
            config: {
                ...tenant,
                order_patterns: await getOrderConfirmationPatternsEnhanced(tenantId)
            }
        };

    } catch (error) {
        console.error('Error getting tenant order config:', error.message);
        return { 
            success: false, 
            error: error.message,
            config: {
                bot_language: 'en',
                currency_symbol: '₹',
                industry_type: 'general',
                order_patterns: getDefaultOrderPatterns()
            }
        };
    }
};

/**
 * Update specific order confirmation phrases for a tenant
 */
const updateOrderConfirmationPhrases = async (tenantId, newPhrases) => {
    try {
        if (!Array.isArray(newPhrases) || newPhrases.length === 0) {
            return { success: false, message: 'Phrases must be a non-empty array' };
        }

        const { error } = await supabase
            .from('tenants')
            .update({ 
                order_confirmation_phrases: newPhrases,
                updated_at: new Date().toISOString()
            })
            .eq('id', tenantId);

        if (error) throw error;

        return { 
            success: true, 
            message: `Updated ${newPhrases.length} order confirmation phrases`,
            phrases: newPhrases
        };

    } catch (error) {
        console.error('Error updating order confirmation phrases:', error.message);
        return { success: false, message: error.message };
    }
};

/**
 * Test order confirmation detection for a tenant
 */
const testOrderConfirmation = async (tenantId, testPhrase) => {
    try {
        const patterns = await getOrderConfirmationPatternsEnhanced(tenantId);
        const matches = patterns.filter(pattern => {
            try {
                return pattern.test(testPhrase);
            } catch (e) {
                return false;
            }
        });

        return {
            phrase: testPhrase,
            matches: matches.length > 0,
            matchCount: matches.length,
            patterns: patterns.map(p => p.source)
        };

    } catch (error) {
        console.error('Error testing order confirmation:', error.message);
        return {
            phrase: testPhrase,
            matches: false,
            error: error.message
        };
    }
};

/**
 * Enhanced findOrCreateTenant with dynamic config initialization
 */
const findOrCreateTenantWithConfig = async (phoneNumber, botPhoneNumber, options = {}) => {
    try {
        // Use existing findOrCreateTenant
        const tenant = await findOrCreateTenant(phoneNumber, botPhoneNumber);
        
        // Initialize config for new tenants
        if (tenant && !tenant.industry_type) {
            await initializeTenantConfig(tenant.id, options);
        }
        
        return tenant;
    } catch (error) {
        console.error('Error in findOrCreateTenantWithConfig:', error.message);
        throw error;
    }
};

// export without removing existing exports
module.exports.ensureTenantByBot = ensureTenantByBot;

module.exports = {
    findOrCreateTenant,
    ensureTenantByBot,
    initializeTenantConfig,
    getOrderConfirmationPatterns,
    findOrCreateTenantWithConfig,
    // Enhanced functions
    getOrderConfirmationPatternsEnhanced,
    setupTenantOrderConfig,
    getTenantOrderConfig,
    updateOrderConfirmationPhrases,
    testOrderConfirmation,
    getDefaultOrderPatterns
};

