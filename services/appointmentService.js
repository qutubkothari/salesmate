/**
 * @title Appointment Booking Service
 * @description Manages the multi-step logic for booking appointments.
 */
const { dbClient } = require('./config');
const { sendMessage } = require('./whatsappService');
const { logMessage, getConversationId } = require('./historyService');
const chrono = require('chrono-node');

/**
 * Handles the different states of an appointment booking conversation.
 * @param {object} tenant The full tenant object.
 * @param {object} conversation The current conversation object, including its state.
 * @param {string} userMessage The message sent by the end-user.
 */
const handleAppointmentBooking = async (tenant, conversation, userMessage) => {
    const endUserPhone = conversation.end_user_phone;
    const tenantId = tenant.id;
    let tempStorage = JSON.parse(conversation.temp_storage || '{}');

    switch (conversation.state) {
        case 'awaiting_appointment_date':
            // 1. Parse the date and ask for the time.
            const parsedDate = chrono.parseDate(userMessage, new Date(), { forwardDate: true });
            if (!parsedDate) {
                const invalidDateMsg = "I couldn't understand that date. Please try again (e.g., 'tomorrow', 'next Friday', 'October 25th').";
                await sendMessage(endUserPhone, invalidDateMsg);
                await logMessage(tenantId, endUserPhone, 'bot', invalidDateMsg);
                return;
            }

            tempStorage.date = parsedDate.toISOString().split('T')[0]; // Store date as YYYY-MM-DD

            await dbClient
                .from('conversations_new')
                .update({
                    state: 'awaiting_appointment_time',
                    temp_storage: JSON.stringify(tempStorage)
                })
                .eq('id', conversation.id);

            const timeQuestion = `Great, you've selected ${tempStorage.date}. What time would you like to book? (e.g., '3pm', '10:30am')`;
            await sendMessage(endUserPhone, timeQuestion);
            await logMessage(tenantId, endUserPhone, 'bot', timeQuestion);
            break;

        case 'awaiting_appointment_time':
            // 2. Parse the time, combine with the date, and ask for notes.
            const referenceDate = new Date(tempStorage.date);
            const parsedTime = chrono.parseDate(userMessage, referenceDate, { forwardDate: true });

            if (!parsedTime) {
                const invalidTimeMsg = "I couldn't understand that time. Please try again (e.g., '3pm', '10:30am').";
                await sendMessage(endUserPhone, invalidTimeMsg);
                await logMessage(tenantId, endUserPhone, 'bot', invalidTimeMsg);
                return;
            }

            const appointmentDateTime = parsedTime.toISOString();

            await dbClient
                .from('appointments')
                .update({ appointment_datetime: appointmentDateTime })
                .eq('conversation_id', conversation.id);

            await dbClient
                .from('conversations_new')
                .update({
                    state: 'awaiting_appointment_notes',
                    temp_storage: null // Clear temp storage
                })
                .eq('id', conversation.id);

            const notesQuestion = `Excellent! Your appointment is tentatively booked for ${parsedTime.toLocaleString()}. Are there any notes or details you'd like to add? (or type 'no')`;
            await sendMessage(endUserPhone, notesQuestion);
            await logMessage(tenantId, endUserPhone, 'bot', notesQuestion);
            break;

        case 'awaiting_appointment_notes':
            // 3. Save the notes, confirm, and notify the tenant.
            const notes = userMessage.toLowerCase().trim() === 'no' ? null : userMessage;
            await dbClient
                .from('appointments')
                .update({ customer_notes: notes, status: 'confirmed' })
                .eq('conversation_id', conversation.id);

            // Clear the state to end the booking flow.
            await dbClient
                .from('conversations_new')
                .update({ state: null })
                .eq('id', conversation.id);

            const confirmationMessage = "Your appointment has been successfully booked! We look forward to speaking with you.";
            await sendMessage(endUserPhone, confirmationMessage);
            await logMessage(tenantId, endUserPhone, 'bot', confirmationMessage);

            const { data: finalAppointment } = await dbClient.from('appointments').select('appointment_datetime').eq('conversation_id', conversation.id).single();
            const finalDateTime = new Date(finalAppointment.appointment_datetime).toLocaleString();

            const tenantNotification = `🗓️ *New Appointment Booked!*\n\nA new appointment has been booked with ${endUserPhone} for *${finalDateTime}*.`;
            await sendMessage(tenant.phone_number, tenantNotification);
            break;
    }
};

/**
 * Initiates the appointment booking process for a user.
 * @param {string} tenantId The ID of the tenant.
 * @param {string} endUserPhone The phone number of the customer.
 */
const startAppointmentBooking = async (tenantId, endUserPhone) => {
    const conversationId = await getConversationId(tenantId, endUserPhone);
    if (!conversationId) {
        console.error('Could not start appointment booking: conversation ID not found.');
        return;
    }

    // Create a new appointment record
    await dbClient
        .from('appointments')
        .insert({
            tenant_id: tenantId,
            conversation_id: conversationId
        });

    // Set the initial state for the conversation
    await dbClient
        .from('conversations_new')
        .update({ state: 'awaiting_appointment_date' })
        .eq('id', conversationId);

    const dateQuestion = "You'd like to book an appointment. What date works for you? (e.g., 'tomorrow', 'next Friday')";
    await sendMessage(endUserPhone, dateQuestion);
    await logMessage(tenantId, endUserPhone, 'bot', dateQuestion);
};

module.exports = {
    handleAppointmentBooking,
    startAppointmentBooking,
};


