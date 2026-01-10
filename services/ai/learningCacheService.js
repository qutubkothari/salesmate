const { dbClient } = require('../../config/database');
const { openai } = require('../config');
const crypto = require('crypto');

const SIMILARITY_THRESHOLD = 0.85;
const CACHE_EXPIRY_DAYS = 90;
const AVG_AI_COST = 0.0008;

/**
 * Check if a similar query exists in cache
 */
async function checkCache(query, customerContext = {}) {
  try {
    console.log('[CACHE] Checking for similar cached response...');
    
    const embedding = await generateEmbedding(query);
    if (!embedding) {
      console.log('[CACHE] Could not generate embedding, skipping cache');
      return null;
    }

    const { data, error } = await dbClient.rpc('search_similar_queries', {
      p_query_embedding: embedding,
      p_similarity_threshold: SIMILARITY_THRESHOLD,
      p_match_count: 5
    });

    if (error) {
      console.error('[CACHE] Error searching cache:', error);
      return null;
    }

    if (!data || data.length === 0) {
      console.log('[CACHE] No similar queries found');
      return null;
    }

    const bestMatch = data[0];
    console.log(`[CACHE] Found similar query (${(bestMatch.similarity * 100).toFixed(1)}% match)`);
    console.log(`[CACHE] Used ${bestMatch.hit_count} times`);

    // Increment hit count
    await dbClient
      .from('ai_response_cache')
      .update({ hit_count: bestMatch.hit_count + 1 })
      .eq('query_hash', bestMatch.query_hash);

    // Track usage
    await trackUsage(query, 'cache', bestMatch.query_hash, 0, AVG_AI_COST, bestMatch.similarity);

    return {
      response: bestMatch.response,
      cacheId: bestMatch.query_hash,
      similarity: bestMatch.similarity,
      fromCache: true
    };

  } catch (error) {
    console.error('[CACHE] Error in checkCache:', error);
    return null;
  }
}

/**
 * Store a new AI response in cache
 */
async function storeInCache(query, response, customerContext, intent, tokens, cost) {
  try {
    console.log('[CACHE] Storing new response in cache...');
    
    const embedding = await generateEmbedding(query);
    if (!embedding) {
      console.log('[CACHE] Could not generate embedding, skipping cache storage');
      return null;
    }

    // Create hash of query for primary key
    const queryHash = crypto.createHash('md5').update(query).digest('hex');

    const { data, error } = await dbClient
      .from('ai_response_cache')
      .upsert({
        query_hash: queryHash,
        query_embedding: embedding,
        query_language: detectLanguage(query),
        response: response,
        response_tokens: tokens,
        customer_context: customerContext,
        intent: intent,
        original_cost: cost,
        hit_count: 1,
        led_to_order: false,
        expires_at: new Date(Date.now() + CACHE_EXPIRY_DAYS * 24 * 60 * 60 * 1000).toISOString(),
        created_at: new Date().toISOString()
      }, {
        onConflict: 'query_hash'
      })
      .select()
      .single();

    if (error) {
      console.error('[CACHE] Error storing in cache:', error);
      return null;
    }

    console.log('[CACHE] Response cached successfully');
    return data;

  } catch (error) {
    console.error('[CACHE] Error in storeInCache:', error);
    return null;
  }
}

/**
 * Generate embedding for a text using OpenAI
 */
async function generateEmbedding(text) {
  try {
    if (!openai) {
      return null;
    }
    const response = await openai.embeddings.create({
      model: 'text-embedding-ada-002',
      input: text.substring(0, 8000)
    });

    return response.data[0].embedding;

  } catch (error) {
    console.error('[CACHE] Error generating embedding:', error);
    return null;
  }
}

/**
 * Detect language of query
 */
function detectLanguage(text) {
  const hindiPattern = /[\u0900-\u097F]/;
  const hasHindi = hindiPattern.test(text);
  const hasEnglish = /[a-zA-Z]/.test(text);

  if (hasHindi && hasEnglish) return 'hinglish';
  if (hasHindi) return 'hi';
  return 'en';
}

/**
 * Track AI usage for analytics
 */
