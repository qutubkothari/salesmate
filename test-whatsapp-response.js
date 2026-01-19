/**
 * WhatsApp Response Diagnostic Test
 * Tests if WhatsApp webhook is properly sending responses
 */

const axios = require('axios');

const BASE_URL = 'https://salesmate.saksolution.com';

async function testWhatsAppResponse() {
    console.log('🧪 Testing WhatsApp Response System...\n');
    
    // Test 1: Simple text message webhook
    console.log('TEST 1: Sending test webhook message');
    try {
        const webhookPayload = {
            type: 'message',
            message: {
                from: '919537653927@c.us',
                id: `test_${Date.now()}`,
                timestamp: Date.now(),
                type: 'text',
                text: {
                    body: 'Hello'
                },
                body: 'Hello'
            }
        };
        
        console.log('Payload:', JSON.stringify(webhookPayload, null, 2));
        
        const response = await axios.post(`${BASE_URL}/webhook`, webhookPayload, {
            headers: { 'Content-Type': 'application/json' },
            validateStatus: () => true
        });
        
        console.log('✓ Response Status:', response.status);
        console.log('✓ Response Data:', JSON.stringify(response.data, null, 2));
        
        if (response.data.ok) {
            console.log('✅ Webhook processed successfully');
        } else {
            console.log('❌ Webhook processing failed:', response.data.error);
        }
    } catch (error) {
        console.log('❌ Test failed:', error.message);
        if (error.response) {
            console.log('Response:', error.response.data);
        }
    }
    
    // Test 2: Check PM2 logs
    console.log('\n\nTEST 2: Checking server configuration');
    console.log('Check these on production:');
    console.log('1. PM2 status: pm2 status salesmate-ai');
    console.log('2. PM2 logs: pm2 logs salesmate-ai --lines 50');
    console.log('3. Check env variables:');
    console.log('   - MAYTAPI_PRODUCT_ID');
    console.log('   - MAYTAPI_PHONE_ID');
    console.log('   - MAYTAPI_API_KEY');
    console.log('   - WHATSAPP_PROVIDER_MODE');
    
    console.log('\n\nDIAGNOSTIC CHECKLIST:');
    console.log('□ Is PM2 process running?');
    console.log('□ Are there any errors in PM2 logs?');
    console.log('□ Is MAYTAPI configured correctly?');
    console.log('□ Is WhatsApp Web connected (if using)?');
    console.log('□ Are messages being received in webhook?');
    console.log('□ Is AI generating responses?');
    console.log('□ Is sendMessage function being called?');
    console.log('□ Is MAYTAPI API returning success?');
}

testWhatsAppResponse().catch(console.error);
