/**
 * @title Tenant Referral Service
 * @description Manages all logic for the tenant referral program, including code generation and rewards.
 */
const { dbClient } = require('./config');
const { sendMessage } = require('./whatsappService');
const crypto = require('crypto');

const REFERRAL_BONUS_DAYS = 7; // The number of free days to grant for a successful referral

/**
 * Generates a unique, human-readable referral code.
 * @returns {string} A unique referral code (e.g., REF-A1B2C3D4).
 */
const generateReferralCode = () => {
    const randomPart = crypto.randomBytes(4).toString('hex').toUpperCase();
    return `REF-${randomPart}`;
};

/**
 * Applies a subscription extension bonus to a tenant.
 * @param {string} tenantId The ID of the tenant receiving the bonus.
 * @param {string} reason A message explaining why they received the bonus.
 */
const applyReferralBonus = async (tenantId, reason) => {
    try {
        const { data: tenant, error } = await dbClient
            .from('tenants')
            .select('id, phone_number, subscription_end_date')
            .eq('id', tenantId)
            .single();

        if (error || !tenant) {
            console.error(`Could not find tenant ${tenantId} to apply bonus.`);
            return;
        }

        const currentEndDate = new Date(tenant.subscription_end_date || Date.now());
        const newEndDate = new Date(currentEndDate.setDate(currentEndDate.getDate() + REFERRAL_BONUS_DAYS));

        await dbClient
            .from('tenants')
            .update({ subscription_end_date: newEndDate.toISOString(), subscription_status: 'active' })
            .eq('id', tenant.id);

        const bonusMessage = `ðŸŽ‰ *Referral Bonus!*\n\n${reason} We've extended your subscription by ${REFERRAL_BONUS_DAYS} days!`;
        await sendMessage(tenant.phone_number, bonusMessage);
        console.log(`Applied ${REFERRAL_BONUS_DAYS}-day referral bonus to tenant ${tenantId}.`);

    } catch (error) {
        console.error('Error applying referral bonus:', error.message);
    }
};

/**
 * Processes a referral code for a tenant.
 * @param {string} tenantId The ID of the tenant applying the code.
 * @param {string} referralCode The referral code they provided.
 * @returns {Promise<{success: boolean, message: string}>} An object indicating the result of the operation.
 */
const processReferral = async (tenantId, referralCode) => {
    try {
        // 1. Check if the current tenant has already been referred.
        const { data: currentTenant, error: tenantError } = await dbClient
            .from('tenants')
            .select('referred_by')
            .eq('id', tenantId)
            .single();

        if (tenantError) throw tenantError;
        if (currentTenant.referred_by) {
            return { success: false, message: "You have already applied a referral code to your account." };
        }

        // 2. Find the tenant who owns the referral code (the referrer).
        const { data: referrer, error: referrerError } = await dbClient
            .from('tenants')
            .select('id, phone_number')
            .eq('referral_code', referralCode.toUpperCase())
            .single();

        if (referrerError || !referrer) {
            return { success: false, message: `The referral code "${referralCode}" is not valid.` };
        }

        // 3. Prevent a user from using their own code.
        if (referrer.id === tenantId) {
            return { success: false, message: "You cannot use your own referral code." };
        }

        // 4. Link the new tenant to the referrer.
        await dbClient
            .from('tenants')
            .update({ referred_by: referrer.id })
            .eq('id', tenantId);

        // 5. Apply the bonus to the new tenant.
        await applyReferralBonus(tenantId, `Thanks for using a referral code!`);

        // 6. Apply the bonus to the referrer.
        await applyReferralBonus(referrer.id, `Someone just signed up with your referral code!`);

        return { success: true, message: "Referral code applied successfully! You and the referrer have both received a subscription bonus." };

    } catch (error) {
        console.error('Error processing referral:', error.message);
        return { success: false, message: "An error occurred while applying the referral code. Please contact support." };
    }
};

module.exports = {
    generateReferralCode,
    processReferral,
};