async function trackUsage(query, source, cacheId, tokens, cost, similarity = null) {
  try {
    const costSaved = source === 'cache' ? AVG_AI_COST : 0;

    await dbClient
      .from('ai_usage_tracking')
      .insert({
        query_text: query.substring(0, 500),
        response_source: source,
        cache_id: cacheId,
        tokens_used: tokens,
        cost: cost,
        cost_saved: costSaved,
        cache_similarity_score: similarity
      });

  } catch (error) {
    console.error('[CACHE] Error tracking usage:', error);
  }
}

/**
 * Mark cached response as effective
 */
async function markAsEffective(queryHash, customerId, ledToOrder, orderId = null) {
  try {
    await dbClient
      .from('ai_response_cache')
      .update({ led_to_order: ledToOrder })
      .eq('query_hash', queryHash);

    await dbClient
      .from('response_effectiveness')
      .insert({
        cache_query_hash: queryHash,
        customer_profile_id: customerId,
        led_to_order: ledToOrder,
        order_id: orderId
      });

    console.log('[CACHE] Marked response as effective');

  } catch (error) {
    console.error('[CACHE] Error marking as effective:', error);
  }
}

/**
 * Get cache statistics
 */
async function getCacheStats(days = 7) {
  try {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const { data, error } = await dbClient
      .from('ai_usage_tracking')
      .select('response_source, cost, cost_saved')
      .gte('created_at', startDate.toISOString());

    if (error) throw error;

    const stats = {
      totalQueries: data.length,
      cacheHits: data.filter(d => d.response_source === 'cache').length,
      cacheMisses: data.filter(d => d.response_source !== 'cache').length,
      totalCost: data.reduce((sum, d) => sum + parseFloat(d.cost || 0), 0),
      totalSaved: data.reduce((sum, d) => sum + parseFloat(d.cost_saved || 0), 0)
    };

    stats.cacheHitRate = stats.totalQueries > 0 ? (stats.cacheHits / stats.totalQueries * 100).toFixed(1) : '0';
    stats.savingsPercentage = (stats.totalCost + stats.totalSaved) > 0 ? (stats.totalSaved / (stats.totalCost + stats.totalSaved) * 100).toFixed(1) : '0';

    return stats;

  } catch (error) {
    console.error('[CACHE] Error getting stats:', error);
    return null;
  }
}

/**
 * Clean expired cache entries
 */
async function cleanExpiredCache() {
  try {
    const { data, error } = await dbClient
      .from('ai_response_cache')
      .delete()
      .lt('expires_at', new Date().toISOString())
      .select();

    if (error) throw error;

    console.log(`[CACHE] Cleaned ${data?.length || 0} expired entries`);
    return data?.length || 0;

  } catch (error) {
    console.error('[CACHE] Error cleaning cache:', error);
    return 0;
  }
}

/**
 * Update daily analytics
 */
async function updateDailyAnalytics() {
  try {
    const today = new Date().toISOString().split('T')[0];
    
    const { data: usage } = await dbClient
      .from('ai_usage_tracking')
      .select('*')
      .gte('created_at', `${today}T00:00:00Z`)
      .lt('created_at', `${today}T23:59:59Z`);

    if (!usage || usage.length === 0) return;

    const cacheHits = usage.filter(u => u.response_source === 'cache').length;
    const totalQueries = usage.length;
    const totalCost = usage.reduce((sum, u) => sum + parseFloat(u.cost || 0), 0);
    const costSaved = usage.reduce((sum, u) => sum + parseFloat(u.cost_saved || 0), 0);

    await dbClient
      .from('cache_analytics_daily')
      .upsert({
        date: today,
        total_queries: totalQueries,
        cache_hits: cacheHits,
        cache_misses: totalQueries - cacheHits,
        cache_hit_rate: (cacheHits / totalQueries * 100).toFixed(2),
        total_cost: totalCost.toFixed(4),
        cost_saved: costSaved.toFixed(4),
        savings_percentage: (costSaved / (totalCost + costSaved) * 100).toFixed(2)
      }, {
        onConflict: 'date'
      });

    console.log('[CACHE] Daily analytics updated');

  } catch (error) {
    console.error('[CACHE] Error updating analytics:', error);
  }
}

module.exports = {
  checkCache,
  storeInCache,
  markAsEffective,
  getCacheStats,
  cleanExpiredCache,
  updateDailyAnalytics,
  generateEmbedding
};
