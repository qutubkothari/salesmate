// services/realtimeTestingService.js
const { dbClient } = require('./config');
const { scoreLead } = require('./leadScoringService');
const { analyzeConversationContext } = require('./enhancedFollowUpService');

/**
 * Real-time conversation tracker with 5-minute timeout logic
 */
class ConversationTracker {
  constructor() {
    this.activeConversations = new Map();
    this.timeoutTimers = new Map();
    
    // Start cleanup process
    this.startCleanupProcess();
  }

  /**
   * Track new message and reset timeout
   */
  async trackMessage(tenantId, endUserPhone, messageText, sender) {
    const conversationKey = `${tenantId}-${endUserPhone}`;
    
    // Clear existing timeout
    if (this.timeoutTimers.has(conversationKey)) {
      clearTimeout(this.timeoutTimers.get(conversationKey));
    }

    // Update conversation state
    const conversation = this.activeConversations.get(conversationKey) || {
      tenantId,
      endUserPhone,
      messages: [],
      startTime: new Date(),
      lastActivity: new Date(),
      leadScore: null,
      context: null
    };

    conversation.messages.push({
      text: messageText,
      sender,
      timestamp: new Date()
    });
    conversation.lastActivity = new Date();

    this.activeConversations.set(conversationKey, conversation);

    // Set 5-minute timeout for follow-up scheduling
    const timeoutId = setTimeout(async () => {
      await this.handleConversationTimeout(conversationKey);
    }, 5 * 60 * 1000); // 5 minutes

    this.timeoutTimers.set(conversationKey, timeoutId);

    console.log(`[TRACKER] Message tracked for ${endUserPhone}. Timeout set for 5 minutes.`);
    
    return conversation;
  }

  /**
   * Handle conversation timeout - analyze and schedule follow-up
   */
  async handleConversationTimeout(conversationKey) {
    try {
      const conversation = this.activeConversations.get(conversationKey);
      if (!conversation) return;

      console.log(`[TIMEOUT] 5 minutes passed for ${conversation.endUserPhone}. Analyzing conversation...`);

      // Analyze conversation for lead scoring
      await this.analyzeAndScheduleFollowup(conversation);

      // Clean up tracking
      this.activeConversations.delete(conversationKey);
      this.timeoutTimers.delete(conversationKey);

    } catch (error) {
      console.error('[TIMEOUT] Error handling conversation timeout:', error);
    }
  }

  /**
   * Analyze conversation and schedule appropriate follow-up
   */
  async analyzeAndScheduleFollowup(conversation) {
    const { tenantId, endUserPhone, messages } = conversation;
    
    try {
      // Get conversation history as text
      const conversationText = messages
        .map(m => `${m.sender}: ${m.text}`)
        .join('\n');

      console.log(`[ANALYSIS] Analyzing conversation for ${endUserPhone}:`);
      console.log(conversationText);

      // AI lead scoring
      await scoreLead(tenantId, endUserPhone);

      // Get updated lead score from database
      const { data: convData } = await dbClient
        .from('conversations')
        .select('lead_score, id')
        .eq('tenant_id', tenantId)
        .eq('end_user_phone', endUserPhone)
        .single();

      if (!convData) {
        console.log(`[ANALYSIS] No conversation found in DB for ${endUserPhone}`);
        return;
      }

      const leadScore = convData.lead_score || 'Cold';
      console.log(`[ANALYSIS] Lead score for ${endUserPhone}: ${leadScore}`);

      // Analyze conversation context
      const context = await analyzeConversationContext(tenantId, endUserPhone, conversationText);
      
      if (context) {
        await dbClient
          .from('conversations')
          .update({ context_analysis: JSON.stringify(context) })
          .eq('id', convData.id);
      }

      // Schedule follow-up based on lead temperature
      const followUpIntervals = {
        'Hot': 24,   // 24 hours
        'Warm': 48,  // 48 hours
        'Cold': 72   // 72 hours
      };

      const hoursToAdd = followUpIntervals[leadScore] || 72;
      const followUpTime = new Date();
      followUpTime.setHours(followUpTime.getHours() + hoursToAdd);

      // Update conversation with follow-up schedule
      await dbClient
        .from('conversations')
        .update({
          follow_up_at: followUpTime.toISOString(),
          follow_up_count: 0,
          last_message_at: new Date().toISOString()
        })
        .eq('id', convData.id);

      console.log(`[FOLLOWUP_SCHEDULED] ${leadScore} lead ${endUserPhone} will be followed up in ${hoursToAdd} hours`);

      // Notify admin about the lead analysis
      const { data: tenant } = await dbClient
        .from('tenants')
        .select('owner_whatsapp_number')
        .eq('id', tenantId)
        .single();

      if (tenant?.owner_whatsapp_number) {
        const adminNotification = `ðŸ¤– Lead Analysis Complete
        
Customer: ${endUserPhone}
Lead Score: ${leadScore}
Next Follow-up: ${hoursToAdd} hours
Context: ${context?.concerns?.join(', ') || 'General inquiry'}
Tone: ${context?.tone || 'Neutral'}

Conversation lasted ${Math.round((new Date() - conversation.startTime) / 1000 / 60)} minutes with ${messages.length} messages.`;

        // You would send this via your sendMessage service
        console.log(`[ADMIN_NOTIFICATION] Would send to admin:`, adminNotification);
      }

    } catch (error) {
      console.error('[ANALYSIS] Error analyzing conversation:', error);
    }
  }

