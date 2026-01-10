/**
 * @title Drip Campaign Service
 * @description Manages all logic related to creating, managing, and executing automated drip campaigns.
 */
const { dbClient } = require('./config');
const { sendMessage, sendMessageWithImage } = require('./whatsappService');
const xlsx = require('xlsx');
const fetch = require('node-fetch');

/**
 * Creates a new drip campaign for a tenant.
 * @param {string} tenantId The ID of the tenant.
 * @param {string} campaignName The name for the new campaign.
 * @returns {Promise<string>} A confirmation or error message.
 */
const createDripCampaign = async (tenantId, campaignName) => {
    try {
        const { error } = await dbClient
            .from('drip_campaigns')
            .insert({ tenant_id: tenantId, campaign_name: campaignName });

        if (error) {
            if (error.code === '23505') { // Unique constraint violation
                return `A campaign with the name "${campaignName}" already exists.`;
            }
            throw error;
        }
        return `Successfully created new drip campaign: "${campaignName}".`;
    } catch (error) {
        console.error('Error creating drip campaign:', error.message);
        return 'An error occurred while creating the campaign.';
    }
};

/**
 * Adds a message to a specific drip campaign.
 * @param {string} tenantId The ID of the tenant.
 * @param {string} campaignName The name of the campaign.
 * @param {number} sequenceOrder The order of this message in the sequence (1, 2, 3...).
 * @param {number} delayHours The delay in hours after the previous message.
 * @param {string} messageBody The text of the message.
 * @param {string|null} mediaUrl Optional URL for an image.
 * @returns {Promise<string>} A confirmation or error message.
 */
const addMessageToDripCampaign = async (tenantId, campaignName, sequenceOrder, delayHours, messageBody, mediaUrl = null) => {
    try {
        const { data: campaign, error: campError } = await dbClient
            .from('drip_campaigns')
            .select('id')
            .eq('tenant_id', tenantId)
            .eq('campaign_name', campaignName)
            .single();

        if (campError || !campaign) {
            return `Could not find a campaign named "${campaignName}". Please create it first.`;
        }

        await dbClient.from('drip_campaign_messages').upsert({
            campaign_id: campaign.id,
            sequence_order: sequenceOrder,
            delay_hours: delayHours,
            message_body: messageBody,
            media_url: mediaUrl
        }, { onConflict: 'campaign_id, sequence_order' });

        return `Message #${sequenceOrder} added to campaign "${campaignName}" successfully.`;
    } catch (error) {
        console.error('Error adding message to drip campaign:', error.message);
        return 'An error occurred while adding the message.';
    }
};

/**
 * Subscribes a list of users to a drip campaign.
 * @param {string} tenantId The ID of the tenant.
 * @param {string} campaignName The name of the campaign.
 * @param {string[]} phoneNumbers An array of phone numbers to subscribe.
 * @returns {Promise<string>} A confirmation or error message.
 */
const subscribeUsersToDripCampaign = async (tenantId, campaignName, phoneNumbers) => {
    try {
        const { data: campaign, error: campError } = await dbClient
            .from('drip_campaigns')
            .select('id')
            .eq('tenant_id', tenantId)
            .eq('campaign_name', campaignName)
            .single();

        if (campError || !campaign) {
            return `Could not find a campaign named "${campaignName}".`;
        }

        const subscribers = phoneNumbers.map(phone => ({
            campaign_id: campaign.id,
            end_user_phone: phone,
        }));

        await dbClient.from('drip_campaign_subscribers').upsert(subscribers, { onConflict: 'campaign_id, end_user_phone' });

        return `Successfully subscribed ${phoneNumbers.length} user(s) to the "${campaignName}" campaign. The first message will be sent according to its schedule.`;
    } catch (error) {
        console.error('Error subscribing users to drip campaign:', error.message);
        return 'An error occurred while subscribing users.';
    }
};

/**
 * Downloads and parses a contact sheet from a URL.
 * @param {string} mediaUrl The URL of the Excel file.
 * @returns {Promise<string[]>} An array of phone numbers.
 */
const parseContactSheet = async (mediaUrl) => {
    try {
        const response = await fetch(mediaUrl);
        if (!response.ok) throw new Error(`Failed to download file: ${response.statusText}`);
        const buffer = await response.arrayBuffer();
        const workbook = xlsx.read(buffer, { type: 'buffer' });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const json = xlsx.utils.sheet_to_json(worksheet, { header: 1 });
        return json.map(row => String(row[0])).filter(phone => phone);
    } catch (error) {
        console.error('Error parsing contact sheet:', error.message);
        return [];
    }
};

/**
 * Subscribes users from an Excel sheet to a drip campaign.
 * @param {string} tenantId The ID of the tenant.
 * @param {string} campaignName The name of the campaign.
 * @param {string} mediaUrl The URL of the contact sheet.
 * @returns {Promise<string>} A confirmation or error message.
 */
const subscribeUsersFromSheet = async (tenantId, campaignName, mediaUrl) => {
    const phoneNumbers = await parseContactSheet(mediaUrl);
    if (phoneNumbers.length === 0) {
        return 'Could not find any phone numbers in the uploaded file.';
    }
    return subscribeUsersToDripCampaign(tenantId, campaignName, phoneNumbers);
};

/**
 * Lists all drip campaigns for a tenant.
 * @param {string} tenantId The ID of the tenant.
 * @returns {Promise<string>} A formatted list of campaign names.
 */
