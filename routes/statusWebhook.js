/**
 * @title Maytapi Status Webhook
 * @description This webhook receives delivery status updates from Maytapi for sent messages
 * and updates the corresponding record in the database.
 */
const express = require('express');
const { supabase } = require('../services/config');
const router = express.Router();
const { validate, z, zTrimmedString } = require('../middleware/validate');

const statusUpdateSchema = z
    .object({
        id: zTrimmedString(1, 128),
        status: zTrimmedString(1, 64),
    })
    .strict();

// This is the endpoint Maytapi will call to update the status of a message.
// You need to configure this URL (e.g., https://your-app-url.com/status/update) in your Maytapi dashboard.
router.post('/update', validate({ body: statusUpdateSchema }), async (req, res) => {
    const statusUpdate = req.body;

    // Log the entire incoming payload for debugging
    console.log('Received status update:', JSON.stringify(statusUpdate, null, 2));

    // Basic validation to ensure we have the necessary data
    if (!statusUpdate || !statusUpdate.id || !statusUpdate.status) {
        console.warn('Invalid or incomplete status update payload received.');
        return res.status(400).send('Invalid payload');
    }

    const messageId = statusUpdate.id;
    const newStatus = statusUpdate.status; // e.g., 'sent', 'delivered', 'read', 'failed'

    try {
        const { data, error } = await supabase
            .from('bulk_schedules')
            .update({ delivery_status: newStatus })
            .eq('message_id', messageId)
            .select(); // .select() returns the updated row

        if (error) {
            console.error('Error updating message status in database:', error.message);
            // Don't send 500 to Maytapi, as it may cause repeated retries.
            // A 404 is appropriate if we couldn't find the message.
            return res.status(404).send('Message ID not found');
        }

        if (data && data.length > 0) {
            console.log(`Successfully updated message ${messageId} to status: ${newStatus}`);
        } else {
            // This can happen if the message ID from Maytapi doesn't match any in our DB.
            console.warn(`Could not find a message with ID ${messageId} to update.`);
        }

        // Always respond with 200 OK to Maytapi to acknowledge receipt of the webhook.
        res.status(200).send('Status update received');

    } catch (error) {
        console.error('Unexpected error in status webhook:', error);
        res.status(500).send('Internal Server Error');
    }
});

module.exports = router;