  /**
   * Manually trigger analysis (for testing)
   */
  async triggerAnalysis(tenantId, endUserPhone) {
    const conversationKey = `${tenantId}-${endUserPhone}`;
    const conversation = this.activeConversations.get(conversationKey);
    
    if (conversation) {
      clearTimeout(this.timeoutTimers.get(conversationKey));
      await this.handleConversationTimeout(conversationKey);
      return true;
    }
    return false;
  }

  /**
   * Get real-time conversation status
   */
  getConversationStatus(tenantId, endUserPhone) {
    const conversationKey = `${tenantId}-${endUserPhone}`;
    const conversation = this.activeConversations.get(conversationKey);
    
    if (!conversation) {
      return { active: false };
    }

    const timeRemaining = 5 * 60 * 1000 - (new Date() - conversation.lastActivity);
    
    return {
      active: true,
      messageCount: conversation.messages.length,
      duration: Math.round((new Date() - conversation.startTime) / 1000 / 60),
      timeUntilFollowup: Math.max(0, Math.round(timeRemaining / 1000)),
      lastActivity: conversation.lastActivity
    };
  }

  /**
   * Cleanup process for memory management
   */
  startCleanupProcess() {
    setInterval(() => {
      const cutoff = new Date(Date.now() - 30 * 60 * 1000); // 30 minutes ago
      
      for (const [key, conversation] of this.activeConversations.entries()) {
        if (conversation.lastActivity < cutoff) {
          if (this.timeoutTimers.has(key)) {
            clearTimeout(this.timeoutTimers.get(key));
            this.timeoutTimers.delete(key);
          }
          this.activeConversations.delete(key);
          console.log(`[CLEANUP] Removed stale conversation: ${key}`);
        }
      }
    }, 10 * 60 * 1000); // Cleanup every 10 minutes
  }

  /**
   * Get all active conversations (for admin dashboard)
   */
  getAllActiveConversations() {
    const active = [];
    for (const [key, conversation] of this.activeConversations.entries()) {
      const timeRemaining = 5 * 60 * 1000 - (new Date() - conversation.lastActivity);
      active.push({
        key,
        endUserPhone: conversation.endUserPhone,
        messageCount: conversation.messages.length,
        duration: Math.round((new Date() - conversation.startTime) / 1000 / 60),
        timeUntilFollowup: Math.max(0, Math.round(timeRemaining / 1000))
      });
    }
    return active;
  }
}

// Singleton instance
const conversationTracker = new ConversationTracker();

/**
 * Integration with your webhook
 */
const trackCustomerMessage = async (tenantId, endUserPhone, messageText) => {
  return await conversationTracker.trackMessage(tenantId, endUserPhone, messageText, 'user');
};

const trackBotMessage = async (tenantId, endUserPhone, messageText) => {
  return await conversationTracker.trackMessage(tenantId, endUserPhone, messageText, 'bot');
};

/**
 * Testing endpoints for real-time testing
 */
const getTestingStatus = (tenantId, endUserPhone) => {
  return conversationTracker.getConversationStatus(tenantId, endUserPhone);
};

const triggerTestAnalysis = async (tenantId, endUserPhone) => {
  return await conversationTracker.triggerAnalysis(tenantId, endUserPhone);
};

const getAllActiveChats = () => {
  return conversationTracker.getAllActiveConversations();
};

module.exports = {
  trackCustomerMessage,
  trackBotMessage,
  getTestingStatus,
  triggerTestAnalysis,
  getAllActiveChats,
  conversationTracker
};
