/**
 * Free Embedding Service
 * Uses Hugging Face Inference API (free tier) for embeddings
 * Alternative to OpenAI with no costs
 */

const axios = require('axios');

// Free embedding models available on Hugging Face
const MODELS = {
    // Best free options (ranked by quality)
    'sentence-transformers/all-MiniLM-L6-v2': 384,  // Fast, good quality
    'sentence-transformers/all-mpnet-base-v2': 768,  // Higher quality, slower
    'BAAI/bge-small-en-v1.5': 384,                   // Very good for semantic search
    'thenlper/gte-small': 384,                       // Good general purpose
};

// Default model (best balance of speed and quality)
const DEFAULT_MODEL = 'sentence-transformers/all-MiniLM-L6-v2';
const EMBEDDING_DIMENSION = MODELS[DEFAULT_MODEL];

/**
 * Generate embedding using Hugging Face Inference API (Free)
 * @param {string} text - Text to embed
 * @param {string} model - Model name (optional)
 * @returns {Promise<Array<number>>} Embedding vector
 */
async function generateFreeEmbedding(text, model = DEFAULT_MODEL) {
    try {
        // Hugging Face inference endpoints vary by account/provider.
        // Try a small set of known-compatible endpoints in order.
        const API_URLS = [
            // Most reliable for embeddings/feature-extraction
            `https://api-inference.huggingface.co/pipeline/feature-extraction/${model}`,
            // Legacy models endpoint
            `https://api-inference.huggingface.co/models/${model}`,
            // Router endpoint (may require token / provider enablement)
            `https://router.huggingface.co/hf-inference/models/${model}`
        ];

        // Get API token from env (optional; some endpoints allow anonymous but may rate-limit)
        const HF_TOKEN = process.env.HUGGINGFACE_API_KEY || '';

        // Truncate text if too long (model limit is typically 512 tokens)
        const truncatedText = text.slice(0, 5000);

        const headers = HF_TOKEN
            ? { 'Authorization': `Bearer ${HF_TOKEN}`, 'Content-Type': 'application/json' }
            : { 'Content-Type': 'application/json' };

        let lastError = null;
        for (const API_URL of API_URLS) {
            try {
                const response = await axios.post(
                    API_URL,
                    {
                        inputs: truncatedText,
                        options: { wait_for_model: true }
                    },
                    {
                        headers,
                        timeout: 30000
                    }
                );

                // HF returns nested arrays (tokens x dim) or already pooled vector.
                let embedding = response.data;
                if (Array.isArray(embedding) && Array.isArray(embedding[0])) {
                    embedding = meanPooling(embedding);
                }

                if (!Array.isArray(embedding) || embedding.length === 0) {
                    throw new Error('Invalid embedding response format');
                }

                console.log(`[FreeEmbedding] Generated ${embedding.length}D embedding using ${model}`);
                return embedding;
            } catch (err) {
                lastError = err;
                const status = err?.response?.status;

                // Token-required endpoints commonly return 401/403.
                if ((status === 401 || status === 403) && !HF_TOKEN) {
                    // Keep trying other endpoints, but remember why.
                }

                // For 400/404 on one endpoint, try the next.
                continue;
            }
        }

        // If all endpoints fail, surface a helpful error.
        const status = lastError?.response?.status;
        if ((status === 401 || status === 403) && !HF_TOKEN) {
            throw new Error('Hugging Face embeddings require HUGGINGFACE_API_KEY in this environment');
        }

        throw lastError;

    } catch (error) {
        console.error('[FreeEmbedding] Error:', error.message);
        
        // If rate limited, try again after delay
        if (error.response?.status === 429) {
            console.log('[FreeEmbedding] Rate limited, waiting 5s...');
            await new Promise(resolve => setTimeout(resolve, 5000));
            return generateFreeEmbedding(text, model); // Retry
        }
        
        throw error;
    }
}

/**
 * Generate embeddings for multiple texts (batch processing)
 * @param {Array<string>} texts - Array of texts to embed
 * @param {string} model - Model name (optional)
 * @returns {Promise<Array<Array<number>>>} Array of embedding vectors
 */
async function generateFreeEmbeddingsBatch(texts, model = DEFAULT_MODEL) {
    const embeddings = [];
    
    for (let i = 0; i < texts.length; i++) {
        try {
            const embedding = await generateFreeEmbedding(texts[i], model);
            embeddings.push(embedding);
            
            console.log(`[FreeEmbedding] Batch progress: ${i + 1}/${texts.length}`);
            
            // Small delay to avoid rate limits (free tier)
            if (i < texts.length - 1) {
                await new Promise(resolve => setTimeout(resolve, 500));
            }
        } catch (error) {
            console.error(`[FreeEmbedding] Failed for text ${i}:`, error.message);
            // Push zero vector as fallback
            embeddings.push(new Array(EMBEDDING_DIMENSION).fill(0));
        }
    }

    return embeddings;
}

/**
 * Mean pooling for multiple vectors
 */
function meanPooling(vectors) {
    if (!vectors || vectors.length === 0) return [];
    
    const dim = vectors[0].length;
    const mean = new Array(dim).fill(0);
    
    for (const vector of vectors) {
        for (let i = 0; i < dim; i++) {
            mean[i] += vector[i];
        }
    }
    
    return mean.map(val => val / vectors.length);
}

/**
 * Alternative: Local embedding using TensorFlow.js (completely free, no API)
 * Requires @tensorflow/tfjs-node and @tensorflow-models/universal-sentence-encoder
 */
let useModel = null;

async function generateLocalEmbedding(text) {
    try {
        // Lazy load the model
        if (!useModel) {
            const use = require('@tensorflow-models/universal-sentence-encoder');
            console.log('[LocalEmbedding] Loading Universal Sentence Encoder...');
            useModel = await use.load();
            console.log('[LocalEmbedding] Model loaded successfully');
        }

        // Generate embedding
        const embeddings = await useModel.embed([text.slice(0, 5000)]);
        const embeddingArray = await embeddings.array();
        
        // Return first embedding (we only sent one text)
        return embeddingArray[0];

    } catch (error) {
        console.error('[LocalEmbedding] Error:', error.message);
        console.log('[LocalEmbedding] Falling back to Hugging Face API');
        return generateFreeEmbedding(text);
    }
}

/**
 * Smart embedding generator - tries local first, then free API
 * @param {string} text - Text to embed
 * @returns {Promise<Array<number>>} Embedding vector
 */
async function generateSmartEmbedding(text) {
    // Check if local model dependencies are available
    try {
        require.resolve('@tensorflow-models/universal-sentence-encoder');
        return await generateLocalEmbedding(text);
    } catch (e) {
        // Local model not available, use free API
        return await generateFreeEmbedding(text);
    }
}

/**
 * Get embedding dimension for current model
 */
function getEmbeddingDimension(model = DEFAULT_MODEL) {
    return MODELS[model] || 384;
}

module.exports = {
    generateFreeEmbedding,
    generateFreeEmbeddingsBatch,
    generateLocalEmbedding,
    generateSmartEmbedding,
    getEmbeddingDimension,
    DEFAULT_MODEL,
    EMBEDDING_DIMENSION,
    MODELS
};

