const { dbClient } = require('../../../services/config');
const { generateResponse } = require('../../../services/ai/responseGenerator');
const { sendMessage } = require('../../../services/whatsappService');

async function createDynamicAIPrompt(userQuery, userLanguage, tenantId, conversation) {
  // Not needed - using responseGenerator instead
  return null;
}

/**
 * Generate intelligent AI response with full customer context
 */
async function getFallbackAIResponse(tenant, userQuery, userLanguage, conversation, dbClient, sendAndLogMessage, res) {
  try {
    console.log('[AI_FALLBACK] Generating intelligent response for:', userQuery);
    
    const phoneNumber = conversation?.end_user_phone || conversation?.phone;
    
    if (!phoneNumber) {
      console.error('[AI_FALLBACK] No phone number found');
      throw new Error('Phone number missing');
    }
    
    // Get customer profile
    const { data: customerProfile } = await dbClient
      .from('customer_profiles')
      .select('id, first_name')
      .eq('phone', phoneNumber)
      .eq('tenant_id', tenant.id)
      .single();
    
    if (!customerProfile) {
      // New customer - simple greeting
      const greeting = `Hello! How can I help you today?`;
      await sendAndLogMessage(phoneNumber, greeting, tenant.id, 'simple_greeting');
      return res.status(200).json({ ok: true, type: 'simple_greeting' });
    }
    
    try {
      // Generate smart AI response with full context
      const aiResponse = await generateResponse(
        customerProfile.id,
        conversation.id,
        userQuery,
        {
          tenantId: tenant.id,
          businessName: tenant.business_name || 'SAK Solutions',
          tone: 'friendly',
          language: userLanguage
        }
      );
      
      console.log('[AI_FALLBACK] Smart response generated, cost: $' + aiResponse.cost.toFixed(4));
      
      await sendAndLogMessage(phoneNumber, aiResponse.response, tenant.id, 'smart_ai_response');
      return res.status(200).json({ 
        ok: true, 
        type: 'smart_ai_response',
        cost: aiResponse.cost,
        tokens: aiResponse.tokensUsed
      });
      
    } catch (aiError) {
      console.error('[AI_FALLBACK] AI generation failed:', aiError.message);
      
      // Fallback to personalized simple greeting
      const greeting = `Hey ${customerProfile.first_name || 'there'}! How can I help you?`;
      await sendAndLogMessage(phoneNumber, greeting, tenant.id, 'simple_fallback');
      return res.status(200).json({ ok: true, type: 'simple_fallback' });
    }
    
  } catch (error) {
    console.error('[AI_FALLBACK] Error:', error.message);
    
    // Last resort - generic greeting
    const greeting = `Hello! How can I help you?`;
    await sendMessage(phoneNumber, greeting);
    return res.status(200).json({ ok: true, type: 'generic_fallback' });
  }
}

module.exports = {
  createDynamicAIPrompt,
  getFallbackAIResponse
};
