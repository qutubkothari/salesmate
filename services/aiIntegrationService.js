const { contextBuilder, responseGenerator, intentClassifier, memoryManager } = require('./ai');
const { dbClient } = require('../services/config');

class AIIntegrationService {
  constructor() {
    this.enableAI = process.env.AI_DISABLED !== 'true';
    this.costTracker = {
      dailyCalls: 0,
      dailyCost: 0,
      lastReset: new Date().toDateString()
    };
  }

  async processMessage(phoneNumber, message, tenantId, options = {}) {
    try {
      const customerProfile = await this.getCustomerProfile(phoneNumber, tenantId);
      const conversation = await this.getOrCreateConversation(customerProfile.id, tenantId, phoneNumber);
      if (!this.checkCostLimits()) {
        console.warn('⚠️ AI cost limit reached, falling back to rules');
        return { action: 'use_rules', intent: 'general_inquiry', useFallback: true };
      }
      const classification = await intentClassifier.hybridClassify(
        message,
        { previousIntent: conversation.last_intent },
        { useAI: options.forceAI !== false } // Enable AI by default, disable only if explicitly set to false
      );
      console.log(`🎯 Intent: ${classification.intent} (${(classification.confidence * 100).toFixed(0)}% confidence, method: ${classification.method})`);
      await this.updateConversationIntent(conversation.id, classification.intent);
      const routing = intentClassifier.determineRouting(classification);
      if (routing.useHuman) {
        return { action: 'transfer_to_human', intent: classification.intent, confidence: classification.confidence, reason: 'Customer requested human or complaint detected' };
      }
      if (routing.useRules && !options.forceAI) {
        return { action: 'use_rules', intent: classification.intent, confidence: classification.confidence, routing };
      }
      if (routing.useAI || options.forceAI) {
        // Always pass context as an object, not a string
        const context = {};
        const response = await this.generateAIResponse(
          message,
          context,
          tenantId,
          options
        );
        this.trackCost(response.cost);
        return { action: 'ai_response', response: response.response, intent: classification.intent, confidence: classification.confidence, cost: response.cost };
      }
      return { action: 'use_rules', intent: classification.intent, confidence: classification.confidence };
    } catch (error) {
      console.error('Error in AI processing:', error);
      return { action: 'use_rules', intent: 'general_inquiry', error: error.message };
    }
  }

