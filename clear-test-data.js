/**
 * Clear all test data from CRM, customers, and conversations
 * Use this to reset the system for fresh testing
 */

// Force Supabase mode
process.env.USE_SUPABASE = 'true';

const { dbClient } = require('./services/config');

const TENANT_ID = '112f12b8-55e9-4de8-9fda-d58e37c75796';

async function clearAllData() {
    console.log('🧹 Clearing all test data for tenant:', TENANT_ID);
    console.log('========================================');
    
    try {
        // 1. Clear CRM triage items
        console.log('\n1️⃣ Clearing CRM triage items...');
        const { error: triageError, count: triageCount } = await dbClient
            .from('crm_triage_items')
            .delete()
            .eq('tenant_id', TENANT_ID);
        
        if (triageError) {
            console.error('❌ Triage clear error:', triageError.message);
        } else {
            console.log('✅ Triage items cleared');
        }

        // 2. Clear CRM lead events
        console.log('\n2️⃣ Clearing CRM lead events...');
        const { error: eventsError } = await dbClient
            .from('crm_lead_events')
            .delete()
            .eq('tenant_id', TENANT_ID);
        
        if (eventsError) {
            console.error('❌ Lead events clear error:', eventsError.message);
        } else {
            console.log('✅ Lead events cleared');
        }

        // 3. Clear CRM messages
        console.log('\n3️⃣ Clearing CRM messages...');
        const { error: messagesError } = await dbClient
            .from('crm_messages')
            .delete()
            .eq('tenant_id', TENANT_ID);
        
        if (messagesError) {
            console.error('❌ CRM messages clear error:', messagesError.message);
        } else {
            console.log('✅ CRM messages cleared');
        }

        // 4. Clear CRM leads
        console.log('\n4️⃣ Clearing CRM leads...');
        const { error: leadsError } = await dbClient
            .from('crm_leads')
            .delete()
            .eq('tenant_id', TENANT_ID);
        
        if (leadsError) {
            console.error('❌ CRM leads clear error:', leadsError.message);
        } else {
            console.log('✅ CRM leads cleared');
        }

        // 5. Clear customer profiles
        console.log('\n5️⃣ Clearing customer profiles...');
        const { error: customersError } = await dbClient
            .from('customer_profiles_new')
            .delete()
            .eq('tenant_id', TENANT_ID);
        
        if (customersError) {
            console.error('❌ Customer profiles clear error:', customersError.message);
        } else {
            console.log('✅ Customer profiles cleared');
        }

        // 6. Clear legacy conversations_new
        console.log('\n6️⃣ Clearing legacy conversations...');
        const { error: convError } = await dbClient
            .from('conversations_new')
            .delete()
            .eq('tenant_id', TENANT_ID);
        
        if (convError) {
            console.error('❌ Conversations clear error:', convError.message);
        } else {
            console.log('✅ Legacy conversations cleared');
        }

        // 7. Clear legacy messages
        console.log('\n7️⃣ Clearing legacy messages...');
        const { error: legacyMsgError } = await dbClient
            .from('messages')
            .delete()
            .eq('tenant_id', TENANT_ID);
        
        if (legacyMsgError) {
            console.error('❌ Legacy messages clear error:', legacyMsgError.message);
        } else {
            console.log('✅ Legacy messages cleared');
        }

        console.log('\n========================================');
        console.log('✅ All test data cleared successfully!');
        console.log('\nYou can now send a fresh WhatsApp message to test.');
        console.log('========================================\n');

    } catch (error) {
        console.error('\n❌ Clear operation failed:', error.message);
        console.error(error);
    }
}

// Run the clear operation
clearAllData()
    .then(() => {
        console.log('Done!');
        process.exit(0);
    })
    .catch(err => {
        console.error('Fatal error:', err);
        process.exit(1);
    });
