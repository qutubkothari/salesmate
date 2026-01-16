/**
 * @title Subscription Tier Service
 * @description Manages feature access and permissions based on a tenant's subscription tier.
 */
const { dbClient } = require('./config');

// Define the features available for each tier. 'standard' has access to everything not listed here.
const TIER_FEATURES = {
    'pro': [
        'ai_sales_insights',
        'drip_campaigns',
        'ai_follow_up_suggestions',
        // Add other future pro features here
    ]
};

// Define the hierarchy of tiers. Higher number is a better tier.
const TIER_LEVELS = {
    'standard': 1,
    'pro': 2,
};


/**
 * Checks if a tenant has access to a specific feature based on their subscription tier.
 * @param {string} tenantId The ID of the tenant.
 * @param {string} featureName The name of the feature to check (e.g., 'ai_sales_insights').
 * @returns {Promise<boolean>} True if the tenant has access, false otherwise.
 */
const hasTierAccess = async (tenantId, featureName) => {
    try {
        // Find which tier is required for this feature
        let requiredTier = 'standard'; // By default, all features are standard
        for (const tier in TIER_FEATURES) {
            if (TIER_FEATURES[tier].includes(featureName)) {
                requiredTier = tier;
                break;
            }
        }

        // If the feature is standard, everyone has access.
        if (requiredTier === 'standard') {
            return true;
        }

        // 1. Get the tenant's current subscription tier.
        const { data: tenant, error } = await dbClient
            .from('tenants')
            .select('subscription_tier')
            .eq('id', tenantId)
            .single();

        if (error || !tenant) {
            console.error(`Could not find tenant ${tenantId} to check tier access.`);
            return false; // Fail safe: deny access if tenant not found
        }

        const tenantTier = tenant.subscription_tier || 'standard';

        // 2. Compare the tenant's tier level to the required tier level.
        const tenantLevel = TIER_LEVELS[tenantTier] || 0;
        const requiredLevel = TIER_LEVELS[requiredTier] || 99; // Default to a high level if tier is unknown

        return tenantLevel >= requiredLevel;

    } catch (error) {
        console.error('Error checking tier access:', error.message);
        return false; // Default to no access on error
    }
};

module.exports = {
    hasTierAccess,
};


