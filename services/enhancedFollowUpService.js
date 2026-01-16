// services/enhancedFollowUpService.js
const { dbClient, openai } = require('./config');
const { sendMessage } = require('./whatsappService');
const { detectLanguage, translateMessage } = require('./multiLanguageService');
const debug = require('./debug');
const aiService = require('./aiService');

/**
 * Enhanced follow-up intervals based on lead temperature
 */
const FOLLOWUP_INTERVALS = {
  'Hot': 24,   // 24 hours
  'Warm': 48,  // 48 hours  
  'Cold': 72   // 72 hours
};

/**
 * AI-powered conversation analysis for context-aware follow-ups
 */
const analyzeConversationContext = async (conversationHistory) => {
  try {
    if (!conversationHistory || conversationHistory.length === 0) {
      return {
        leadTemperature: 'cold',
        context: 'No recent conversation',
        summary: 'Customer had minimal interaction',
        keyTopics: [],
        sentiment: 'neutral'
      };
    }

    const conversationText = conversationHistory
      .map(msg => `${msg.is_from_customer ? 'Customer' : 'Bot'}: ${msg.message_content}`)
      .join('\n');

    const analysisPrompt = `
Analyze this WhatsApp sales conversation and provide JSON response:

${conversationText}

Analyze and respond with JSON only:
{
  "leadTemperature": "hot|warm|cold",
  "context": "brief context of conversation",
  "summary": "conversation summary in 1-2 sentences",
  "keyTopics": ["topic1", "topic2"],
  "sentiment": "positive|neutral|negative",
  "nextBestAction": "suggested follow-up approach",
  "customerIntent": "browsing|interested|ready_to_buy|price_shopping"
}

Lead temperature rules:
- hot: Asked prices, specific products, showed buying intent
- warm: Asked questions, engaged but no clear buying signals  
- cold: Minimal engagement, basic questions only

IMPORTANT: Return ONLY the JSON object, no markdown formatting, no backticks, no explanation.
`;

    const aiResponse = await aiService.generateResponse(analysisPrompt, {
      maxTokens: 300,
      temperature: 0.3
    });

    // Clean up the AI response - remove markdown formatting
    let cleanedResponse = aiResponse.trim();
    
    // Remove markdown code blocks if present
    cleanedResponse = cleanedResponse.replace(/```json\s*/g, '');
    cleanedResponse = cleanedResponse.replace(/```\s*/g, '');
    
    // Remove any leading/trailing whitespace
    cleanedResponse = cleanedResponse.trim();
    
    // Find JSON object boundaries if there's extra text
    const jsonStart = cleanedResponse.indexOf('{');
    const jsonEnd = cleanedResponse.lastIndexOf('}');
    
    if (jsonStart !== -1 && jsonEnd !== -1 && jsonEnd > jsonStart) {
      cleanedResponse = cleanedResponse.substring(jsonStart, jsonEnd + 1);
    }

    debug.log('enhancedFollowUp', `AI Response cleaned: ${cleanedResponse.substring(0, 100)}...`);

    // Parse the cleaned JSON
    const analysis = JSON.parse(cleanedResponse);
    
    // Validate required fields
    if (!analysis.leadTemperature || !analysis.context) {
      throw new Error('Invalid analysis structure');
    }
    
    debug.log('enhancedFollowUp', `AI conversation analysis completed`, {
      leadTemperature: analysis.leadTemperature,
      customerIntent: analysis.customerIntent,
      keyTopicsCount: analysis.keyTopics?.length || 0
    });

    return analysis;

  } catch (error) {
    console.log('[ENHANCED_FOLLOWUP] Analysis failed, using fallback:', error.message);
    
    // Fallback analysis when JSON parsing fails
    return {
      leadTemperature: 'warm',
      context: 'Standard follow-up needed',
      summary: 'Customer engaged in conversation but outcome unclear',
      keyTopics: ['general_inquiry'],
      sentiment: 'neutral',
      nextBestAction: 'gentle_follow_up',
      customerIntent: 'browsing'
    };
  }
};

/**
 * Generate smart follow-up questions based on conversation context
 */
