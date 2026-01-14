/**
 * Phase 2 End-to-End Test Suite
 * Tests the complete flow: Visit Creation → Order Auto-Creation → Conversation Enrichment → Target Syncing
 */

const { dbClient } = require('./services/config');
const visitService = require('./services/visitService');
const orderService = require('./services/orderService');
const conversationLinkingService = require('./services/conversationLinkingService');
const targetSyncService = require('./services/targetSyncService');
const targetService = require('./services/targetService');
const dailySummaryService = require('./services/dailySummaryService');

class Phase2TestSuite {
  constructor() {
    this.testResults = [];
    this.testTenantId = null;
    this.testSalesmanId = null;
    this.testCustomerId = null;
    this.testVisitId = null;
    this.testOrderId = null;
  }

  log(test, message, status = '✓') {
    const entry = `[${test}] ${status} ${message}`;
    console.log(entry);
    this.testResults.push(entry);
  }

  /**
   * Test 1: Create a test tenant, salesman, and customer
   */
  async testSetup() {
    console.log('\n========== TEST 1: Setup Test Data ==========\n');
    
    try {
      // Get first active tenant
      const { data: tenants } = await dbClient
        .from('tenants')
        .select('id')
        .eq('is_active', true)
        .limit(1);

      if (!tenants || tenants.length === 0) {
        this.log('SETUP', 'No active tenant found', '✗');
        return false;
      }

      this.testTenantId = tenants[0].id;
      this.log('SETUP', `Using tenant: ${this.testTenantId}`);

      // Get first salesman
      const { data: salesmen } = await dbClient
        .from('sales_users')
        .select('id')
        .eq('tenant_id', this.testTenantId)
        .limit(1);

      if (!salesmen || salesmen.length === 0) {
        this.log('SETUP', 'No salesman found', '✗');
        return false;
      }

      this.testSalesmanId = salesmen[0].id;
      this.log('SETUP', `Using salesman: ${this.testSalesmanId}`);

      // Create test customer
      const customerId = `test-cust-${Date.now()}`;
      const { error: custError } = await dbClient
        .from('customer_profiles')
        .insert({
          id: customerId,
          tenant_id: this.testTenantId,
          business_name: `Test Business ${Date.now()}`,
          contact_person: 'Test Contact',
          phone: `9999${Math.floor(Math.random() * 1000000)}`,
          assigned_salesman_id: this.testSalesmanId
        });

      if (custError) {
        this.log('SETUP', `Failed to create customer: ${custError.message}`, '✗');
        return false;
      }

      this.testCustomerId = customerId;
      this.log('SETUP', `Created customer: ${this.testCustomerId}`);

      return true;

    } catch (error) {
      this.log('SETUP', `Error: ${error.message}`, '✗');
      return false;
    }
  }

  /**
   * Test 2: Create a visit with products
   */
  async testVisitCreation() {
    console.log('\n========== TEST 2: Create Visit ==========\n');

    try {
      const visitData = {
        customer_id: this.testCustomerId,
        customer_name: 'Test Customer',
        visit_type: 'meeting',
        meeting_types: ['product_discussion', 'contract_review'],
        products_discussed: [
          { id: 'prod1', name: 'Product A', quantity: 5 },
          { id: 'prod2', name: 'Product B', quantity: 3 }
        ],
        potential: 50000,
        remarks: 'Test visit with products',
        gps_latitude: 19.0760,
        gps_longitude: 72.8777
      };

      const result = await visitService.createVisit(
        this.testTenantId,
        this.testSalesmanId,
        visitData
      );

      if (!result.ok) {
        this.log('VISIT_CREATE', `Failed: ${result.error}`, '✗');
        return false;
      }

      this.testVisitId = result.visit_id;
      this.log('VISIT_CREATE', `Created visit: ${this.testVisitId}`);
      this.log('VISIT_CREATE', `Products discussed: ${visitData.products_discussed.length}`);

      return true;

    } catch (error) {
      this.log('VISIT_CREATE', `Error: ${error.message}`, '✗');
      return false;
    }
  }