  async generateAIResponse(message, context = {}, tenantId, options = {}) {
    try {
      const OpenAI = require('openai');
      const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
      const { dbClient } = require('../services/config');
      // Fetch tenant if not in context
      if (!context.tenant) {
        const { data: tenant } = await dbClient
          .from('tenants')
          .select('business_name, auto_reply_message')
          .eq('id', tenantId)
          .single();
        context.tenant = tenant;
      }
      const messages = [
        {
          role: 'system',
          content: context.tenant?.auto_reply_message || `You are a helpful sales assistant for ${context.tenant?.business_name || 'our company'}. Be professional and concise.`
        },
        { role: 'user', content: message }
      ];
      const response = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages,
        max_tokens: 300
      });
      const cost = (response.usage.total_tokens / 1000000) * 0.25;
      return { response: response.choices[0].message.content, tokensUsed: response.usage.total_tokens, cost };
    } catch (error) {
      console.error('Error generating AI response:', error);
      throw error;
    }
  }

  async checkOrderAnomalies(customerProfileId, orderItems) {
    try {
      const context = await contextBuilder.buildLightweightContext(customerProfileId);
      const affinity = await this.getProductAffinity(customerProfileId);
      const currentProductCodes = orderItems.map(item => item.code || item.product_code);
      const missingProducts = affinity.filter(product => product.is_regular_product && !currentProductCodes.includes(product.code));
      const quantityAnomalies = [];
      for (const item of orderItems) {
        const regularProduct = affinity.find(p => p.code === item.code);
        if (regularProduct && item.quantity < regularProduct.avg_quantity * 0.5) {
          quantityAnomalies.push({ product: regularProduct.name, expected: regularProduct.avg_quantity, actual: item.quantity });
        }
      }
      let suggestions = null;
      if (missingProducts.length > 0 || quantityAnomalies.length > 0) {
        suggestions = await responseGenerator.generateProductSuggestion(customerProfileId, orderItems, { affinity });
      }
      return { hasAnomalies: missingProducts.length > 0 || quantityAnomalies.length > 0, missingProducts, quantityAnomalies, suggestions: suggestions?.suggestion || null };
    } catch (error) {
      console.error('Error checking order anomalies:', error);
      return { hasAnomalies: false };
    }
  }

  async generateFollowUpMessage(customerProfileId) {
    try {
      const context = await contextBuilder.buildLightweightContext(customerProfileId);
      if (!context.patterns || context.patterns.days_overdue <= 0) {
        return null;
      }
      const anomaly = { type: 'overdue_order', days_overdue: context.patterns.days_overdue };
      const message = await responseGenerator.generateAnomalyResponse(anomaly, context);
      return message;
    } catch (error) {
      console.error('Error generating follow-up:', error);
      return null;
    }
  }

  /**
   * Get customer profile - FIXED for correct column names
   */
  async getCustomerProfile(phoneNumber, tenantId) {
    try {
      console.log(`[AI] Fetching customer: ${phoneNumber}, tenant: ${tenantId}`);
      const { data, error } = await dbClient
        .from('customer_profiles_new')
        .select('*')
        .eq('phone', phoneNumber) // customer_profiles uses 'phone'
        .eq('tenant_id', tenantId)
        .maybeSingle();

      if (error) {
        console.error('[AI] Error fetching customer:', error);
        return this.createMockProfile(phoneNumber, tenantId);
      }

      if (!data) {
        console.log('[AI] Customer not found, returning mock profile');
        return this.createMockProfile(phoneNumber, tenantId);
      }

      console.log(`[AI] Customer found: ${data.first_name} ${data.last_name}`);

      return {
        id: data.id,
        phone: data.phone,
        name: `${data.first_name || ''} ${data.last_name || ''}`.trim() || data.phone,
        first_name: data.first_name,
        last_name: data.last_name,
        company: data.company,
        email: data.email,
        customer_tier: data.customer_tier || 'standard',
        total_spent: parseFloat(data.total_spent || 0),
        total_orders: data.total_orders || 0,
        last_order_date: data.last_order_date,
        last_contact_date: data.last_contact_date,
        preferred_products: data.preferred_products,
        tenant_id: data.tenant_id,
        created_at: data.created_at,
        lifetime_value: parseFloat(data.total_spent || 0),
        is_vip: parseFloat(data.total_spent || 0) >= 100000,
        business_name: data.company
      };
    } catch (error) {
      console.error('[AI] Exception in getCustomerProfile:', error);
      return this.createMockProfile(phoneNumber, tenantId);
    }
  }

  createMockProfile(phoneNumber, tenantId) {
    return {
      id: null,
      phone: phoneNumber,
      tenant_id: tenantId,
      name: phoneNumber,
      first_name: phoneNumber,
      customer_tier: 'standard',
      total_spent: 0,
      total_orders: 0,
      lifetime_value: 0,
      is_vip: false
    };
  }

  async getOrCreateConversation(customerProfileId, tenantId, phoneNumber) {
    try {
      // First, try to find by customer_profile_id
      const { data: existing } = await dbClient
        .from('conversations_new')
        .select('*')
        .eq('customer_profile_id', customerProfileId)
        .eq('tenant_id', tenantId)
        .eq('status', 'active')
        .maybeSingle();
      
      if (existing) {
        return existing;
      }
      
      // Also check by phone number (in case profile was linked later)
      const { data: existingByPhone } = await dbClient
        .from('conversations_new')
        .select('*')
        .eq('end_user_phone', phoneNumber)
        .eq('tenant_id', tenantId)
        .eq('status', 'active')
        .maybeSingle();
      
      if (existingByPhone) {
        // Link customer profile if not already linked
        if (!existingByPhone.customer_profile_id && customerProfileId) {
          await dbClient
            .from('conversations_new')
            .update({ customer_profile_id: customerProfileId })
            .eq('id', existingByPhone.id);
          existingByPhone.customer_profile_id = customerProfileId;
        }
        return existingByPhone;
      }
      
      // Create new conversation
      const { data: newConv, error: createError } = await dbClient
        .from('conversations_new')
        .insert([{ 
          customer_profile_id: customerProfileId, 
          tenant_id: tenantId,
          phone_number: phoneNumber,
          end_user_phone: phoneNumber,
          status: 'active', 
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        }])
        .select()
        .single();
      
      if (createError) {
        // If duplicate key error, fetch the existing one
        if (createError.code === '23505') {
          const { data: existing } = await dbClient
            .from('conversations_new')
            .select('*')
            .eq('end_user_phone', phoneNumber)
            .eq('tenant_id', tenantId)
            .single();
          return existing || { 
            id: `conv_${customerProfileId}`, 
            customer_profile_id: customerProfileId, 
            tenant_id: tenantId, 
            end_user_phone: phoneNumber,
            last_intent: null 
          };
        }
        
        console.error('Error creating conversation:', createError);
        return { 
          id: `conv_${customerProfileId}`, 
          customer_profile_id: customerProfileId, 
          tenant_id: tenantId, 
          end_user_phone: phoneNumber,
          last_intent: null 
        };
      }
      
      return newConv;
    } catch (error) {
      console.error('Error in getOrCreateConversation:', error);
      return { 
        id: `conv_${customerProfileId}`, 
        customer_profile_id: customerProfileId, 
        tenant_id: tenantId,
        end_user_phone: phoneNumber,
        last_intent: null 
      };
    }
  }

  async updateConversationIntent(conversationId, intent) {
    try {
      await dbClient
        .from('conversations_new')
        .update({ last_intent: intent, updated_at: new Date().toISOString() })
        .eq('id', conversationId);
    } catch (error) {
      console.error('Error updating intent:', error);
    }
  }

  async getProductAffinity(customerProfileId) {
    const { data, error } = await dbClient
      .from('customer_product_affinity')
      .select(`product_id, purchase_frequency, avg_quantity, last_purchase_date, days_since_last_purchase, is_regular_product, products:product_id (id, name, code)`)
      .eq('customer_profile_id', customerProfileId)
      .order('is_regular_product', { ascending: false })
      .order('days_since_last_purchase', { ascending: true });
    if (error) throw error;
    return (data || []).map(row => ({
      id: row.products?.id,
      name: row.products?.name,
      code: row.products?.code,
      purchase_frequency: row.purchase_frequency,
      avg_quantity: row.avg_quantity,
      last_purchase_date: row.last_purchase_date,
      days_since_last_purchase: row.days_since_last_purchase,
      is_regular_product: row.is_regular_product
    }));
  }

  checkCostLimits() {
    if (!this.enableAI) return false;
    const today = new Date().toDateString();
    if (this.costTracker.lastReset !== today) {
      this.costTracker.dailyCalls = 0;
      this.costTracker.dailyCost = 0;
      this.costTracker.lastReset = today;
    }
    const maxDailyCalls = parseInt(process.env.MAX_DAILY_AI_CALLS || '1000');
    const maxDailyCost = parseFloat(process.env.MAX_AI_COST_PER_DAY || '10.00');
    if (this.costTracker.dailyCalls >= maxDailyCalls) {
      console.warn(`⚠️ Daily AI call limit reached: ${this.costTracker.dailyCalls}`);
      return false;
    }
    if (this.costTracker.dailyCost >= maxDailyCost) {
      console.warn(`⚠️ Daily AI cost limit reached: $${this.costTracker.dailyCost.toFixed(2)}`);
      return false;
    }
    return true;
  }

  trackCost(cost) {
    this.costTracker.dailyCalls++;
    this.costTracker.dailyCost += cost;
    console.log(`💰 AI Cost: $${cost.toFixed(4)} | Daily: $${this.costTracker.dailyCost.toFixed(2)} (${this.costTracker.dailyCalls} calls)`);
  }

  getDailyCostSummary() {
    return {
      calls: this.costTracker.dailyCalls,
      cost: this.costTracker.dailyCost,
      date: this.costTracker.lastReset
    };
  }
}

module.exports = new AIIntegrationService();