const generateSmartFollowUp = async (context, leadScore, followUpCount, language = 'en') => {
  const templates = {
    // After 2-3 follow-ups, ask diagnostic questions
    diagnostic: {
      en: [
        "I understand you might have some concerns. Could you help me understand what's holding you back?",
        "Is there something specific about our product that doesn't fit your needs?",
        "Would you mind sharing what your budget range is? I might have alternatives."
      ],
      hi: [
        "मैं समझ सकता हूं कि आपकी कुछ चिंताएं हो सकती हैं। क्या आप बता सकते हैं कि क्या समस्या है?",
        "क्या हमारे प्रोडक्ट में कुछ ऐसा है जो आपकी जरूरत के अनुसार नहीं है?",
        "क्या आप अपना बजट बता सकते हैं? हो सकता है मेरे पास कोई और विकल्प हो।"
      ],
      hinglish: [
        "Main samajh sakta hun ki aapki kuch concerns ho sakti hain. Kya aap bata sakte hain ki kya problem hai?",
        "Kya humare product mein kuch aisa hai jo aapki need ke according nahi hai?",
        "Kya aap apna budget range share kar sakte hain? Maybe mere paas alternatives hon."
      ]
    },
    
    // Price objection handling
    price_sensitive: {
      en: [
        "I understand price is important. What would be a comfortable range for you?",
        "Would you be interested in a payment plan or different package options?",
        "Are you comparing with other products? I'd love to show you our value proposition."
      ],
      hi: [
        "मैं समझता हूं कि कीमत महत्वपूर्ण है। आपके लिए कौन सी रेंज ठीक होगी?",
        "क्या आप EMI या अलग पैकेज में interested होंगे?",
        "क्या आप दूसरे products से compare कर रहे हैं? मैं आपको हमारा value दिखाना चाहूंगा।"
      ],
      hinglish: [
        "Main samajhta hun ki price important hai. Aapke liye kaun si range comfortable hogi?",
        "Kya aap EMI ya different package options mein interested honge?",
        "Kya aap other products se compare kar rahe hain? Main aapko humara value proposition show karna chahunga."
      ]
    },
    
    // Feature concerns
    feature_concerns: {
      en: [
        "What specific features are most important to you?",
        "Are there any capabilities you need that we haven't discussed?",
        "Would a demo help you see how our product addresses your needs?"
      ],
      hi: [
        "आपके लिए कौन से features सबसे जरूरी हैं?",
        "क्या कोई खास capabilities चाहिए जिसके बारे में हमने बात नहीं की?",
        "क्या demo से आपको समझ आएगा कि हमारा product आपकी जरूरतों को कैसे पूरा करता है?"
      ],
      hinglish: [
        "Aapke liye kaun se features sabse important hain?",
        "Kya koi special capabilities chahiye jo humne discuss nahi ki?",
        "Kya demo se help milegi aapko samajhne mein ki humara product aapki needs ko kaise address karta hai?"
      ]
    }
  };

  // Select appropriate template based on context
  let templateKey = 'diagnostic';
  if (context?.concerns?.includes('price')) templateKey = 'price_sensitive';
  if (context?.concerns?.includes('features')) templateKey = 'feature_concerns';

  const messages = templates[templateKey][language] || templates[templateKey]['en'];
  return messages[Math.floor(Math.random() * messages.length)];
};

/**
 * Get conversation history for a phone number using correct column names
 */
const getConversationHistory = async (phone) => {
  try {
    // Use dbClient to get conversation history with correct column name: end_user_phone
    const { data: messages, error } = await dbClient
      .from('conversations_new')
      .select(`
        message_content, is_from_customer, created_at, message_type,
        messages (sender, message_body, created_at)
      `)
      .eq('end_user_phone', phone)
      .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
      .order('created_at', { ascending: true })
      .limit(50);

    if (error) throw error;
    return messages || [];
  } catch (error) {
    debug.log('enhancedFollowUp', `Error getting conversation history for ${phone}`, error);
    return [];
  }
};

/**
 * Save follow-up to database using correct column names
 */
const saveFollowUpToDatabase = async (followUpData) => {
  try {
    // Use correct column name: end_user_phone
    const { data, error } = await dbClient
      .from('enhanced_followups')
      .insert({
        end_user_phone: followUpData.phone, // This will go into end_user_phone column
        message: followUpData.message,
        scheduled_for: followUpData.scheduledFor,
        lead_temperature: followUpData.leadTemperature,
        context_analysis: JSON.stringify(followUpData.context),
        conversation_summary: followUpData.conversationSummary,
        created_at: new Date().toISOString()
      })
      .select('id')
      .single();

    if (error) throw error;
    return data?.id;

  } catch (error) {
    debug.log('enhancedFollowUp', `Error saving to database`, error);
    return await saveBasicFollowUp(followUpData);
  }
};

/**
 * Basic fallback follow-up save method
 */
const saveBasicFollowUp = async (followUpData) => {
  try {
    const { data, error } = await dbClient
      .from('conversations_new')
      .update({
        follow_up_at: followUpData.scheduledFor,
        context_analysis: JSON.stringify(followUpData.context || {})
      })
      .eq('end_user_phone', followUpData.phone)
      .select('id')
      .single();

    if (error) throw error;
    return data?.id;
  } catch (error) {
    debug.log('enhancedFollowUp', `Error in basic follow-up save`, error);
    return null;
  }
};

