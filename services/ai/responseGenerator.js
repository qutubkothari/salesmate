const { openai } = require('../config');
const { checkCache, storeInCache } = require('./learningCacheService');

/**
 * ENHANCED RESPONSE GENERATOR WITH LEARNING CACHE
 * Checks cache first, only calls AI if needed
 */

async function generateResponse(query, context, tenantId) {
  try {
    if (!openai) {
      return {
        response: "AI features are disabled in this environment (missing OPENAI_API_KEY).",
        fromCache: false,
        tokens: 0,
        cost: 0,
        costSaved: 0,
        responseTime: 0
      };
    }
    console.log(`[AI] Processing query: "${query.substring(0, 50)}..."`);
    
    // STEP 1: Check cache first
    const cachedResponse = await checkCache(query, context.customerProfile, tenantId);
    
    if (cachedResponse) {
      console.log(`[AI] ✅ Using cached response (${(cachedResponse.similarity * 100).toFixed(1)}% match)`);
      console.log(`[AI] Cost: $0 (saved $0.0008)`);
      
      return {
        response: cachedResponse.response,
        fromCache: true,
        cacheId: cachedResponse.cacheId,
        similarity: cachedResponse.similarity,
        cost: 0,
        costSaved: 0.0008
      };
    }
    
    // STEP 2: Cache miss - generate new AI response
    console.log('[AI] Cache miss - generating new response...');
    
    const startTime = Date.now();
    
    // Build context and prompt
    const systemPrompt = buildSystemPrompt(context);
    const userPrompt = buildUserPrompt(query, context);
    
    // Call OpenAI
    const FAST_MODEL = process.env.AI_MODEL_FAST || 'grok-code-fast-1';
    const completion = await openai.chat.completions.create({
      model: FAST_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.7,
      max_tokens: 500
    });
    
    const response = completion.choices[0].message.content;
    const tokens = completion.usage.total_tokens;
    const cost = (tokens / 1000000) * 0.60; // gpt-4o-mini pricing
    
    const responseTime = Date.now() - startTime;
    
    console.log(`[AI] ✨ Generated new response`);
    console.log(`[AI] Tokens: ${tokens}, Cost: $${cost.toFixed(4)}, Time: ${responseTime}ms`);
    
    // STEP 3: Store in cache for future use
    const cacheEntry = await storeInCache(
      query,
      response,
      context.customerProfile,
      context.intent,
      tokens,
      cost,
      tenantId
    );
    
    return {
      response,
      fromCache: false,
      cacheId: cacheEntry?.id,
      tokens,
      cost,
      costSaved: 0,
      responseTime
    };
    
  } catch (error) {
    console.error('[AI] Error generating response:', error);
    throw error;
  }
}

function buildSystemPrompt(context) {
  let prompt = `You are a helpful sales assistant for SAK Solutions, a B2B supplier.

IMPORTANT RULES:
- Be natural and conversational
- Keep responses concise (2-3 sentences max)
- Never mention you're an AI
- Use customer's name naturally
- Reference their purchase history when relevant
`;

  // Add customer context if available
  if (context.customerProfile) {
    const profile = context.customerProfile;
    prompt += `\nCUSTOMER INFO:
- Name: ${profile.first_name}
- Total Orders: ${profile.total_orders || 0}
- Spent: ₹${(profile.total_spent || 0).toLocaleString('en-IN')}
`;

    if (context.regularProducts && context.regularProducts.length > 0) {
      prompt += `- Regular products: ${context.regularProducts.slice(0, 3).map(p => p.name).join(', ')}
`;
    }
  }

  // Add language preference
  if (context.language === 'hinglish' || context.language === 'hi') {
    prompt += `\nLANGUAGE: Respond in natural Hinglish (mix of Hindi and English). Use Hindi words casually but keep it readable.
`;
  } else if (context.language === 'ar') {
    prompt += `\nLANGUAGE: Respond in Arabic (العربية). Use Modern Standard Arabic that is widely understood.
`;
  } else if (context.language === 'ur') {
    prompt += `\nLANGUAGE: Respond in Urdu (اردو). Keep it professional yet friendly.
`;
  } else if (context.language && context.language !== 'en') {
    prompt += `\nLANGUAGE: Respond in ${context.language}. Keep it natural and conversational.
`;
  }

  return prompt;
}

function buildUserPrompt(query, context) {
  return query;
}

module.exports = { generateResponse };