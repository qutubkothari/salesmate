require('dotenv').config();
const { recognizeIntent } = require('./services/intentRecognitionService');

(async () => {
  console.log('=== SIMULATING DISCOUNT MESSAGE FLOW ===\n');

  // Test 1: Check if "discount?" is recognized as DISCOUNT_REQUEST
  const message = 'discount?';
  console.log('User message:', message);

  try {
    const intentResult = await recognizeIntent(message, {
      hasCart: true,
      conversationState: 'multi_product_order_discussion'
    });

    console.log('\n✅ Intent Recognition Result:');
    console.log('   Intent:', intentResult.intent);
    console.log('   Confidence:', intentResult.confidence);
    console.log('   Reasoning:', intentResult.reasoning);

    // Test 2: Check if it matches discount handler condition
    const isDiscountIntent = intentResult?.intent === 'DISCOUNT_REQUEST' ||
                           (intentResult?.confidence > 0.85 &&
                            ['discount_request', 'negotiation'].includes(intentResult?.intent?.toLowerCase()));

    console.log('\n✅ Discount Handler Check:');
    console.log('   Would handle:', isDiscountIntent);

    if (!isDiscountIntent) {
      console.log('\n❌ PROBLEM: Intent not recognized as discount request!');
      console.log('   The discount handler will return null');
      console.log('   Request will fall through to smart response handler');
    } else {
      console.log('\n✅ Discount handler will process this request');
    }

  } catch (error) {
    console.error('\n❌ Error during intent recognition:', error.message);
    console.error(error);
  }
})();
