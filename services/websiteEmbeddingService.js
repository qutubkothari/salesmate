/**
 * Website Embedding Service
 * Handles text chunking and embedding generation for crawled content
 * Now using FREE embeddings!
 */

const { dbClient } = require('./config');
const { 
    generateFreeEmbedding, 
    generateFreeEmbeddingsBatch,
    generateSmartEmbedding,
    EMBEDDING_DIMENSION 
} = require('./freeEmbeddingService');

/**
 * Split text into chunks suitable for embedding
 * @param {string} text - Text to chunk
 * @param {Object} options - Chunking options
 * @returns {Array<Object>} Array of text chunks with metadata
 */
function chunkText(text, options = {}) {
    const {
        chunkSize = 1000, // Characters per chunk
        chunkOverlap = 200, // Overlap between chunks
        minChunkSize = 100 // Minimum chunk size
    } = options;

    const chunks = [];
    let startIndex = 0;

    // Split by paragraphs first (better semantic boundaries)
    const paragraphs = text.split(/\n\n+/);
    let currentChunk = '';
    let chunkIndex = 0;

    for (const paragraph of paragraphs) {
        const trimmedParagraph = paragraph.trim();
        
        if (!trimmedParagraph) continue;

        // If adding this paragraph would exceed chunk size
        if (currentChunk.length + trimmedParagraph.length > chunkSize) {
            // Save current chunk if it's substantial
            if (currentChunk.length >= minChunkSize) {
                chunks.push({
                    text: currentChunk.trim(),
                    index: chunkIndex++,
                    startChar: startIndex,
                    endChar: startIndex + currentChunk.length
                });
                
                // Start new chunk with overlap
                const overlapText = currentChunk.slice(-chunkOverlap);
                currentChunk = overlapText + '\n\n' + trimmedParagraph;
                startIndex += (currentChunk.length - overlapText.length);
            } else {
                currentChunk += '\n\n' + trimmedParagraph;
            }
        } else {
            currentChunk += (currentChunk ? '\n\n' : '') + trimmedParagraph;
        }
    }

    // Add final chunk
    if (currentChunk.length >= minChunkSize) {
        chunks.push({
            text: currentChunk.trim(),
            index: chunkIndex++,
            startChar: startIndex,
            endChar: startIndex + currentChunk.length
        });
    }

    console.log(`[ChunkingService] Created ${chunks.length} chunks from ${text.length} characters`);
    return chunks;
}

/**
 * Generate embedding for text using OpenAI API (PAID but reliable)
 * @param {string} text - Text to embed
 * @param {string} model - Embedding model to use
 * @returns {Promise<Array<number>>} Embedding vector
 */
async function generateEmbedding(text, model = null) {
    try {
        // Prefer free embeddings by default (Hugging Face / local USE model).
        // Opt into OpenAI embeddings only if explicitly enabled.
        const useOpenAI = String(process.env.USE_OPENAI_EMBEDDINGS || '').toLowerCase() === 'true';

        if (!useOpenAI) {
            try {
                const embedding = await generateSmartEmbedding(text);
                if (Array.isArray(embedding) && embedding.length) {
                    return embedding;
                }
            } catch (freeErr) {
                console.warn('[EmbeddingService] Free embedding failed, falling back to OpenAI:', freeErr?.message);
                // Fall through to OpenAI backup
            }
        }

        const { openai } = require('./config');
        const response = await openai.embeddings.create({
            model: 'text-embedding-3-small',
            input: text.slice(0, 8000),
            dimensions: 384
        });

        const embedding = response.data[0].embedding;
        console.log(`[EmbeddingService] Generated OpenAI embedding with ${embedding.length} dimensions`);
        return embedding;

    } catch (error) {
        console.error('[EmbeddingService] Error generating embedding:', error.message);
        throw error;
    }
}

/**
 * Generate embeddings for multiple text chunks (batch processing)
 * @param {Array<string>} texts - Array of texts to embed
 * @param {string} model - Embedding model to use (ignored, using OpenAI)
 * @returns {Promise<Array<Array<number>>>} Array of embedding vectors
 */
async function generateEmbeddingsBatch(texts, model = null) {
    try {
        const useOpenAI = String(process.env.USE_OPENAI_EMBEDDINGS || '').toLowerCase() === 'true';
        if (!useOpenAI) {
            try {
                const embeddings = await generateFreeEmbeddingsBatch(texts);
                console.log(`[EmbeddingService] Generated ${embeddings.length} free embeddings`);
                return embeddings;
            } catch (freeErr) {
                console.warn('[EmbeddingService] Free batch embeddings failed, falling back to OpenAI:', freeErr?.message);
                // Fall through to OpenAI backup
            }
        }

        // OpenAI fallback (sequential)
        const embeddings = [];
        for (const text of texts) {
            const embedding = await generateEmbedding(text);
            embeddings.push(embedding);
        }

        console.log(`[EmbeddingService] Generated ${embeddings.length} OpenAI embeddings`);
        return embeddings;

    } catch (error) {
        console.error('[EmbeddingService] Error generating batch embeddings:', error.message);
        throw error;
    }
}

/**
 * Process crawled content: chunk and generate embeddings
 * @param {Object} crawledData - Data from web crawler
 * @param {string} tenantId - Tenant ID
 * @returns {Promise<Object>} Processing results
 */
