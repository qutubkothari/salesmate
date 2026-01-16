/**
 * @title Manual Reminder Service
 * @description Handles the logic for setting and sending manual conversation reminders for tenants.
 */
const { dbClient } = require('./config');
const { sendMessage } = require('./whatsappService');
const chrono = require('chrono-node');

/**
 * Sets a manual reminder for a specific conversation.
 * @param {string} tenantId The ID of the tenant.
 * @param {string} endUserPhone The phone number of the customer.
 * @param {string} reminderText The full reminder text from the tenant (e.g., "remind me to call in 2 hours").
 * @returns {Promise<string>} A confirmation or error message to send back to the tenant.
 */
const setManualReminder = async (tenantId, endUserPhone, reminderText) => {
    try {
        // 1. Find the conversation to set the reminder on.
        const { data: conversation, error: convError } = await dbClient
            .from('conversations_new')
            .select('id')
            .eq('tenant_id', tenantId)
            .eq('end_user_phone', endUserPhone)
            .single();

        if (convError || !conversation) {
            return `Could not find an active conversation for the number ${endUserPhone}. Please send them a message first.`;
        }

        // 2. Use chrono-node to parse the date/time from the text.
        const parsedDate = chrono.parseDate(reminderText);
        if (!parsedDate) {
            return "I couldn't understand the time for the reminder. Please try a clearer format (e.g., 'in 2 hours', 'tomorrow at 3pm').";
        }

        // 3. Update the conversation with the reminder details.
        const { error: updateError } = await dbClient
            .from('conversations_new')
            .update({
                reminder_at: parsedDate.toISOString(),
                reminder_message: reminderText
            })
            .eq('id', conversation.id);

        if (updateError) throw updateError;

        const formattedDate = new Date(parsedDate).toLocaleString('en-US', { timeZone: 'UTC' });
        return `Reminder set for ${endUserPhone} at ${formattedDate} (UTC).`;

    } catch (error) {
        console.error('Error setting manual reminder:', error.message);
        return 'An error occurred while trying to set the reminder.';
    }
};

/**
 * Checks for any due manual reminders and sends them to the tenants.
 */
const sendDueManualReminders = async () => {
    try {
        const now = new Date().toISOString();
        const { data: dueReminders, error } = await dbClient
            .from('conversations_new')
            .select('id, tenant_id, end_user_phone, reminder_message, reminder_at')
            .not('reminder_at', 'is', null)
            .lte('reminder_at', now);

        if (error) throw error;

        if (dueReminders && dueReminders.length > 0) {
            console.log(`Found ${dueReminders.length} due manual reminders to send.`);

            for (const reminder of dueReminders) {
                const { data: tenant } = await dbClient.from('tenants').select('phone_number').eq('id', reminder.tenant_id).single();
                if (!tenant?.phone_number) continue;
                const tenantPhoneNumber = tenant.phone_number;
                const customerPhoneNumber = reminder.end_user_phone;
                const reminderMessage = `🔔 *Reminder for your chat with ${customerPhoneNumber}*\n\nYou asked me to remind you: "${reminder.reminder_message}"`;

                // Send the reminder message to the tenant.
                await sendMessage(tenantPhoneNumber, reminderMessage);

                // Clear the reminder fields so it doesn't send again.
                await dbClient
                    .from('conversations_new')
                    .update({ reminder_at: null, reminder_message: null })
                    .eq('id', reminder.id);

                console.log(`Manual reminder sent to ${tenantPhoneNumber} for customer ${customerPhoneNumber}.`);
            }
        }
    } catch (error) {
        console.error('Error sending due manual reminders:', error.message);
    }
};

module.exports = {
    setManualReminder,
    sendDueManualReminders,
};