const listDripCampaigns = async (tenantId) => {
    try {
        const { data, error } = await dbClient
            .from('drip_campaigns')
            .select('campaign_name')
            .eq('tenant_id', tenantId);
        if (error) throw error;
        if (!data || data.length === 0) return 'You have no drip campaigns. Use `/create_drip` to start one.';
        return `*Your Drip Campaigns:*\n- ${data.map(c => c.campaign_name).join('\n- ')}`;
    } catch (e) {
        return 'Error fetching campaigns.';
    }
};

/**
 * Views the messages and structure of a specific drip campaign.
 * @param {string} tenantId The ID of the tenant.
 * @param {string} campaignName The name of the campaign to view.
 * @returns {Promise<string>} A formatted string detailing the campaign.
 */
const viewDripCampaign = async (tenantId, campaignName) => {
    try {
        const { data, error } = await dbClient
            .from('drip_campaigns')
            .select(`
                campaign_name,
                messages:drip_campaign_messages (sequence_order, delay_hours, message_body)
            `)
            .eq('tenant_id', tenantId)
            .eq('campaign_name', campaignName)
            .single();

        if (error || !data) return `Could not find a campaign named "${campaignName}".`;
        if (data.messages.length === 0) return `Campaign "${campaignName}" exists but has no messages.`;

        let report = `*Campaign Details: ${data.campaign_name}*\n\n`;
        data.messages.sort((a, b) => a.sequence_order - b.sequence_order); // Ensure correct order
        data.messages.forEach(msg => {
            report += `*#${msg.sequence_order}* (Sent ${msg.delay_hours} hours after previous step)\n`;
            report += `_"${msg.message_body}"_\n---\n`;
        });
        return report;
    } catch (e) {
        return 'Error fetching campaign details.';
    }
};

/**
 * Deletes a drip campaign and all its associated messages and subscribers.
 * @param {string} tenantId The ID of the tenant.
 * @param {string} campaignName The name of the campaign to delete.
 * @returns {Promise<string>} A confirmation or error message.
 */
const deleteDripCampaign = async (tenantId, campaignName) => {
    try {
        // We must delete from the DB by ID, not name, so we fetch it first.
        const { data: campaign, error: findError } = await dbClient
            .from('drip_campaigns')
            .select('id')
            .eq('tenant_id', tenantId)
            .eq('campaign_name', campaignName)
            .single();

        if (findError || !campaign) {
            return `Could not find a campaign named "${campaignName}" to delete.`;
        }
        // dbClient CASCADE will handle deleting related messages and subscribers.
        await dbClient.from('drip_campaigns').delete().eq('id', campaign.id);
        return `Campaign "${campaignName}" and all its data have been deleted.`;
    } catch (e) {
        return 'An error occurred while deleting the campaign.';
    }
};

/**
 * Unsubscribes a user from all active drip campaigns.
 * @param {string} endUserPhone The phone number of the user to unsubscribe.
 * @returns {Promise<void>}
 */
const unsubscribeUser = async (endUserPhone) => {
    try {
        console.log(`Processing unsubscribe request for ${endUserPhone}...`);
        const { error } = await dbClient
            .from('drip_campaign_subscribers')
            .update({ status: 'unsubscribed' })
            .eq('end_user_phone', endUserPhone)
            .eq('status', 'active');
        
        if (error) throw error;
        console.log(`User ${endUserPhone} has been unsubscribed from all active drip campaigns.`);
    } catch (error) {
        console.error(`Error unsubscribing user ${endUserPhone}:`, error.message);
    }
};


/**
 * Finds and sends the next message for all active drip campaign subscribers.
 */
const processDripCampaigns = async () => {
    try {
        const { data: subscribers, error: subError } = await dbClient
            .from('drip_campaign_subscribers')
            .select('*')
            .eq('status', 'active');

        if (subError) throw subError;
        if (!subscribers || subscribers.length === 0) return;

        console.log(`Processing ${subscribers.length} active drip campaign subscribers...`);

        for (const sub of subscribers) {
            const nextSequence = sub.current_sequence_number + 1;

            const { data: nextMessage, error: msgError } = await dbClient
                .from('drip_campaign_messages')
                .select('*')
                .eq('campaign_id', sub.campaign_id)
                .eq('sequence_order', nextSequence)
                .single();

            if (msgError || !nextMessage) {
                await dbClient.from('drip_campaign_subscribers').update({ status: 'completed' }).eq('id', sub.id);
                continue;
            }

            const referenceTime = sub.last_message_sent_at ? new Date(sub.last_message_sent_at) : new Date(sub.subscribed_at);
            const dueDate = new Date(referenceTime.getTime() + nextMessage.delay_hours * 60 * 60 * 1000);

            if (new Date() >= dueDate) {
                if (nextMessage.media_url) {
                    await sendMessageWithImage(sub.end_user_phone, nextMessage.message_body, nextMessage.media_url);
                } else {
                    await sendMessage(sub.end_user_phone, nextMessage.message_body);
                }
                console.log(`Sent drip message #${nextSequence} to ${sub.end_user_phone} for campaign ${sub.campaign_id}`);

                await dbClient
                    .from('drip_campaign_subscribers')
                    .update({
                        current_sequence_number: nextSequence,
                        last_message_sent_at: new Date().toISOString()
                    })
                    .eq('id', sub.id);
            }
        }
    } catch (error) {
        console.error('Error processing drip campaigns:', error.message);
    }
};

module.exports = {
    createDripCampaign,
    addMessageToDripCampaign,
    subscribeUsersFromSheet,
    processDripCampaigns,
    listDripCampaigns,
    viewDripCampaign,
    deleteDripCampaign,
    unsubscribeUser,
};