async function processWebsiteContent(crawledData, tenantId) {
    console.log(`[WebsiteEmbedding] Processing content from: ${crawledData.url}`);

    try {
        // Chunk the content
        const chunks = chunkText(crawledData.content, {
            chunkSize: 1000,
            chunkOverlap: 200
        });

        if (chunks.length === 0) {
            throw new Error('No valid chunks created from content');
        }

        // Generate embeddings for all chunks
        const chunkTexts = chunks.map(chunk => chunk.text);
        const embeddings = await generateEmbeddingsBatch(chunkTexts);

        // Detect content type
        const contentType = detectContentType(crawledData.url, crawledData.pageTitle);

        const nowIso = new Date().toISOString();
        const url = crawledData.url;

        // Prepare records for database (compatible with both Postgres and local SQLite)
        const records = chunks.map((chunk, index) => ({
            tenant_id: tenantId,
            // Legacy/local schema
            content: chunk.text, // local SQLite has NOT NULL content
            source_url: url,
            metadata: JSON.stringify({
                url,
                page_title: crawledData.pageTitle,
                content_type: contentType,
                chunk_index: chunk.index,
                product_codes: crawledData.productCodes || [],
                keywords: extractKeywords(chunk.text)
            }),

            // New schema used by the website search/list endpoints
            url,
            page_title: crawledData.pageTitle,
            content_type: contentType,
            original_content: crawledData.content,
            chunk_text: chunk.text,
            chunk_index: chunk.index,
            // Store as JSON array string; search service does JSON.parse() and computes cosine similarity.
            embedding: JSON.stringify(embeddings[index]),
            product_codes: JSON.stringify(crawledData.productCodes || []),
            keywords: JSON.stringify(extractKeywords(chunk.text)),
            status: 'active',
            crawl_date: nowIso,
            last_updated: nowIso
        }));

        // Store in database
        const { data, error } = await dbClient
            .from('website_embeddings')
            .insert(records)
            .select();

        if (error) {
            throw error;
        }

        console.log(`[WebsiteEmbedding] Stored ${records.length} chunks for ${crawledData.url}`);

        return {
            success: true,
            url: crawledData.url,
            chunksCreated: chunks.length,
            embeddingsGenerated: embeddings.length,
            recordsStored: data.length,
            embeddingIds: data.map(r => r.id)
        };

    } catch (error) {
        console.error('[WebsiteEmbedding] Error processing content:', error.message);
        throw error;  // Re-throw instead of returning object
    }
}

/**
 * Detect content type from URL and title
 */
function detectContentType(url, pageTitle) {
    const urlLower = url.toLowerCase();
    const titleLower = pageTitle.toLowerCase();

    if (urlLower.includes('/product') || titleLower.includes('product')) {
        return 'product_page';
    } else if (urlLower.includes('/price') || titleLower.includes('price')) {
        return 'pricing';
    } else if (urlLower.includes('/spec') || titleLower.includes('specification')) {
        return 'technical_spec';
    } else if (urlLower.includes('/faq') || titleLower.includes('faq')) {
        return 'faq';
    }
    return 'general';
}

/**
 * Extract keywords from text (simple implementation)
 */
function extractKeywords(text, maxKeywords = 10) {
    // Remove common words
    const stopWords = new Set(['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are', 'were', 'been', 'be', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might', 'can']);

    const words = text.toLowerCase()
        .replace(/[^\w\s]/g, ' ')
        .split(/\s+/)
        .filter(word => word.length > 3 && !stopWords.has(word));

    // Count frequency
    const wordFreq = {};
    words.forEach(word => {
        wordFreq[word] = (wordFreq[word] || 0) + 1;
    });

    // Sort by frequency and take top N
    const keywords = Object.entries(wordFreq)
        .sort((a, b) => b[1] - a[1])
        .slice(0, maxKeywords)
        .map(([word]) => word);

    return keywords;
}

/**
 * Update existing embeddings (e.g., after re-crawling)
 */
async function updateWebsiteEmbeddings(url, tenantId, newCrawledData) {
    try {
        // Delete old embeddings for this URL
        const { error: deleteError } = await dbClient
            .from('website_embeddings')
            .delete()
            .eq('tenant_id', tenantId)
            .eq('url', url);

        if (deleteError) throw deleteError;

        // Process and store new embeddings
        return await processWebsiteContent(newCrawledData, tenantId);

    } catch (error) {
        console.error('[WebsiteEmbedding] Error updating embeddings:', error.message);
        throw error;
    }
}

/**
 * Delete embeddings for a URL
 */
async function deleteWebsiteEmbeddings(url, tenantId) {
    try {
        const { data, error } = await dbClient
            .from('website_embeddings')
            .delete()
            .eq('tenant_id', tenantId)
            .eq('url', url)
            .select();

        if (error) throw error;

        console.log(`[WebsiteEmbedding] Deleted ${data.length} embeddings for ${url}`);
        return { success: true, deletedCount: data.length };

    } catch (error) {
        console.error('[WebsiteEmbedding] Error deleting embeddings:', error.message);
        throw error;
    }
}

module.exports = {
    chunkText,
    generateEmbedding,
    generateEmbeddingsBatch,
    processWebsiteContent,
    updateWebsiteEmbeddings,
    deleteWebsiteEmbeddings,
    extractKeywords
};


