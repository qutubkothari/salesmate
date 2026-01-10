
const { dbClient } = require('../config');

class MemoryManager {
  /**
   * Save conversation with correct column names
   */
  async saveConversation(phoneNumber, tenantId, messages, context, lastIntent) {
    try {
      console.log(`[Memory] Saving conversation for ${phoneNumber}`);
      const conversationData = {
        phone_number: phoneNumber,
        end_user_phone: phoneNumber,  // âœ… CORRECT for conversations table
        tenant_id: tenantId,
        context_data: context,  // Use context_data not context
        last_message_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
      if (lastIntent) {
        conversationData.last_intent = lastIntent;
      }
      // Use upsert with correct conflict columns
      const { data, error } = await dbClient
        .from('conversations')
        .upsert(conversationData, {
          onConflict: 'tenant_id,end_user_phone',  // Match your UNIQUE constraint
          ignoreDuplicates: false
        })
        .select()
        .single();
      if (error) {
        console.error('[Memory] Error saving conversation:', error);
        return null;
      }
      console.log(`[Memory] âœ… Saved conversation: ${data.id}`);
      return data;
    } catch (error) {
      console.error('[Memory] Exception saving conversation:', error);
      return null;
    }
  }

  /**
   * Get conversation with correct column names
   */
  async getConversation(phoneNumber, tenantId) {
    try {
      console.log(`[Memory] Fetching conversation for ${phoneNumber}`);
      const { data, error } = await dbClient
        .from('conversations')
        .select('*')
        .eq('end_user_phone', phoneNumber)  // âœ… CORRECT column name
        .eq('tenant_id', tenantId)
        .maybeSingle();
      if (error) {
        console.error('[Memory] Error fetching conversation:', error);
        return { messages: [], context: {}, lastIntent: null };
      }
      if (!data) {
        console.log('[Memory] No conversation found, returning empty');
        return { messages: [], context: {}, lastIntent: null };
      }
      console.log(`[Memory] âœ… Found conversation: ${data.id}`);
      return {
        id: data.id,
        messages: [], // Messages stored elsewhere in your system
        context: data.context_data || {},
        lastIntent: data.last_intent,
        lastMessageAt: data.last_message_at,
        customerProfileId: data.customer_profile_id
      };
    } catch (error) {
      console.error('[Memory] Exception getting conversation:', error);
      return { messages: [], context: {}, lastIntent: null };
    }
  }

  /**
   * Link conversation to customer profile
   */
  async linkCustomerProfile(phoneNumber, tenantId, customerProfileId) {
    try {
      const { error } = await dbClient
        .from('conversations')
        .update({ customer_profile_id: customerProfileId })
        .eq('end_user_phone', phoneNumber)
        .eq('tenant_id', tenantId);
      if (error) {
        console.error('[Memory] Error linking customer profile:', error);
      } else {
        console.log(`[Memory] âœ… Linked customer profile ${customerProfileId}`);
      }
    } catch (error) {
      console.error('[Memory] Exception linking customer:', error);
    }
  }
}

module.exports = new MemoryManager();