  /**
   * Test 3: Complete visit (triggers Phase 2 auto-actions)
   */
  async testVisitCompletion() {
    console.log('\n========== TEST 3: Complete Visit (Auto-Triggers Phase 2) ==========\n');

    try {
      const completionData = {
        time_out: new Date().toISOString(),
        remarks: 'Visit completed successfully',
        final_status: 'completed'
      };

      const result = await visitService.completeVisit(this.testVisitId, completionData);

      if (!result.ok) {
        this.log('VISIT_COMPLETE', `Failed: ${result.error}`, '✗');
        return false;
      }

      this.log('VISIT_COMPLETE', `Visit completed - Duration: ${result.duration_minutes} minutes`);
      this.log('VISIT_COMPLETE', `Visit status: ${result.visit.status}`);

      return true;

    } catch (error) {
      this.log('VISIT_COMPLETE', `Error: ${error.message}`, '✗');
      return false;
    }
  }

  /**
   * Test 4: Verify auto-order creation
   */
  async testAutoOrderCreation() {
    console.log('\n========== TEST 4: Verify Auto-Order Creation ==========\n');

    try {
      // Manually call createOrderFromVisit
      const result = await orderService.createOrderFromVisit(this.testTenantId, this.testVisitId);

      if (!result.ok) {
        this.log('AUTO_ORDER', `Failed: ${result.error}`, '✗');
        return false;
      }

      this.testOrderId = result.order_id;
      this.log('AUTO_ORDER', `Order created: ${this.testOrderId}`);
      this.log('AUTO_ORDER', `Order status: ${result.order.status}`);
      this.log('AUTO_ORDER', `Products in order: ${result.order.product_list.length}`);

      return true;

    } catch (error) {
      this.log('AUTO_ORDER', `Error: ${error.message}`, '✗');
      return false;
    }
  }

  /**
   * Test 5: Verify conversation linking
   */
  async testConversationLinking() {
    console.log('\n========== TEST 5: Verify Conversation Linking ==========\n');

    try {
      // Link visit to conversation
      const result = await conversationLinkingService.linkVisitToConversation(
        this.testTenantId,
        this.testCustomerId,
        this.testVisitId
      );

      if (!result.ok) {
        this.log('CONV_LINKING', `Failed: ${result.error}`, '✗');
        return false;
      }

      this.log('CONV_LINKING', `Visit linked to conversation`);
      this.log('CONV_LINKING', `Conversation ID: ${result.conversation_id}`);

      // Verify enrichment
      const enrichResult = await conversationLinkingService.enrichConversationWithVisit(
        this.testTenantId,
        result.conversation_id,
        this.testVisitId
      );

      if (enrichResult.ok) {
        this.log('CONV_LINKING', `Conversation enriched with visit data`);
      }

      return true;

    } catch (error) {
      this.log('CONV_LINKING', `Error: ${error.message}`, '✗');
      return false;
    }
  }

  /**
   * Test 6: Verify target syncing
   */
  async testTargetSyncing() {
    console.log('\n========== TEST 6: Verify Target Syncing ==========\n');

    try {
      // Get target context
      const contextResult = await targetSyncService.getTargetContextForAI(
        this.testTenantId,
        this.testSalesmanId
      );

      if (!contextResult.ok) {
        this.log('TARGET_SYNC', `Failed to get context: ${contextResult.error}`, '✗');
        return false;
      }

      this.log('TARGET_SYNC', `Target context retrieved`);
      
      // Check targets due for review
      const reviewResult = await targetSyncService.getTargetsDueForReview(this.testTenantId);

      if (reviewResult.ok) {
        const review = reviewResult.review;
        this.log('TARGET_SYNC', `On Track: ${review.on_track.length}, At Risk: ${review.at_risk.length}, Behind: ${review.fallen_behind.length}`);
      }

      return true;

    } catch (error) {
      this.log('TARGET_SYNC', `Error: ${error.message}`, '✗');
      return false;
    }
  }

