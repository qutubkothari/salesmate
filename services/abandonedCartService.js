/**
 * @title Abandoned Cart Service
 * @description Manages the logic for detecting and sending recovery messages for abandoned shopping carts.
 */
const { dbClient } = require('./config');
const { sendMessage } = require('./whatsappService');
const { logMessage } = require('./historyService');

/**
 * Finds and processes abandoned carts for all tenants who have the feature enabled.
 * This function is designed to be run periodically by a scheduler.
 */
const processAbandonedCarts = async () => {
    try {
        // 1. Get all tenants to check their custom settings.
        const { data: tenants, error: tenantsError } = await dbClient
            .from('tenants')
            .select('id, phone_number, abandoned_cart_delay_hours, abandoned_cart_message');

        if (tenantsError) throw tenantsError;
        if (!tenants || tenants.length === 0) return;

        console.log(`Checking for abandoned carts for ${tenants.length} tenant(s)...`);

        for (const tenant of tenants) {
            const delayHours = tenant.abandoned_cart_delay_hours;
            const reminderMessage = tenant.abandoned_cart_message;

            // Skip if the tenant hasn't configured this feature.
            if (!delayHours || !reminderMessage) continue;

            const now = new Date();
            const olderThan = new Date(now.getTime() - (delayHours * 60 * 60 * 1000)).toISOString();
            // We also add an upper bound to avoid sending reminders for very old carts, e.g., older than 48 hours.
            const newerThan = new Date(now.getTime() - (48 * 60 * 60 * 1000)).toISOString();

            // 2. Find carts that were updated within the abandoned window and haven't had a reminder sent.
            const { data: abandonedCarts, error: cartsError } = await dbClient
                .from('carts')
                .select(`
                    id,
                    conversation:conversations ( id, tenant_id, end_user_phone ),
                    items:cart_items ( id )
                `)
                .eq('conversation.tenant_id', tenant.id)
                .eq('reminder_sent', false)
                .lt('updated_at', olderThan)
                .gt('updated_at', newerThan);

            if (cartsError) {
                console.error(`Error fetching abandoned carts for tenant ${tenant.id}:`, cartsError.message);
                continue;
            }

            if (abandonedCarts && abandonedCarts.length > 0) {
                for (const cart of abandonedCarts) {
                    // Make sure the cart still has items in it.
                    if (cart.items && cart.items.length > 0) {
                        const endUserPhone = cart.conversation.end_user_phone;
                        console.log(`Sending abandoned cart reminder to ${endUserPhone} for tenant ${tenant.id}`);

                        // 3. Send the reminder and log it.
                        await sendMessage(endUserPhone, reminderMessage);
                        await logMessage(tenant.id, endUserPhone, 'bot', reminderMessage, 'abandoned_cart_reminder');

                        // 4. Mark the cart as having a reminder sent to prevent re-sending.
                        await dbClient
                            .from('carts')
                            .update({ reminder_sent: true })
                            .eq('id', cart.id);
                    }
                }
            }
        }
    } catch (error) {
        console.error('Error processing abandoned carts:', error.message);
    }
};

module.exports = {
    processAbandonedCarts,
};