/**
 * Process enhanced follow-ups from database
 */
const processEnhancedFollowUps = async () => {
  try {
    const { data: followUps, error } = await dbClient
      .from('enhanced_followups')
      .select(`
        *, 
        conversation:conversations!inner(last_follow_up_at, end_user_phone)
      `)
      .eq('status', 'pending')
      .lte('scheduled_for', new Date().toISOString())
      .order('created_at', { ascending: true })
      .limit(10);

    if (error) throw error;
    
    // Process the follow-ups...
    for (const followUp of followUps || []) {
      // Implementation for processing each follow-up
      console.log(`Processing follow-up for ${followUp.end_user_phone}`);
    }
    
    return followUps?.length || 0;
  } catch (error) {
    console.log('Error processing enhanced follow-ups:', error);
    return 0;
  }
};

/**
 * Get conversation ID by tenant and phone using correct column names
 */
const getConversationId = async (tenantId, endUserPhone) => {
  try {
    const { data, error } = await dbClient
      .from('conversations_new')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('end_user_phone', endUserPhone) // Use correct column name
      .single();

    if (error) throw error;
    return data?.id;
  } catch (error) {
    debug.log('enhancedFollowUp', `Error getting conversation ID for ${endUserPhone}`, error);
    return null;
  }
};

/**
 * Enhanced follow-up processing with dynamic intervals
 */
const sendDueFollowUpReminders = async () => {
  try {
    console.log('[FOLLOWUP] Starting enhanced follow-up processing...');
    
    const { data: conversations, error } = await dbClient
      .from('conversations_new')
      .select('id, tenant_id, end_user_phone, lead_score, follow_up_count, last_follow_up_at, follow_up_at, context_analysis')
      .not('follow_up_at', 'is', null)
      .lte('follow_up_at', new Date().toISOString());

    if (error) throw error;
    if (!conversations?.length) return;

    for (const conv of conversations) {
      const { data: tenant } = await dbClient.from('tenants').select('id, owner_whatsapp_number, bot_language').eq('id', conv.tenant_id).single();
      if (!tenant) continue;
      const { lead_score, follow_up_count = 0 } = conv;
      
      // Skip if customer has opted out
      const { data: optOut } = await dbClient
        .from('conversation_flags')
        .select('flag_type')
        .eq('conversation_id', conv.id)
        .in('flag_type', ['not_interested', 'do_not_contact']);
      
      if (optOut?.length) continue;

      // Get conversation history for context
      const { data: messages } = await dbClient
        .from('messages')
        .select('sender, message_body, created_at')
        .eq('conversation_id', conv.id)
        .order('created_at', { ascending: false })
        .limit(20);

      const conversationHistory = messages
        ?.map(m => `${m.sender}: ${m.message_body}`)
        .reverse()
        .join('\n') || '';

      // Analyze conversation context if not done recently
      let context = null;
      try {
        context = conv.context_analysis ? JSON.parse(conv.context_analysis) : null;
      } catch (e) {
        context = null;
      }

      if (!context || follow_up_count % 3 === 0) {
        context = await analyzeConversationContext(conversationHistory);
        if (context) {
          await dbClient
            .from('conversations_new')
            .update({ context_analysis: JSON.stringify(context) })
            .eq('id', conv.id);
        }
      }

      // Detect customer language preference
      const detectedLang = context?.language_detected || 
                          await detectLanguage(conversationHistory) || 
                          tenant.bot_language || 'en';

      // Generate smart follow-up message
      let followUpMessage;
      if (follow_up_count >= 2) {
        // After 2+ follow-ups, ask diagnostic questions
        followUpMessage = await generateSmartFollowUp(context, lead_score, follow_up_count, detectedLang);
      } else {
        // Regular follow-up based on lead temperature
        followUpMessage = await generateRegularFollowUp(lead_score, context, detectedLang);
      }

      // Send follow-up message
      await sendMessage(conv.end_user_phone, followUpMessage);
      
      // Schedule next follow-up based on lead score
      const nextInterval = FOLLOWUP_INTERVALS[lead_score] || 72;
      const nextFollowUp = new Date();
      nextFollowUp.setHours(nextFollowUp.getHours() + nextInterval);

      // Update conversation
      await dbClient
        .from('conversations_new')
        .update({
          follow_up_count: follow_up_count + 1,
          last_follow_up_at: new Date().toISOString(),
          follow_up_at: nextFollowUp.toISOString()
        })
        .eq('id', conv.id);

      // Notify admin
      const adminMessage = `🔄 Auto follow-up #${follow_up_count + 1} sent to ${conv.end_user_phone} (${lead_score} lead)\n\nMessage: "${followUpMessage}"`;
      await sendMessage(tenant.owner_whatsapp_number, adminMessage);

      console.log(`[FOLLOWUP] Sent follow-up #${follow_up_count + 1} to ${conv.end_user_phone} (${lead_score})`);
    }

  } catch (error) {
    console.error('[FOLLOWUP] Error processing enhanced follow-ups:', error);
  }
};

