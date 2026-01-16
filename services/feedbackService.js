/**
 * @title Customer Feedback Service
 * @description Manages the multi-step logic for collecting customer feedback and generating reports.
 */
const { dbClient } = require('./config');
const { sendMessage } = require('./whatsappService');
const { logMessage, getConversationId } = require('./historyService');

/**
 * Handles the different states of a feedback form conversation.
 * @param {object} tenant The full tenant object.
 * @param {object} conversation The current conversation object, including its state.
 * @param {string} userMessage The message sent by the end-user.
 */
const handleFeedbackForm = async (tenant, conversation, userMessage) => {
    const endUserPhone = conversation.end_user_phone;
    const tenantId = tenant.id;

    switch (conversation.state) {
        case 'awaiting_feedback_rating':
            const rating = parseInt(userMessage, 10);
            // 1. Validate and save the rating, then ask for a comment.
            if (isNaN(rating) || rating < 1 || rating > 5) {
                const invalidRatingMsg = "Please provide a valid rating between 1 and 5.";
                await sendMessage(endUserPhone, invalidRatingMsg);
                await logMessage(tenantId, endUserPhone, 'bot', invalidRatingMsg);
                return; // Wait for a valid rating
            }

            await dbClient
                .from('feedback_submissions')
                .update({ rating: rating })
                .eq('conversation_id', conversation.id);

            await dbClient
                .from('conversations_new')
                .update({ state: 'awaiting_feedback_comment' })
                .eq('id', conversation.id);

            const commentQuestion = "Thank you for the rating! Would you like to leave a comment about your experience?";
            await sendMessage(endUserPhone, commentQuestion);
            await logMessage(tenantId, endUserPhone, 'bot', commentQuestion);
            break;

        case 'awaiting_feedback_comment':
            // 2. Save the comment, clear the state, and notify the tenant.
            await dbClient
                .from('feedback_submissions')
                .update({ comment: userMessage })
                .eq('conversation_id', conversation.id);

            // Clear the state to end the feedback flow.
            await dbClient
                .from('conversations_new')
                .update({ state: null })
                .eq('id', conversation.id);

            const confirmationMessage = "We appreciate your feedback! It helps us improve our service.";
            await sendMessage(endUserPhone, confirmationMessage);
            await logMessage(tenantId, endUserPhone, 'bot', confirmationMessage);

            // Notify the tenant of the new feedback.
            const tenantNotification = `⭐ *New Customer Feedback Received!*\n\nA customer (${endUserPhone}) has left new feedback. View the full conversation using the /history command.`;
            await sendMessage(tenant.phone_number, tenantNotification);
            break;
    }
};

/**
 * Initiates the feedback collection process for a user.
 * @param {string} tenantId The ID of the tenant.
 * @param {string} endUserPhone The phone number of the customer.
 */
const startFeedbackForm = async (tenantId, endUserPhone) => {
    const conversationId = await getConversationId(tenantId, endUserPhone);
    if (!conversationId) {
        console.error('Could not start feedback form: conversation ID not found.');
        return;
    }

    // Create a new submission record
    await dbClient
        .from('feedback_submissions')
        .insert({
            tenant_id: tenantId,
            conversation_id: conversationId
        });

    // Set the initial state for the conversation
    await dbClient
        .from('conversations_new')
        .update({ state: 'awaiting_feedback_rating' })
        .eq('id', conversationId);

    const ratingQuestion = "We'd love to get your feedback! On a scale of 1 to 5, how would you rate your experience with us today?";
    await sendMessage(endUserPhone, ratingQuestion);
    await logMessage(tenantId, endUserPhone, 'bot', ratingQuestion);
};

/**
 * Fetches and formats a report of all feedback for a tenant.
 * @param {string} tenantId The ID of the tenant.
 * @returns {Promise<string>} A formatted string containing the feedback report.
 */
const getFeedbackReport = async (tenantId) => {
    try {
        const { data, error } = await dbClient
            .from('feedback_submissions')
            .select('rating, comment, created_at')
            .eq('tenant_id', tenantId)
            .not('rating', 'is', null) // Only include completed feedback
            .order('created_at', { ascending: false });

        if (error) throw error;

        if (!data || data.length === 0) {
            return "You have not received any customer feedback yet.";
        }

        const totalSubmissions = data.length;
        const averageRating = data.reduce((sum, item) => sum + item.rating, 0) / totalSubmissions;

        let report = `📝 *Customer Feedback Report*\n\n`;
        report += `*Total Submissions:* ${totalSubmissions}\n`;
        report += `*Average Rating:* ${averageRating.toFixed(2)} / 5.00\n\n`;
        report += `*Recent Comments:*\n`;

        // Show the 5 most recent comments
        data.slice(0, 5).forEach(item => {
            if (item.comment) {
                const date = new Date(item.created_at).toLocaleDateString();
                report += `\n- *[${date}] Rating: ${item.rating}⭐*\n  _"${item.comment}"_\n`;
            }
        });

        return report;

    } catch (error) {
        console.error('Error getting feedback report:', error.message);
        return 'An error occurred while generating your feedback report.';
    }
};

module.exports = {
    handleFeedbackForm,
    startFeedbackForm,
    getFeedbackReport, // Export the new function
};



