/**
 * Test WhatsApp Message Sending Directly
 * 
 * This script tests if WhatsApp Web can send messages directly
 * bypassing the full webhook flow to isolate the issue.
 */

const axios = require('axios');

const TENANT_ID = '112f12b8-55e9-4de8-9fda-d58e37c75796';
const BASE_URL = 'https://salesmate.saksolution.com';

async function testWhatsAppSend() {
    console.log('🧪 Testing WhatsApp Send Capability\n');
    
    // Test 1: Check WhatsApp Web Status
    console.log('1️⃣  Checking WhatsApp Web connection...');
    try {
        const statusRes = await axios.get(
            `${BASE_URL}/api/whatsapp-web/status/${TENANT_ID}`
        );
        
        if (statusRes.data.success && statusRes.data.status === 'ready') {
            console.log('   ✅ WhatsApp Web is CONNECTED');
            console.log(`   📱 Phone: ${statusRes.data.connection.phone_number}`);
            console.log(`   🔗 Connected at: ${statusRes.data.connection.connected_at}\n`);
        } else {
            console.log('   ❌ WhatsApp Web is NOT ready');
            console.log('   Status:', statusRes.data);
            return;
        }
    } catch (error) {
        console.log('   ❌ Error checking status:', error.message);
        return;
    }
    
    // Test 2: Try sending a test message
    console.log('2️⃣  Attempting to send test message...');
    const testPhone = '919537653927@c.us'; // QK's number
    const testMessage = '🧪 Test message from diagnostic script - ' + new Date().toLocaleTimeString();
    
    try {
        // Try using the WhatsApp Web send API directly
        const sendRes = await axios.post(
            `${BASE_URL}/api/whatsapp-web/send`,
            {
                tenant_id: TENANT_ID,
                to: testPhone,
                message: testMessage
            }
        );
        
        console.log('   ✅ Message sent successfully!');
        console.log('   Response:', sendRes.data);
    } catch (error) {
        console.log('   ❌ Error sending message:', error.response?.data || error.message);
    }
    
    console.log('\n3️⃣  Testing webhook simulation...');
    
    // Test 3: Simulate incoming webhook
    const webhookPayload = {
        type: 'message',
        message: {
            from: testPhone,
            id: 'test_' + Date.now(),
            type: 'text',
            text: {
                body: 'Test message to trigger AI response'
            },
            body: 'Test message to trigger AI response',
            timestamp: Math.floor(Date.now() / 1000)
        }
    };
    
    try {
        const webhookRes = await axios.post(
            `${BASE_URL}/webhook`,
            webhookPayload,
            {
                headers: {
                    'Content-Type': 'application/json'
                }
            }
        );
        
        console.log('   ✅ Webhook processed successfully');
        console.log('   Response:', webhookRes.data);
    } catch (error) {
        console.log('   ❌ Webhook error:', error.response?.data || error.message);
    }
    
    console.log('\n📋 Next Steps:');
    console.log('   1. Check PM2 logs for processing: pm2 logs salesmate-ai');
    console.log('   2. Verify message in WhatsApp');
    console.log('   3. If no response, check if sendMessage is being called');
}

// Run the test
testWhatsAppSend()
    .then(() => {
        console.log('\n✅ Test completed');
        process.exit(0);
    })
    .catch(error => {
        console.error('\n❌ Test failed:', error);
        process.exit(1);
    });
