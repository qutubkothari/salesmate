/**
 * OpenAI Service - Wrapper for OpenAI API calls
 * Provides unified interface for chat completions and other OpenAI features
 */

const { openai } = require('./config');

/**
 * Get chat completion from OpenAI
 * @param {Array} messages - Array of message objects with role and content
 * @param {string} model - Model to use (default: gpt-4-turbo)
 * @param {number} temperature - Temperature for response randomness (default: 0.7)
 * @returns {Promise<string>} - Completion text
 */
async function getChatCompletion(messages, model = 'gpt-4-turbo', temperature = 0.7) {
  try {
    const response = await openai.chat.completions.create({
      model,
      messages,
      temperature,
    });

    return response.choices[0].message.content.trim();
  } catch (error) {
    console.error('[OPENAI_SERVICE] Error getting chat completion:', error.message);
    throw error;
  }
}

/**
 * Get structured JSON response from OpenAI
 * @param {Array} messages - Array of message objects
 * @param {string} model - Model to use (default: gpt-4-turbo)
 * @returns {Promise<Object>} - Parsed JSON response
 */
async function getJsonCompletion(messages, model = 'gpt-4-turbo') {
  try {
    const response = await openai.chat.completions.create({
      model,
      messages,
      temperature: 0.3, // Lower temperature for more consistent structured output
      response_format: { type: "json_object" }
    });

    const content = response.choices[0].message.content.trim();
    return JSON.parse(content);
  } catch (error) {
    console.error('[OPENAI_SERVICE] Error getting JSON completion:', error.message);
    throw error;
  }
}

/**
 * Analyze text with embeddings
 * @param {string} text - Text to analyze
 * @param {string} model - Embedding model (default: text-embedding-ada-002)
 * @returns {Promise<Array>} - Embedding vector
 */
async function getEmbedding(text, model = 'text-embedding-ada-002') {
  try {
    const response = await openai.embeddings.create({
      model,
      input: text,
    });

    return response.data[0].embedding;
  } catch (error) {
    console.error('[OPENAI_SERVICE] Error getting embedding:', error.message);
    throw error;
  }
}

module.exports = {
  getChatCompletion,
  getJsonCompletion,
  getEmbedding,
  // Export raw client for advanced usage
  client: openai
};

