// Test Zoho Books connection after subscription upgrade
// Run: node test_zoho_connection.js

const zohoAuth = require('./services/zohoTenantAuthService');

const TENANT_ID = 'a10aa26a-b5f9-4afe-87cc-70bfb4d1f6e6'; // SAK Solutions Store

async function testZohoConnection() {
    console.log('='.repeat(60));
    console.log('ZOHO BOOKS CONNECTION TEST');
    console.log('='.repeat(60));
    console.log('Tenant ID:', TENANT_ID);
    console.log('Testing connection...\n');

    try {
        
        // Test 1: Check authorization status
        console.log('[Test 1] Checking authorization status...');
        const authStatus = await zohoAuth.getAuthorizationStatus(TENANT_ID);
        console.log('Authorization Status:', JSON.stringify(authStatus, null, 2));
        console.log('');

        if (!authStatus.authorized) {
            console.log('❌ Zoho not authorized for this tenant');
            console.log('Please complete Zoho authorization first');
            return;
        }

        // Test 2: Test API connection
        console.log('[Test 2] Testing API connection...');
        const connectionTest = await zohoAuth.testConnection(TENANT_ID);
        console.log('Connection Test Result:', JSON.stringify(connectionTest, null, 2));
        console.log('');

        if (connectionTest.success) {
            console.log('✅ ZOHO CONNECTION SUCCESSFUL!');
            console.log(`✅ Organization: ${connectionTest.organizationName}`);
            console.log('✅ Trial issue appears to be resolved');
        } else {
            console.log('❌ ZOHO CONNECTION FAILED');
            console.log('Error:', connectionTest.error);
            
            // Check for trial expiration error
            if (connectionTest.error && connectionTest.error.includes('103001')) {
                console.log('\n⚠️  Trial still expired (Error 103001)');
                console.log('Please verify Zoho Books subscription is active');
            }
        }

        console.log('\n' + '='.repeat(60));

    } catch (error) {
        console.error('❌ Test failed with error:', error.message);
        console.error('Stack:', error.stack);
    }
}

// Run the test
testZohoConnection()
    .then(() => {
        console.log('\nTest completed');
        process.exit(0);
    })
    .catch((error) => {
        console.error('Fatal error:', error);
        process.exit(1);
    });
