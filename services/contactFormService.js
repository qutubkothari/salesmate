/**
 * @title Contact Form Service
 * @description Manages the multi-step logic for the contact form feature.
 */
const { dbClient } = require('./config');
const { sendMessage } = require('./whatsappService');
const { logMessage, getConversationId } = require('./historyService');

/**
 * Handles the different states of a contact form conversation.
 * @param {object} tenant The full tenant object.
 * @param {object} conversation The current conversation object, including its state.
 * @param {string} userMessage The message sent by the end-user.
 */
const handleContactForm = async (tenant, conversation, userMessage) => {
    const endUserPhone = conversation.end_user_phone;
    const tenantId = tenant.id;

    switch (conversation.state) {
        case 'awaiting_name':
            // 1. Save the name and update the state to ask for the email.
            await dbClient
                .from('contact_submissions')
                .update({ customer_name: userMessage })
                .eq('conversation_id', conversation.id);

            await dbClient
                .from('conversations')
                .update({ state: 'awaiting_email' })
                .eq('id', conversation.id);

            const emailQuestion = "Thanks! What is your email address?";
            await sendMessage(endUserPhone, emailQuestion);
            await logMessage(tenantId, endUserPhone, 'bot', emailQuestion);
            break;

        case 'awaiting_email':
            // 2. Save the email and update the state to ask for the query.
            await dbClient
                .from('contact_submissions')
                .update({ customer_email: userMessage })
                .eq('conversation_id', conversation.id);

            await dbClient
                .from('conversations')
                .update({ state: 'awaiting_query' })
                .eq('id', conversation.id);

            const queryQuestion = "Great. And what is your question or message for us?";
            await sendMessage(endUserPhone, queryQuestion);
            await logMessage(tenantId, endUserPhone, 'bot', queryQuestion);
            break;

        case 'awaiting_query':
            // 3. Save the final query, clear the state, and notify the tenant.
            await dbClient
                .from('contact_submissions')
                .update({ customer_query: userMessage })
                .eq('conversation_id', conversation.id);

            // Clear the state to end the contact form flow.
            await dbClient
                .from('conversations')
                .update({ state: null })
                .eq('id', conversation.id);

            const confirmationMessage = "Thank you for your submission! A team member will get back to you shortly.";
            await sendMessage(endUserPhone, confirmationMessage);
            await logMessage(tenantId, endUserPhone, 'bot', confirmationMessage);

            // Notify the tenant of the new submission.
            const tenantNotification = `ðŸŽ‰ *New Contact Form Submission!*\n\nA new inquiry has been received from ${endUserPhone}. View the full conversation using the /history command.`;
            await sendMessage(tenant.phone_number, tenantNotification);
            break;
    }
};

/**
 * Initiates the contact form process for a user.
 * @param {string} tenantId The ID of the tenant.
 * @param {string} endUserPhone The phone number of the customer.
 */
const startContactForm = async (tenantId, endUserPhone) => {
    const conversationId = await getConversationId(tenantId, endUserPhone);
    if (!conversationId) {
        console.error('Could not start contact form: conversation ID not found.');
        return;
    }

    // Create a new submission record
    await dbClient
        .from('contact_submissions')
        .insert({
            tenant_id: tenantId,
            conversation_id: conversationId
        });

    // Set the initial state for the conversation
    await dbClient
        .from('conversations')
        .update({ state: 'awaiting_name' })
        .eq('id', conversationId);

    const nameQuestion = "You've initiated a contact request. First, what is your full name?";
    await sendMessage(endUserPhone, nameQuestion);
    await logMessage(tenantId, endUserPhone, 'bot', nameQuestion);
};

module.exports = {
    handleContactForm,
    startContactForm,
};

