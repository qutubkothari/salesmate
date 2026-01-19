/**
 * Send WhatsApp Reply Manually
 * Bot: 918484830021
 * Customer: 919537653927
 */

const axios = require('axios');

const BASE_URL = 'https://salesmate.saksolution.com';

async function sendReply() {
    try {
        // Use WAHA endpoint with correct fields
        console.log('Sending WhatsApp reply via WAHA...');
        
        const response = await axios.post(`${BASE_URL}/api/waha/send-message`, {
            sessionName: 'default',
            phone: '919537653927',
            message: 'Hello! 👋 This is an automated reply from Salesmate AI.\n\nI received your message "Hi".\n\nHow can I help you today?\n\n✅ Phase 1 & 2 features are now live!\n✅ 297 visits available\n✅ All systems operational'
        });
        
        console.log('✓ Reply sent successfully!');
        console.log('Response:', JSON.stringify(response.data, null, 2));
        
    } catch (error) {
        console.error('✗ Failed to send:', error.response?.data || error.message);
        console.error('Status:', error.response?.status);
    }
}

sendReply();
