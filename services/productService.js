/**
 * @title Product Management Service
 * @description Handles product creation, Excel uploads, AI embeddings, and product retrieval.
 */
const xlsx = require('xlsx');
const fetch = require('node-fetch');
const { dbClient, openai } = require('./config');
const { sendMessage } = require('./whatsappService');

/**
 * Generates a vector embedding for a given text using OpenAI's API.
 * This embedding is a numerical representation of the text's meaning.
 * @param {string} text The text to create an embedding for (e.g., product name and description).
 * @returns {Array<number>|null} The vector embedding or null if an error occurs.
 */
const generateEmbedding = async (text) => {
    try {
        const response = await openai.embeddings.create({
            model: 'text-embedding-3-small',
            input: String(text || '').slice(0, 8000), // guard length
        });
        return response.data[0].embedding;
    } catch (error) {
        console.error('Error generating OpenAI embedding:', error.message);
        return null;
    }
};

/**
 * 🔧 MISSING FUNCTION - This is what the bot needs!
 * Retrieves all products for a specific tenant from the database.
 * @param {string} tenantId The UUID of the tenant whose products to retrieve.
 * @returns {Array} Array of product objects or empty array if none found.
 */
const getAllProducts = async (tenantId) => {
    try {
        if (!tenantId) {
            console.warn('[PRODUCT] getAllProducts called without tenantId');
            return [];
        }

        console.log(`[PRODUCT] Fetching all products for tenant: ${tenantId}`);
        
        const { data, error } = await dbClient
            .from('products')
            .select('*')
            .eq('tenant_id', tenantId)
            .order('name', { ascending: true });

        if (error) {
            console.error('[PRODUCT] Error fetching products:', error.message);
            return [];
        }

        console.log(`[PRODUCT] Found ${data?.length || 0} products for tenant ${tenantId}`);
        return data || [];

    } catch (error) {
        console.error('[PRODUCT] Exception in getAllProducts:', error.message);
        return [];
    }
};

/**
 * 🎯 NEW FUNCTION - Search products using vector similarity
 * Finds products similar to the user's query using AI embeddings.
 * @param {string} tenantId The UUID of the tenant whose products to search.
 * @param {string} query The user's search query.
 * @param {number} limit Maximum number of results to return (default: 5).
 * @returns {Array} Array of matching products sorted by similarity.
 */
const searchProducts = async (tenantId, query, limit = 5) => {
    try {
        if (!tenantId || !query) {
            console.warn('[PRODUCT] searchProducts called with missing parameters');
            return [];
        }

        console.log(`[PRODUCT] Searching products for tenant ${tenantId}, query: "${query}"`);

        // Generate embedding for the search query
        const queryEmbedding = await generateEmbedding(query);
        if (!queryEmbedding) {
            console.warn('[PRODUCT] Could not generate embedding for search query, falling back to text search');
            
            // Fallback to basic text search if embedding fails
            const { data, error } = await dbClient
                .from('products')
                .select('*')
                .eq('tenant_id', tenantId)
                .or(`name.ilike.%${query}%,description.ilike.%${query}%`)
                .limit(limit);
                
            if (error) {
                console.error('[PRODUCT] Error in fallback text search:', error.message);
                return [];
            }
            
            return data || [];
        }

        // Use vector similarity search (requires pgvector extension in dbClient)
        const { data, error } = await dbClient
            .rpc('match_products', {
                query_embedding: queryEmbedding,
                match_tenant_id: tenantId,
                match_threshold: 0.3,
                match_count: limit
            });

        if (error) {
            console.warn('[PRODUCT] Vector search failed, falling back to text search:', error.message);
            
            // Fallback to text search
            const { data: fallbackData, error: fallbackError } = await dbClient
                .from('products')
                .select('*')
                .eq('tenant_id', tenantId)
                .or(`name.ilike.%${query}%,description.ilike.%${query}%`)
                .limit(limit);
                
            if (fallbackError) {
                console.error('[PRODUCT] Fallback text search also failed:', fallbackError.message);
                return [];
            }
            
            return fallbackData || [];
        }

        console.log(`[PRODUCT] Vector search found ${data?.length || 0} matching products`);
        return data || [];

    } catch (error) {
        console.error('[PRODUCT] Exception in searchProducts:', error.message);
        return [];
    }
};

/**
 * 📊 NEW FUNCTION - Get product statistics for a tenant
 * Returns useful stats about the tenant's product catalog.
 * @param {string} tenantId The UUID of the tenant.
 * @returns {Object} Statistics about the product catalog.
 */
