/**
 * Test WhatsApp AI API
 * Tests smart replies, broadcast campaigns, conversation tracking
 */

const BASE_URL = 'http://localhost:8055';
const TENANT_ID = 'default-tenant';

async function testWhatsAppAI() {
  console.log('🧪 Testing WhatsApp AI API\n');
  
  try {
    // Test 1: Start AI Conversation Session
    console.log('1️⃣ Starting AI Conversation Session...');
    const session = await fetch(`${BASE_URL}/api/whatsapp-ai/sessions/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tenant_id: TENANT_ID,
        customerId: 'customer-123',
        phoneNumber: '+919876543210',
        language: 'en',
        channel: 'whatsapp'
      })
    });
    const sessionData = await session.json();
    console.log('✅ Session started:', sessionData.session?.id);
    const sessionId = sessionData.session?.id;
    
    // Test 2: Analyze Incoming Message
    console.log('\n2️⃣ Analyzing Customer Message...');
    const analysis = await fetch(`${BASE_URL}/api/whatsapp-ai/messages/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message_text: 'Hi, what is the price of product ABC-123? I need 50 pieces urgently.'
      })
    });
    const analysisData = await analysis.json();
    console.log('✅ Message analyzed:');
    console.log('   Intent:', analysisData.analysis?.intent);
    console.log('   Entities:', analysisData.analysis?.entities);
    console.log('   Sentiment:', analysisData.analysis?.sentimentScore);
    console.log('   Urgency:', analysisData.analysis?.urgencyLevel);
    
    // Test 3: Log Message
    console.log('\n3️⃣ Logging Message...');
    const messageLog = await fetch(`${BASE_URL}/api/whatsapp-ai/messages/log`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tenant_id: TENANT_ID,
        session_id: sessionId,
        messageDirection: 'incoming',
        messageType: 'text',
        messageContent: 'Hi, what is the price of product ABC-123?',
        detectedIntent: analysisData.analysis?.intent,
        detectedEntities: analysisData.analysis?.entities,
        sentimentScore: analysisData.analysis?.sentimentScore,
        urgencyLevel: analysisData.analysis?.urgencyLevel
      })
    });
    const messageData = await messageLog.json();
    console.log('✅ Message logged:', messageData.message?.id);
    
    // Test 4: Set Conversation Context
    console.log('\n4️⃣ Setting Conversation Context...');
    const context = await fetch(`${BASE_URL}/api/whatsapp-ai/context/set`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tenant_id: TENANT_ID,
        session_id: sessionId,
        context_key: 'inquired_product',
        context_value: 'ABC-123',
        expires_in_minutes: 30
      })
    });
    const contextData = await context.json();
    console.log('✅ Context set:', contextData.context?.contextKey);
    
    // Test 5: Create Smart Reply Templates
    console.log('\n5️⃣ Creating Smart Reply Templates...');
    const smartReply1 = await fetch(`${BASE_URL}/api/whatsapp-ai/smart-replies`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tenant_id: TENANT_ID,
        templateName: 'Pricing Response',
        templateCategory: 'pricing',
        intentTriggers: ['pricing_inquiry'],
        replyText: 'The price for {{product_name}} is ₹{{price}} per unit. For {{quantity}} pieces, total would be ₹{{total}}.',
        replyVariants: [
          'Our rate for {{product_name}} is ₹{{price}}.',
          '{{product_name}} costs ₹{{price}} each.'
        ],
        priority: 80,
        createdBy: 'admin'
      })
    });
    const reply1Data = await smartReply1.json();
    console.log('✅ Smart reply created:', reply1Data.reply?.templateName);
    
    const smartReply2 = await fetch(`${BASE_URL}/api/whatsapp-ai/smart-replies`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tenant_id: TENANT_ID,
        templateName: 'Greeting',
        templateCategory: 'greeting',
        intentTriggers: ['greeting'],
        replyText: 'Hello! Welcome to SakSolution. How can I assist you today?',
        replyVariants: [
          'Hi! Thanks for reaching out. What can I help you with?',
          'Hello! Great to hear from you. How may I help?'
        ],
        priority: 90,
        createdBy: 'admin'
      })
    });
    const reply2Data = await smartReply2.json();
    console.log('✅ Smart reply created:', reply2Data.reply?.templateName);
    
    // Test 6: Get Reply Suggestions
    console.log('\n6️⃣ Getting Smart Reply Suggestions...');
    const suggestions = await fetch(`${BASE_URL}/api/whatsapp-ai/smart-replies/suggest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tenant_id: TENANT_ID,
        intent: 'pricing_inquiry',
        sentiment: 'neutral'
      })
    });
    const suggestionsData = await suggestions.json();
    console.log('✅ Suggestions:', suggestionsData.suggestions?.length || 0);
    suggestionsData.suggestions?.forEach(s => {
      console.log(`   - ${s.category}: ${s.text.substring(0, 50)}...`);
    });
    
    // Test 7: Create Broadcast Campaign
    console.log('\n7️⃣ Creating Broadcast Campaign...');
    const campaign = await fetch(`${BASE_URL}/api/whatsapp-ai/campaigns`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tenant_id: TENANT_ID,
        campaignName: 'New Year Special Offer',
        campaignType: 'promotional',
        targetSegment: 'active_customers',
        messageTemplate: 'Hi {{customer_name}}, enjoy 20% off on all products! Valid till Jan 31. Order now!',
        messageVariables: { discount: '20%', validity: 'Jan 31' },
        aiOptimizationEnabled: true,
        createdBy: 'admin'
      })
    });
    const campaignData = await campaign.json();
    console.log('✅ Campaign created:', campaignData.campaign?.id);
    const campaignId = campaignData.campaign?.id;
    
    // Test 8: Add Campaign Recipients
    console.log('\n8️⃣ Adding Campaign Recipients...');
    const recipients = await fetch(`${BASE_URL}/api/whatsapp-ai/campaigns/${campaignId}/recipients`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tenant_id: TENANT_ID,
        recipients: [
          { customer_id: 'cust-1', phone_number: '+919876543210', customer_name: 'John Doe' },
          { customer_id: 'cust-2', phone_number: '+919876543211', customer_name: 'Jane Smith' },
          { customer_id: 'cust-3', phone_number: '+919876543212', customer_name: 'Bob Johnson' }
        ]
      })
    });
    const recipientsData = await recipients.json();
    console.log('✅ Recipients added:', recipientsData.result?.recipientsAdded);
    
    // Test 9: Update Session Context
    console.log('\n9️⃣ Updating Session Context...');
    const sessionUpdate = await fetch(`${BASE_URL}/api/whatsapp-ai/sessions/${sessionId}/context`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        currentIntent: 'pricing_inquiry',
        currentTopic: 'product',
        conversationStage: 'discovery',
        customerSentiment: 'positive',
        aiConfidenceScore: 0.85
      })
    });
    await sessionUpdate.json();
    console.log('✅ Session context updated');
    
    // Test 10: Create Message Template
    console.log('\n🔟 Creating Message Template...');
    const template = await fetch(`${BASE_URL}/api/whatsapp-ai/templates`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tenant_id: TENANT_ID,
        templateName: 'Order Confirmation',
        templateCategory: 'transactional',
        templateText: 'Your order {{order_id}} has been confirmed. Total: ₹{{amount}}. Delivery by {{delivery_date}}.',
        hasVariables: true,
        variableList: [
          { name: 'order_id', type: 'string', required: true },
          { name: 'amount', type: 'number', required: true },
          { name: 'delivery_date', type: 'date', required: true }
        ],
        createdBy: 'admin'
      })
    });
    const templateData = await template.json();
    console.log('✅ Template created:', templateData.template?.templateName);
    
    // Test 11: List Smart Replies
    console.log('\n1️⃣1️⃣ Listing Smart Replies...');
    const repliesList = await fetch(`${BASE_URL}/api/whatsapp-ai/smart-replies?tenant_id=${TENANT_ID}`);
    const repliesData = await repliesList.json();
    console.log('✅ Found', repliesData.replies?.length || 0, 'smart replies');
    
    // Test 12: Get Conversation Analytics
    console.log('\n1️⃣2️⃣ Getting Conversation Analytics...');
    const analytics = await fetch(`${BASE_URL}/api/whatsapp-ai/analytics/conversations?tenant_id=${TENANT_ID}`);
    const analyticsData = await analytics.json();
    console.log('✅ Analytics retrieved:');
    console.log('   Sessions:', analyticsData.analytics?.sessionStats?.total_sessions || 0);
    console.log('   Intents:', analyticsData.analytics?.intentDistribution?.length || 0);
    
    console.log('\n✨ All WhatsApp AI tests completed successfully!');
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.error(error.stack);
  }
}

testWhatsAppAI();