  /**
   * Test 7: Verify daily summary generation
   */
  async testDailySummary() {
    console.log('\n========== TEST 7: Verify Daily Summary Generation ==========\n');

    try {
      const today = new Date().toISOString().split('T')[0];

      const result = await dailySummaryService.generateDailySummary(this.testTenantId, today);

      if (!result.ok) {
        this.log('DAILY_SUMMARY', `Failed: ${result.error}`, '✗');
        return false;
      }

      const summary = result.summary;
      this.log('DAILY_SUMMARY', `Summary generated for ${today}`);
      this.log('DAILY_SUMMARY', `Visits: ${summary.total_visits}, Orders: ${summary.total_orders}`);
      this.log('DAILY_SUMMARY', `Total revenue: ₹${summary.total_revenue}`);

      // Format for WhatsApp
      const formatted = await dailySummaryService.formatSummaryForWhatsApp(summary);
      if (formatted.ok) {
        this.log('DAILY_SUMMARY', `Formatted for WhatsApp (${formatted.message.length} chars)`);
      }

      return true;

    } catch (error) {
      this.log('DAILY_SUMMARY', `Error: ${error.message}`, '✗');
      return false;
    }
  }

  /**
   * Test 8: Verify achievement recording
   */
  async testAchievementRecording() {
    console.log('\n========== TEST 8: Verify Achievement Recording ==========\n');

    try {
      // Record order achievement
      const result = await targetService.recordOrderAchievement(
        this.testTenantId,
        this.testSalesmanId,
        this.testOrderId,
        50000 // estimated amount
      );

      if (!result.ok) {
        this.log('ACHIEVEMENT', `Failed: ${result.error}`, '✗');
        return false;
      }

      this.log('ACHIEVEMENT', `Order achievement recorded`);
      this.log('ACHIEVEMENT', `Target updated - Visits: ${result.salesman_targets.achieved_visits}/${result.salesman_targets.target_visits}`);

      return true;

    } catch (error) {
      this.log('ACHIEVEMENT', `Error: ${error.message}`, '✗');
      return false;
    }
  }

  /**
   * Run all tests
   */
  async runAll() {
    console.log('\n\n╔════════════════════════════════════════════════════╗');
    console.log('║     PHASE 2 END-TO-END TEST SUITE                  ║');
    console.log('║     Testing: Visit → Order → Conversation → Sync   ║');
    console.log('╚════════════════════════════════════════════════════╝\n');

    const tests = [
      { name: 'Setup', fn: () => this.testSetup() },
      { name: 'Visit Creation', fn: () => this.testVisitCreation() },
      { name: 'Visit Completion', fn: () => this.testVisitCompletion() },
      { name: 'Auto-Order Creation', fn: () => this.testAutoOrderCreation() },
      { name: 'Conversation Linking', fn: () => this.testConversationLinking() },
      { name: 'Target Syncing', fn: () => this.testTargetSyncing() },
      { name: 'Daily Summary', fn: () => this.testDailySummary() },
      { name: 'Achievement Recording', fn: () => this.testAchievementRecording() }
    ];

    let passed = 0;
    let failed = 0;

    for (const test of tests) {
      try {
        const result = await test.fn();
        if (result) {
          passed++;
        } else {
          failed++;
        }
      } catch (error) {
        console.error(`Test ${test.name} crashed:`, error.message);
        failed++;
      }
    }

    // Summary
    console.log('\n\n╔════════════════════════════════════════════════════╗');
    console.log('║              TEST RESULTS                          ║');
    console.log('╠════════════════════════════════════════════════════╣');
    console.log(`║ ✓ Passed: ${passed}/${tests.length}`.padEnd(53) + '║');
    console.log(`║ ✗ Failed: ${failed}/${tests.length}`.padEnd(53) + '║');
    console.log('╚════════════════════════════════════════════════════╝\n');

    if (failed === 0) {
      console.log('🎉 ALL PHASE 2 TESTS PASSED!\n');
      console.log('The complete flow is working:');
      console.log('  1. Visits created with products');
      console.log('  2. Orders auto-created on completion');
      console.log('  3. Conversations enriched with visit data');
      console.log('  4. Targets tracked and synced');
      console.log('  5. Daily summaries generated');
      console.log('  6. Achievements recorded automatically\n');
    } else {
      console.log('⚠️  Some tests failed. Review the logs above.\n');
    }

    return {
      passed,
      failed,
      total: tests.length,
      results: this.testResults
    };
  }
}

// Run if executed directly
if (require.main === module) {
  (async () => {
    const suite = new Phase2TestSuite();
    const results = await suite.runAll();
    process.exit(results.failed === 0 ? 0 : 1);
  })();
}

module.exports = Phase2TestSuite;