/**
 * Handle customer responses to follow-ups
 */
const processFollowUpResponse = async (tenantId, endUserPhone, userMessage) => {
  // Detect negative responses
  const negativePatterns = {
    en: /not interested|don't want|no thanks|stop|remove me/i,
    hi: /दिलचस्पी नहीं|नहीं चाहिए|रुको|हटा दो/i,
    hinglish: /interest nahi|nahi chahiye|band karo|remove kar do/i
  };

  const isNegative = Object.values(negativePatterns).some(pattern => pattern.test(userMessage));
  
  if (isNegative) {
    // Flag as not interested and stop follow-ups
    await dbClient.from('conversation_flags').upsert({
      conversation_id: await getConversationId(tenantId, endUserPhone),
      flag_type: 'not_interested',
      created_at: new Date().toISOString()
    });

    await dbClient
      .from('conversations_new')
      .update({ follow_up_at: null })
      .eq('tenant_id', tenantId)
      .eq('end_user_phone', endUserPhone);

    return true; // Indicates follow-up should stop
  }

  return false; // Continue normal processing
};

const generateRegularFollowUp = async (leadScore, context, language) => {
  const templates = {
    Hot: {
      en: ["Hi! Are you ready to move forward with your order?", "Just checking - do you need any help completing your purchase?"],
      hi: ["हाय! क्या आप अपना ऑर्डर करने के लिए तैयार हैं?", "बस पूछ रहा था - क्या आपको अपनी खरीदारी पूरी करने में कोई मदद चाहिए?"],
      hinglish: ["Hi! Kya aap apna order karne ke liye ready hain?", "Just checking - kya aapko apni purchase complete karne mein help chahiye?"]
    },
    Warm: {
      en: ["Hi! I wanted to follow up on our conversation. Do you have any questions?", "How are you thinking about our discussion? Any concerns I can address?"],
      hi: ["नमस्ते! मैं हमारी बातचीत के बारे में पूछना चाहता था। क्या कोई सवाल है?", "हमारी चर्चा के बारे में आप क्या सोच रहे हैं? कोई परेशानी जिसका मैं समाधान कर सकूं?"],
      hinglish: ["Hi! Main humari conversation ke baare mein follow up karna chahta tha. Koi questions hain?", "Humari discussion ke baare mein kya soch rahe hain? Koi concerns jo main address kar sakun?"]
    },
    Cold: {
      en: ["Hope you're doing well! Just wanted to see if you're still interested in learning more.", "Hi! Thought I'd check in. Is this still something you might be interested in?"],
      hi: ["उम्मीद है आप ठीक होंगे! बस देखना चाहता था कि क्या आप अभी भी और जानने में रुचि रखते हैं।", "नमस्ते! सोचा था कि पूछ लूं। क्या यह अभी भी कुछ ऐसा है जिसमें आपकी रुचि हो सकती है?"],
      hinglish: ["Hope aap well hain! Just dekhna chahta tha ki kya aap abhi bhi more janne mein interested hain.", "Hi! Socha tha ki check kar lun. Kya yeh abhi bhi kuch aisa hai jismein aapki interest ho sakti hai?"]
    }
  };

  const scoreTemplates = templates[leadScore] || templates.Cold;
  const langTemplates = scoreTemplates[language] || scoreTemplates.en;
  
  return langTemplates[Math.floor(Math.random() * langTemplates.length)];
};

/**
 * Helper method to clean JSON response from AI
 */
const cleanJsonResponse = (response) => {
  let cleaned = response.trim();
  
  // Remove markdown code blocks
  cleaned = cleaned.replace(/```json\s*/gi, '');
  cleaned = cleaned.replace(/```\s*/g, '');
  
  // Remove any text before the first {
  const jsonStart = cleaned.indexOf('{');
  if (jsonStart > 0) {
    cleaned = cleaned.substring(jsonStart);
  }
  
  // Remove any text after the last }
  const jsonEnd = cleaned.lastIndexOf('}');
  if (jsonEnd !== -1 && jsonEnd < cleaned.length - 1) {
    cleaned = cleaned.substring(0, jsonEnd + 1);
  }
  
  return cleaned.trim();
};

module.exports = {
  sendDueFollowUpReminders,
  processFollowUpResponse,
  analyzeConversationContext,
  generateSmartFollowUp,
  getConversationHistory,
  saveFollowUpToDatabase,
  saveBasicFollowUp,
  processEnhancedFollowUps,
  getConversationId,
  cleanJsonResponse
};