const getProductStats = async (tenantId) => {
    try {
        if (!tenantId) {
            return { total: 0, withPrices: 0, avgPrice: 0, categories: [] };
        }

        const { data, error } = await dbClient
            .from('products')
            .select('price, technical_details')
            .eq('tenant_id', tenantId);

        if (error || !data) {
            console.error('[PRODUCT] Error fetching product stats:', error?.message);
            return { total: 0, withPrices: 0, avgPrice: 0, categories: [] };
        }

        const total = data.length;
        const withPrices = data.filter(p => p.price && p.price > 0).length;
        const avgPrice = withPrices > 0 
            ? data.filter(p => p.price).reduce((sum, p) => sum + p.price, 0) / withPrices 
            : 0;

        // Extract categories from technical_details if available
        const categories = [...new Set(
            data.map(p => p.technical_details?.category).filter(Boolean)
        )];

        return {
            total,
            withPrices,
            avgPrice: Math.round(avgPrice * 100) / 100,
            categories
        };

    } catch (error) {
        console.error('[PRODUCT] Exception in getProductStats:', error.message);
        return { total: 0, withPrices: 0, avgPrice: 0, categories: [] };
    }
};

/**
 * Processes a tenant's uploaded Excel file of products.
 * It reads the file, generates embeddings for each product, and saves them to the database.
 * @param {Buffer} fileBuffer The buffer of the uploaded Excel file.
 * @param {string} tenantId The UUID of the tenant who owns these products.
 * @returns {{ success: boolean, message: string, count: number }} Result of the operation.
 */
const processProductUpload = async (fileBuffer, tenantId) => {
    if (!fileBuffer || !tenantId) {
        return { success: false, message: 'File buffer and tenant ID are required.', count: 0 };
    }

    try {
        const workbook = xlsx.read(fileBuffer, { type: 'buffer' });
        const sheetName = workbook.SheetNames[0];
        const productJSON = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName]);

        if (productJSON.length === 0) {
            return { success: false, message: 'The Excel file is empty or in an invalid format.', count: 0 };
        }

        const productsToInsert = [];

        for (const product of productJSON) {
            // Combine relevant fields to create a rich text for embedding.
            const name  = String(product.name ?? '').trim();
            const desc  = String(product.description ?? '').trim();
            const price = isNaN(Number(product.price)) ? null : Number(product.price);
            const embeddingText = `Product: ${name}. Description: ${desc}. Price: ${price ?? ''}.`;
            
            const embedding = await generateEmbedding(embeddingText);
            if (!embedding) {
                console.warn(`Could not generate embedding for product: ${product.name}. Skipping.`);
                continue; // Skip this product if embedding fails
            }

            productsToInsert.push({
                tenant_id: tenantId,
                name,
                description: desc,
                price,
                technical_details: (() => {
                    const raw = product.technical_details;
                    if (!raw) return null;
                    if (typeof raw === 'object') return raw;
                    try { return JSON.parse(raw); } catch { return { raw }; }  // don't fail the whole row
                })(),
                image_url: product.image_url ? String(product.image_url).trim() : null,
                embedding: embedding,
            });
        }

        if (productsToInsert.length === 0) {
             return { success: false, message: 'No valid products could be processed from the file.', count: 0 };
        }

        // Bulk insert all processed products into the database.
        const { error } = await dbClient.from('products').insert(productsToInsert);

        if (error) {
            throw error;
        }

        return {
            success: true,
            message: `Successfully uploaded and processed ${productsToInsert.length} products.`,
            count: productsToInsert.length,
        };

    } catch (error) {
        console.error('Error processing product upload:', error.message);
        // Check for specific JSON parsing error
        if (error instanceof SyntaxError) {
             return { success: false, message: 'Failed to process products. Please ensure the technical_details column contains valid JSON.', count: 0 };
        }
        return { success: false, message: `An error occurred: ${error.message}`, count: 0 };
    }
};

/**
 * Downloads and processes Excel file from URL (webhook version)
 */
const processProductSheet = async (tenantId, fileUrl, fromPhone) => {
    try {
        console.log(`[PRODUCT] Downloading file from: ${fileUrl}`);
        
        // Download file from URL
        const response = await fetch(fileUrl);
        if (!response.ok) {
            throw new Error(`Failed to download file: ${response.status}`);
        }
        
        const fileBuffer = await response.buffer();
        console.log(`[PRODUCT] File downloaded, size: ${fileBuffer.length} bytes`);
        
        // Process the file
        const result = await processProductUpload(fileBuffer, tenantId);
        
        // Send WhatsApp response
        if (result.success) {
            await sendMessage(fromPhone, result.message);
            console.log(`[PRODUCT] Success: ${result.count} products uploaded`);
        } else {
            await sendMessage(fromPhone, `Product upload failed: ${result.message}`);
            console.error(`[PRODUCT] Failed: ${result.message}`);
        }
        
        return result;
        
    } catch (error) {
        console.error('[PRODUCT] Error in processProductSheet:', error.message);
        const errorMsg = `Product upload failed: ${error.message}`;
        await sendMessage(fromPhone, errorMsg);
        return { success: false, message: errorMsg, count: 0 };
    }
};

/**
 * Calculate tiered pricing based on quantity
 * @param {object} product - Product object with base price
 * @param {number} quantity - Quantity being ordered
 * @returns {number} - Calculated price per unit based on tier
 */
