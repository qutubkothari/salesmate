/**
 * @title Bulk Message Scheduling Service
 * @description Handles the logic for processing contact lists, scheduling bulk messages, and sending them.
 */
const { dbClient } = require('./config');
const xlsx = require('xlsx');
const fetch = require('node-fetch');
const { sendMessage, sendMessageWithImage } = require('./whatsappService');
const crypto = require('crypto');

/**
 * Downloads and parses an Excel file from a URL.
 * @param {string} mediaUrl The URL of the Excel file.
 * @returns {Array<string>} An array of phone numbers.
 */
const parseContactSheet = async (mediaUrl) => {
    try {
        const response = await fetch(mediaUrl);
        if (!response.ok) {
            throw new Error(`Failed to download file: ${response.statusText}`);
        }
        const buffer = await response.arrayBuffer();
        const workbook = xlsx.read(buffer, { type: 'buffer' });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const json = xlsx.utils.sheet_to_json(worksheet, { header: 1 });

        // Assuming phone numbers are in the first column
        return json.map(row => String(row[0])).filter(phone => phone);
    } catch (error) {
        console.error('Error parsing contact sheet:', error.message);
        return [];
    }
};

/**
 * Processes a contact sheet and schedules messages to be sent for a campaign.
 * @param {string} tenantId The ID of the tenant.
 * @param {string} mediaUrl The URL of the Excel file with contacts.
 * @param {string} message The message to be sent.
 * @param {string} tenantPhone The tenant's phone number for notifications.
 * @param {string} campaignName The name of the campaign.
 * @param {string} sendAt The ISO string of the scheduled send time.
 * @param {string} [imageUrl=null] Optional URL of an image to send with the message.
 */
const processContactSheet = async (tenantId, mediaUrl, message, tenantPhone, campaignName, sendAt, imageUrl = null) => {
    try {
        await sendMessage(tenantPhone, `Processing your contact list for campaign: "${campaignName}". I will notify you when the messages are scheduled.`);
        const phoneNumbers = await parseContactSheet(mediaUrl);

        if (phoneNumbers.length === 0) {
            return sendMessage(tenantPhone, 'Could not find any phone numbers in the uploaded file. Please check the format and try again.');
        }

        const campaignId = crypto.randomUUID(); // Generate a single UUID for this entire campaign batch

        const schedules = phoneNumbers.map(phone => ({
            tenant_id: tenantId,
            name: campaignName,
            to_phone_number: phone,
            message_text: message,
            message_body: message,
            media_url: imageUrl,
            scheduled_at: sendAt, // Use the provided send time
            campaign_id: campaignId,
            campaign_name: campaignName,
            status: 'pending',
            retry_count: 0,
        }));

        const { error } = await dbClient.from('bulk_schedules').insert(schedules);

        if (error) {
            throw error;
        }
        
        const formattedDate = new Date(sendAt).toLocaleString();
        await sendMessage(tenantPhone, `Successfully scheduled ${phoneNumbers.length} messages for campaign "${campaignName}" to be sent at ${formattedDate}.`);

    } catch (error) {
        console.error('Error in processContactSheet:', error.message);
        await sendMessage(tenantPhone, 'An unexpected error occurred while processing your file. Please contact support.');
    }
};


/**
 * Finds and sends any scheduled messages that are due.
 */
const findAndSendScheduledMessages = async () => {
    try {
        const now = new Date().toISOString();
        const { data: dueMessages, error } = await dbClient
            .from('bulk_schedules')
            .select('*')
            .eq('is_sent', false)
            .lte('scheduled_at', now);

        if (error) throw error;

        if (dueMessages && dueMessages.length > 0) {
            console.log(`Found ${dueMessages.length} scheduled messages to send.`);

            for (const msg of dueMessages) {
                let messageId = null;
                if (msg.media_url) {
                    messageId = await sendMessageWithImage(msg.to_phone_number, msg.message_body, msg.media_url);
                } else {
                    messageId = await sendMessage(msg.to_phone_number, msg.message_body);
                }

                if (messageId) {
                    await dbClient
                        .from('bulk_schedules')
                        .update({
                            is_sent: true,
                            sent_at: new Date().toISOString(),
                            delivery_status: 'sent',
                            message_id: messageId
                        })
                        .eq('id', msg.id);
                } else {
                    await dbClient
                        .from('bulk_schedules')
                        .update({
                            is_sent: true,
                            sent_at: new Date().toISOString(),
                            delivery_status: 'failed'
                        })
                        .eq('id', msg.id);
                }
            }
        }
    } catch (error) {
        console.error('Error sending scheduled messages:', error.message);
    }
};

module.exports = {
    processContactSheet,
    findAndSendScheduledMessages,
};


