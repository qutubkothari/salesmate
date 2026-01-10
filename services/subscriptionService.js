/**
 * @title Subscription Management Service
 * @description Handles tenant subscription status checks and activation key logic.
 */
const { dbClient } = require('./config');

/**
 * Checks the current subscription status of a tenant.
 * @param {string} tenantId The ID of the tenant.
 * @returns {object} An object containing the status ('trial', 'active', 'expired') and a user-friendly message.
 */
const checkSubscriptionStatus = async (tenantId) => {
    const { data: tenant, error } = await dbClient
        .from('tenants')
        .select('subscription_status, trial_ends_at, subscription_end_date')
        .eq('id', tenantId)
        .single();

    if (error) {
        console.error('Error fetching tenant status:', error.message);
        return { status: 'error', message: 'Could not retrieve subscription status.' };
    }

    if (!tenant) {
        return { status: 'not_found', message: 'Tenant not found.' };
    }

    const now = new Date();

    // Check paid subscription first
    if (tenant.subscription_status === 'active' && new Date(tenant.subscription_end_date) < now) {
        // Subscription has expired, update the status
        await dbClient.from('tenants').update({ subscription_status: 'expired' }).eq('id', tenantId);
        return { status: 'expired', message: 'Your subscription has expired. Please use a new activation key.' };
    }
    if (tenant.subscription_status === 'active') {
        const endDate = new Date(tenant.subscription_end_date).toLocaleDateString();
        return { status: 'active', message: `Your subscription is active until ${endDate}.` };
    }

    // Check trial status
    if (tenant.subscription_status === 'trial' && new Date(tenant.trial_ends_at) < now) {
        // Trial has expired, update the status
        await dbClient.from('tenants').update({ subscription_status: 'expired' }).eq('id', tenantId);
        return { status: 'expired', message: 'Your free trial has ended. Please use an activation key to continue.' };
    }
    if (tenant.subscription_status === 'trial') {
        const endDate = new Date(tenant.trial_ends_at).toLocaleDateString();
        return { status: 'trial', message: `You are on a free trial until ${endDate}.` };
    }

    return { status: 'expired', message: 'Your subscription is inactive. Please use an activation key.' };
};

/**
 * Activates a subscription for a tenant using a provided key.
 * @param {string} tenantId The ID of the tenant.
 * @param {string} key The activation key provided by the tenant.
 * @returns {object} An object containing a success flag and a user-friendly message.
 */
const activateSubscription = async (tenantId, key) => {
    // 1. Find the activation key
    const { data: activationKey, error: keyError } = await dbClient
        .from('activation_keys')
        .select('*')
        .eq('key', key)
        .single();

    if (keyError || !activationKey) {
        return { success: false, message: 'Invalid activation key. Please check the key and try again.' };
    }

    // 2. Check if the key is already used
    if (activationKey.is_used) {
        return { success: false, message: 'This activation key has already been used.' };
    }

    // 3. Activate the subscription
    const now = new Date();
    const endDate = new Date(now.setDate(now.getDate() + activationKey.duration_days));

    const { error: updateTenantError } = await dbClient
        .from('tenants')
        .update({
            subscription_status: 'active',
            subscription_start_date: new Date().toISOString(),
            subscription_end_date: endDate.toISOString(),
            activated_key_id: activationKey.id
        })
        .eq('id', tenantId);

    if (updateTenantError) {
        console.error('Error updating tenant subscription:', updateTenantError.message);
        return { success: false, message: 'There was an error activating your subscription. Please contact support.' };
    }

    // 4. Mark the key as used
    await dbClient
        .from('activation_keys')
        .update({
            is_used: true,
            used_by_tenant_id: tenantId,
            activated_at: new Date().toISOString()
        })
        .eq('id', activationKey.id);

    return { success: true, message: `Your subscription has been successfully activated! It is valid until ${endDate.toLocaleDateString()}.` };
};

module.exports = {
    checkSubscriptionStatus,
    activateSubscription,
};

