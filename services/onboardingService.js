/**
 * @title Automated Onboarding Service
 * @description Manages the logic for sending automated onboarding messages to new tenants.
 */
const { dbClient } = require('./config');
const { sendMessage } = require('./whatsappService');

/**
 * Finds tenants who are due for an onboarding message and sends it.
 * This function is designed to be run periodically by a scheduler.
 */
const sendDueOnboardingMessages = async () => {
    try {
        // 1. Get all available onboarding messages from the database.
        const { data: onboardingMessages, error: messagesError } = await dbClient
            .from('onboarding_messages')
            .select('*')
            .order('delay_hours', { ascending: true });

        if (messagesError) throw messagesError;
        if (!onboardingMessages || onboardingMessages.length === 0) {
            // No onboarding messages are defined, so nothing to do.
            return;
        }

        // 2. Get all tenants to check against.
        const { data: tenants, error: tenantsError } = await dbClient
            .from('tenants')
            .select('id, phone_number, created_at');

        if (tenantsError) throw tenantsError;
        if (!tenants || tenants.length === 0) {
            return;
        }

        // 3. Get a list of all messages that have already been sent.
        const { data: sentMessages, error: sentMessagesError } = await dbClient
            .from('sent_onboarding_messages')
            .select('tenant_id, onboarding_message_id');

        if (sentMessagesError) throw sentMessagesError;

        // Create a quick lookup Set for sent messages (format: 'tenantId_messageId')
        const sentMessagesSet = new Set(
            sentMessages.map(item => `${item.tenant_id}_${item.onboarding_message_id}`)
        );

        console.log(`Checking onboarding status for ${tenants.length} tenants...`);

        // 4. Determine which messages to send.
        const messagesToSend = [];
        const now = new Date();

        for (const tenant of tenants) {
            const tenantSignupTime = new Date(tenant.created_at);
            for (const message of onboardingMessages) {
                // Calculate when this message was due for this tenant
                const dueDate = new Date(tenantSignupTime.getTime() + message.delay_hours * 60 * 60 * 1000);
                const lookupKey = `${tenant.id}_${message.id}`;

                // Check if the due date has passed and the message has NOT been sent
                if (now >= dueDate && !sentMessagesSet.has(lookupKey)) {
                    messagesToSend.push({
                        to: tenant.phone_number,
                        text: `🚀 *Pro Tip:*\n\n${message.message_body}`,
                        tenant_id: tenant.id,
                        onboarding_message_id: message.id,
                    });
                }
            }
        }

        // 5. Send the due messages and log them.
        if (messagesToSend.length > 0) {
            console.log(`Sending ${messagesToSend.length} onboarding message(s)...`);
            const sentLogs = [];

            for (const msg of messagesToSend) {
                await sendMessage(msg.to, msg.text);
                sentLogs.push({
                    tenant_id: msg.tenant_id,
                    onboarding_message_id: msg.onboarding_message_id,
                });
            }

            // Log all sent messages in a single batch operation.
            await dbClient.from('sent_onboarding_messages').insert(sentLogs);
            console.log('Onboarding messages sent and logged successfully.');
        } else {
            console.log('No new onboarding messages to send at this time.');
        }

    } catch (error) {
        console.error('Error sending due onboarding messages:', error.message);
    }
};

module.exports = {
    sendDueOnboardingMessages,
};


