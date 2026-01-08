// routes/api/tenants.js
// Client/Tenant Management APIs

const express = require('express');
const router = express.Router();
const { supabase } = require('../../services/config');
const crypto = require('crypto');

/**
 * POST /api/tenants/register
 * Register a new tenant/client
 */
router.post('/register', async (req, res) => {
    try {
        const {
            business_name,
            owner_whatsapp_number,
            email,
            phone_number,
            subscription_tier, // 'free', 'standard', 'premium', 'enterprise'
            business_address,
            business_website,
            industry_type,
            bot_language
        } = req.body;

        const normalizePhoneDigits = (value) => {
            if (!value) return '';
            const withoutSuffix = String(value).replace(/@c\.us$/i, '');
            return withoutSuffix.replace(/\D/g, '');
        };

        // Validation
        if (!business_name || !owner_whatsapp_number) {
            return res.status(400).json({
                error: 'Business name and WhatsApp number are required'
            });
        }

        const ownerDigits = normalizePhoneDigits(owner_whatsapp_number);
        const phoneDigits = normalizePhoneDigits(phone_number || owner_whatsapp_number);
        if (!ownerDigits) {
            return res.status(400).json({
                error: 'WhatsApp number is invalid'
            });
        }

        // Store consistently: phone_number as digits; owner_whatsapp_number as WhatsApp JID-like value.
        const normalizedPhoneNumber = phoneDigits || ownerDigits;
        const normalizedOwnerWhatsApp = `${ownerDigits}@c.us`;

        // Check if tenant already exists
        const { data: existing } = await supabase
            .from('tenants')
            .select('id, business_name, subscription_status')
            .eq('owner_whatsapp_number', normalizedOwnerWhatsApp)
            .single();

        if (existing) {
            return res.status(409).json({
                error: 'Tenant already exists',
                tenant: existing
            });
        }

        // Generate referral code
        const referralCode = `REF-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;

        // Calculate trial period (14 days from now)
        const trialEndsAt = new Date();
        trialEndsAt.setDate(trialEndsAt.getDate() + 14);

        // Determine subscription tier limits
        const tier = subscription_tier || 'standard';
        const tierConfig = getSubscriptionTierConfig(tier);

        // Create tenant
        const { data: tenant, error } = await supabase
            .from('tenants')
            .insert({
                business_name,
                owner_whatsapp_number: normalizedOwnerWhatsApp,
                phone_number: normalizedPhoneNumber,
                business_address,
                business_website,
                industry_type,
                bot_language: bot_language || 'English',
                subscription_status: 'trial',
                subscription_tier: tier,
                trial_ends_at: trialEndsAt.toISOString(),
                referral_code: referralCode,
                status: 'active',
                is_active: true,
                bot_phone_number: normalizedOwnerWhatsApp, // Default to owner's number
                currency_symbol: '₹',
                default_packaging_unit: 'piece',
                daily_summary_enabled: true,
                abandoned_cart_delay_hours: 2,
                abandoned_cart_message: "Hello! It looks like you left some items in your shopping cart. Would you like to complete your purchase?",
                admin_phones: [normalizedOwnerWhatsApp]
            })
            .select()
            .single();

        if (error) {
            console.error('[TENANT_REGISTER] Error:', error);
            return res.status(500).json({ error: error.message });
        }

        console.log('[TENANT_REGISTER] New tenant created:', tenant.id, tenant.business_name);

        // Return success with tenant details
        return res.status(201).json({
            success: true,
            message: 'Tenant registered successfully',
            tenant: {
                id: tenant.id,
                business_name: tenant.business_name,
                owner_whatsapp_number: tenant.owner_whatsapp_number,
                subscription_status: tenant.subscription_status,
                subscription_tier: tenant.subscription_tier,
                trial_ends_at: tenant.trial_ends_at,
                referral_code: tenant.referral_code,
                limits: tierConfig
            }
        });

    } catch (error) {
        console.error('[TENANT_REGISTER] Exception:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * GET /api/tenants
 * List all tenants with filters
 */
router.get('/', async (req, res) => {
    try {
        const { 
            status, 
            subscription_tier, 
            subscription_status,
            limit = 50,
            offset = 0 
        } = req.query;

        let query = supabase
            .from('tenants')
            .select('id, business_name, owner_whatsapp_number, subscription_status, subscription_tier, trial_ends_at, created_at, status, is_active')
            .order('created_at', { ascending: false })
            .range(offset, offset + limit - 1);

        if (status) {
            query = query.eq('status', status);
        }

        if (subscription_tier) {
            query = query.eq('subscription_tier', subscription_tier);
        }

        if (subscription_status) {
            query = query.eq('subscription_status', subscription_status);
        }

        const { data: tenants, error, count } = await query;

        if (error) {
            console.error('[TENANT_LIST] Error:', error);
            return res.status(500).json({ error: error.message });
        }

        return res.json({
            success: true,
            tenants,
            total: count,
            limit: parseInt(limit),
            offset: parseInt(offset)
        });

    } catch (error) {
        console.error('[TENANT_LIST] Exception:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * GET /api/tenants/:tenantId
 * Get detailed tenant information
 */
router.get('/:tenantId', async (req, res) => {
    try {
        const { tenantId } = req.params;

        const { data: tenant, error } = await supabase
            .from('tenants')
            .select('*')
            .eq('id', tenantId)
            .single();

        if (error || !tenant) {
            return res.status(404).json({ error: 'Tenant not found' });
        }

        // Get usage statistics
        const stats = await getTenantStats(tenantId);

        return res.json({
            success: true,
            tenant: {
                ...tenant,
                stats,
                tier_config: getSubscriptionTierConfig(tenant.subscription_tier)
            }
        });

    } catch (error) {
        console.error('[TENANT_GET] Exception:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * PUT /api/tenants/:tenantId/subscription
 * Update tenant subscription
 */
router.put('/:tenantId/subscription', async (req, res) => {
    try {
        const { tenantId } = req.params;
        const {
            subscription_tier,
            subscription_status,
            subscription_start_date,
            subscription_end_date,
            trial_ends_at
        } = req.body;

        const updates = {};

        if (subscription_tier) {
            updates.subscription_tier = subscription_tier;
        }

        if (subscription_status) {
            updates.subscription_status = subscription_status;
            
            // If activating subscription, set dates
            if (subscription_status === 'active' && !subscription_start_date) {
                updates.subscription_start_date = new Date().toISOString();
                // Set end date to 1 year from now if not provided
                if (!subscription_end_date) {
                    const endDate = new Date();
                    endDate.setFullYear(endDate.getFullYear() + 1);
                    updates.subscription_end_date = endDate.toISOString();
                }
            }
        }

        if (subscription_start_date) {
            updates.subscription_start_date = subscription_start_date;
        }

        if (subscription_end_date) {
            updates.subscription_end_date = subscription_end_date;
        }

        if (trial_ends_at) {
            updates.trial_ends_at = trial_ends_at;
        }

        updates.updated_at = new Date().toISOString();

        const { data: tenant, error } = await supabase
            .from('tenants')
            .update(updates)
            .eq('id', tenantId)
            .select()
            .single();

        if (error || !tenant) {
            return res.status(404).json({ error: 'Tenant not found or update failed' });
        }

        console.log('[TENANT_SUBSCRIPTION_UPDATE] Updated:', tenantId, updates);

        return res.json({
            success: true,
            message: 'Subscription updated successfully',
            tenant: {
                id: tenant.id,
                business_name: tenant.business_name,
                subscription_status: tenant.subscription_status,
                subscription_tier: tenant.subscription_tier,
                subscription_start_date: tenant.subscription_start_date,
                subscription_end_date: tenant.subscription_end_date,
                tier_config: getSubscriptionTierConfig(tenant.subscription_tier)
            }
        });

    } catch (error) {
        console.error('[TENANT_SUBSCRIPTION_UPDATE] Exception:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * PUT /api/tenants/:tenantId/status
 * Activate or deactivate tenant
 */
router.put('/:tenantId/status', async (req, res) => {
    try {
        const { tenantId } = req.params;
        const { status, is_active } = req.body;

        const updates = {
            updated_at: new Date().toISOString()
        };

        if (status !== undefined) {
            updates.status = status;
        }

        if (is_active !== undefined) {
            updates.is_active = is_active;
        }

        const { data: tenant, error } = await supabase
            .from('tenants')
            .update(updates)
            .eq('id', tenantId)
            .select()
            .single();

        if (error || !tenant) {
            return res.status(404).json({ error: 'Tenant not found' });
        }

        console.log('[TENANT_STATUS_UPDATE] Updated:', tenantId, updates);

        return res.json({
            success: true,
            message: 'Tenant status updated',
            tenant: {
                id: tenant.id,
                business_name: tenant.business_name,
                status: tenant.status,
                is_active: tenant.is_active
            }
        });

    } catch (error) {
        console.error('[TENANT_STATUS_UPDATE] Exception:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * Helper: Get subscription tier configuration
 */
function getSubscriptionTierConfig(tier) {
    const configs = {
        free: {
            name: 'Free Trial',
            max_conversations_per_month: 100,
            max_products: 50,
            max_customers: 100,
            ai_responses_per_month: 500,
            website_crawl_pages: 10,
            features: ['basic_chat', 'product_catalog', 'order_management'],
            price_monthly: 0,
            price_yearly: 0
        },
        standard: {
            name: 'Standard',
            max_conversations_per_month: 1000,
            max_products: 500,
            max_customers: 1000,
            ai_responses_per_month: 5000,
            website_crawl_pages: 50,
            features: ['basic_chat', 'product_catalog', 'order_management', 'discount_negotiation', 'cart_management', 'multi_language'],
            price_monthly: 2999,
            price_yearly: 29999
        },
        premium: {
            name: 'Premium',
            max_conversations_per_month: 10000,
            max_products: 5000,
            max_customers: 10000,
            ai_responses_per_month: 50000,
            website_crawl_pages: 200,
            features: ['basic_chat', 'product_catalog', 'order_management', 'discount_negotiation', 'cart_management', 'multi_language', 'zoho_integration', 'analytics', 'custom_branding'],
            price_monthly: 9999,
            price_yearly: 99999
        },
        enterprise: {
            name: 'Enterprise',
            max_conversations_per_month: -1, // Unlimited
            max_products: -1,
            max_customers: -1,
            ai_responses_per_month: -1,
            website_crawl_pages: -1,
            features: ['all_features', 'dedicated_support', 'custom_integrations', 'white_label'],
            price_monthly: 29999,
            price_yearly: 299999
        }
    };

    return configs[tier] || configs.standard;
}

/**
 * Helper: Get tenant usage statistics
 */
async function getTenantStats(tenantId) {
    try {
        // Get conversation count for current month
        const startOfMonth = new Date();
        startOfMonth.setDate(1);
        startOfMonth.setHours(0, 0, 0, 0);

        const { count: conversationsThisMonth } = await supabase
            .from('conversations')
            .select('id', { count: 'exact', head: true })
            .eq('tenant_id', tenantId)
            .gte('created_at', startOfMonth.toISOString());

        // Get total customers
        const { count: totalCustomers } = await supabase
            .from('customer_profiles')
            .select('id', { count: 'exact', head: true })
            .eq('tenant_id', tenantId);

        // Get total products
        const { count: totalProducts } = await supabase
            .from('products')
            .select('id', { count: 'exact', head: true })
            .eq('tenant_id', tenantId);

        // Get total orders
        const { count: totalOrders } = await supabase
            .from('orders')
            .select('id', { count: 'exact', head: true })
            .eq('tenant_id', tenantId);

        // Get website pages crawled
        const { count: websitePages } = await supabase
            .from('website_embeddings')
            .select('url', { count: 'exact', head: true })
            .eq('tenant_id', tenantId);

        return {
            conversations_this_month: conversationsThisMonth || 0,
            total_customers: totalCustomers || 0,
            total_products: totalProducts || 0,
            total_orders: totalOrders || 0,
            website_pages_crawled: websitePages || 0
        };

    } catch (error) {
        console.error('[GET_TENANT_STATS] Error:', error);
        return {
            conversations_this_month: 0,
            total_customers: 0,
            total_products: 0,
            total_orders: 0,
            website_pages_crawled: 0
        };
    }
}

/**
 * POST /api/tenants/update-password
 * Update password for a tenant (used during registration)
 */
router.post('/update-password', async (req, res) => {
    try {
        const { tenantId, password } = req.body;

        if (!tenantId || !password) {
            return res.status(400).json({
                success: false,
                error: 'Tenant ID and password are required'
            });
        }

        // Update tenant password
        const { error } = await supabase
            .from('tenants')
            .update({ password: password })
            .eq('id', tenantId);

        if (error) {
            console.error('[UPDATE_PASSWORD] Error:', error);
            return res.status(500).json({
                success: false,
                error: error.message
            });
        }

        console.log('[UPDATE_PASSWORD] Password set for tenant:', tenantId);

        res.json({
            success: true,
            message: 'Password updated successfully'
        });

    } catch (error) {
        console.error('[UPDATE_PASSWORD] Exception:', error);
        res.status(500).json({
            success: false,
            error: 'Internal server error'
        });
    }
});

module.exports = router;