const calculateTieredPrice = (product, quantity) => {
    try {
        if (!product || !product.price || !quantity || quantity <= 0) {
            console.warn('[PRODUCT_PRICING] Invalid parameters for tiered pricing calculation');
            return product?.price || 0;
        }

        const tiers = [
            { min: 1, max: 10, price: product.price, discount: 0 },
            { min: 11, max: 50, price: product.price * 0.95, discount: 5 }, // 5% discount
            { min: 51, max: 999, price: product.price * 0.90, discount: 10 }  // 10% discount
        ];
        
        const tier = tiers.find(t => quantity >= t.min && quantity <= t.max);
        
        if (tier) {
            console.log(`[PRODUCT_PRICING] Applied ${tier.discount}% discount for quantity ${quantity}`);
            return tier.price;
        }
        
        // For quantities above 999, apply maximum discount
        if (quantity >= 1000) {
            console.log(`[PRODUCT_PRICING] Applied maximum 10% discount for quantity ${quantity}`);
            return product.price * 0.90;
        }
        
        console.log(`[PRODUCT_PRICING] No tier matched, using base price for quantity ${quantity}`);
        return product.price;
        
    } catch (error) {
        console.error('[PRODUCT_PRICING] Error calculating tiered price:', error.message);
        return product?.price || 0;
    }
};

/**
 * Extract order details with product variants from user query
 * @param {string} userQuery - User message containing order information
 * @returns {object} - Extracted order details with variant information
 */
const extractOrderWithVariants = (userQuery) => {
    try {
        console.log('[PRODUCT_VARIANT] Extracting order with variants from:', userQuery);

        // Pattern for variants like "10x100 red color 5 cartons"
        const variantPattern = /(\d+x\d+)\s+(red|blue|green|steel|aluminum|white|black|grey|gray|yellow|orange|purple|pink|brown)\s+.*?(\d+)\s*(ctns?|cartons?)/i;
        
        const match = userQuery.match(variantPattern);
        
        if (match) {
            const [fullMatch, dimensions, color, quantity, unit] = match;
            
            console.log('[PRODUCT_VARIANT] Variant pattern matched:', {
                fullMatch,
                dimensions,
                color,
                quantity,
                unit
            });

            return {
                success: true,
                hasVariants: true,
                dimensions: dimensions,
                color: color.toLowerCase(),
                quantity: parseInt(quantity),
                unit: unit.toLowerCase(),
                originalText: fullMatch,
                extractedFrom: userQuery
            };
        }

        // Fallback to basic quantity extraction if no variant pattern matches
        const basicPattern = /(\d+)\s*(ctns?|cartons?|pcs?|pieces?|units?)/i;
        const basicMatch = userQuery.match(basicPattern);
        
        if (basicMatch) {
            const [fullMatch, quantity, unit] = basicMatch;
            
            console.log('[PRODUCT_VARIANT] Basic quantity pattern matched:', {
                fullMatch,
                quantity,
                unit
            });

            return {
                success: true,
                hasVariants: false,
                quantity: parseInt(quantity),
                unit: unit.toLowerCase(),
                originalText: fullMatch,
                extractedFrom: userQuery
            };
        }

        console.log('[PRODUCT_VARIANT] No order pattern detected in query');
        return {
            success: false,
            hasVariants: false,
            reason: 'no_pattern_matched',
            extractedFrom: userQuery
        };

    } catch (error) {
        console.error('[PRODUCT_VARIANT] Error extracting order with variants:', error.message);
        return {
            success: false,
            hasVariants: false,
            error: error.message,
            extractedFrom: userQuery
        };
    }
};

/**
 * Send product information with image support
 * @param {string} to - Phone number to send to
 * @param {object} product - Product object with name, price, description, and optional image_url
 */
const sendProductWithImage = async (to, product) => {
    try {
        if (product.image_url) {
            const imageMessage = {
                image: { url: product.image_url },
                caption: `${product.name}\nPrice: ₹${product.price}\n${product.description}`
            };
            await sendMessage(to, imageMessage);
        } else {
            // Fallback to text-only
            await sendMessage(to, `${product.name}\nPrice: ₹${product.price}`);
        }
    } catch (error) {
        console.error('[PRODUCT] Error sending product with image:', error.message);
        // Fallback to text-only on error
        await sendMessage(to, `${product.name}\nPrice: ₹${product.price}`);
    }
};

module.exports = {
    processProductUpload,
    generateEmbedding,
    processProductSheet,
    getAllProducts,        // 🔧 FIXED: Now exported - this is what the bot needs!
    searchProducts,        // 🎯 NEW: Smart product search
    getProductStats,       // 📊 NEW: Product catalog statistics
    calculateTieredPrice,  // 💰 NEW: Tiered pricing with bulk discounts
    extractOrderWithVariants, // 🔄 NEW: Extract orders with variant support
    sendProductWithImage   // 🖼️ NEW: Send products with image support
};

