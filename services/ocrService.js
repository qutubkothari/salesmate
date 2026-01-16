// Create: services/ocrService.js

const { openai } = require('./config');
const { dbClient } = require('./config');

/**
 * Extract text from image using OpenAI Vision API
 * @param {string} imageUrl - URL of the image
 * @returns {Promise<string>} - Extracted text
 */
const extractTextFromImage = async (imageUrl) => {
    try {
        console.log('[OCR] Extracting text from image:', imageUrl);
        
        const response = await openai.chat.completions.create({
            model: "gpt-4o",
            messages: [
                {
                    role: "user",
                    content: [
                        {
                            type: "text",
                            text: `Analyze this image and extract information:

1. If there is VISIBLE TEXT (product codes, model numbers, brand names, specifications, labels), list them exactly as shown, separated by spaces.

2. If there is NO VISIBLE TEXT, describe what you see:
   - Product type (e.g., "plastic container", "bottle", "packaging material")
   - Color, shape, size indicators
   - Any identifying features (logo, design, structure)
   - Return in format: "VISUAL: [description]"

3. For shipping/logistics documents, extract LR numbers, tracking codes, transporter names.

Return ONLY the extracted text OR visual description. If completely unclear, return "UNCLEAR".`
                        },
                        {
                            type: "image_url",
                            image_url: {
                                url: imageUrl
                            }
                        }
                    ]
                }
            ],
            max_tokens: 500,
            temperature: 0.1
        });

        const extractedText = response.choices[0]?.message?.content || '';
        console.log('[OCR] Extracted text:', extractedText);
        
        return extractedText;
    } catch (error) {
        console.error('[OCR] Text extraction failed:', error.message);
        return '';
    }
};

/**
 * Search products by extracted text
 * @param {string} tenantId - Tenant ID
 * @param {string} extractedText - Text extracted from image
 * @returns {Promise<Array>} - Matching products
 */
const searchProductsByText = async (tenantId, extractedText) => {
    if (!extractedText || extractedText.length < 2) {
        return [];
    }

    try {
        console.log('[PRODUCT_SEARCH] Searching for:', extractedText);
        
        // Split text into searchable terms
        const searchTerms = extractedText
            .toLowerCase()
            .replace(/^visual:\s*/i, '') // Remove VISUAL: prefix
            .replace(/[^\w\s]/g, ' ') // Remove all punctuation and special characters
            .split(/\s+/)
            .filter(term => term.length >= 2)
            .filter(term => !/^(the|and|or|of|in|on|at|to|for|with|by|a|an|is|are|i'm|sorry|can't|extract|from|this|image)$/i.test(term));

        console.log('[PRODUCT_SEARCH] Search terms:', searchTerms);

        // Build search query for multiple terms
        const searchConditions = searchTerms.map(term => 
            `name.ilike.%${term}%,description.ilike.%${term}%,sku.ilike.%${term}%`
        ).join(',');

        const { data: products, error } = await dbClient
            .from('products')
            .select('*')
            .eq('tenant_id', tenantId)
            .eq('is_active', true)
            .or(searchConditions)
            .limit(5);

        if (error) {
            console.error('[PRODUCT_SEARCH] Database error:', error.message);
            return [];
        }

        // Score products by relevance
        const scoredProducts = products.map(product => {
            let score = 0;
            const productText = `${product.name} ${product.description} ${product.sku || ''}`.toLowerCase();
            
            searchTerms.forEach(term => {
                if (productText.includes(term)) {
                    score += 1;
                    // Bonus for exact matches in name
                    if (product.name.toLowerCase().includes(term)) {
                        score += 2;
                    }
                    // Bonus for SKU matches
                    if (product.sku && product.sku.toLowerCase().includes(term)) {
                        score += 3;
                    }
                }
            });
            
            return { ...product, relevanceScore: score };
        });

        // Sort by relevance and filter out low scores
        const relevantProducts = scoredProducts
            .filter(p => p.relevanceScore > 0)
            .sort((a, b) => b.relevanceScore - a.relevanceScore);

        console.log('[PRODUCT_SEARCH] Found products:', relevantProducts.length);
        return relevantProducts;

    } catch (error) {
        console.error('[PRODUCT_SEARCH] Search failed:', error.message);
        return [];
    }
};

/**
 * Identify product from customer image
 * @param {string} imageUrl - URL of customer's image
 * @param {string} tenantId - Tenant ID
 * @returns {Promise<Object>} - Product identification result
 */
const identifyProductFromImage = async (imageUrl, tenantId) => {
    try {
        // Extract text using OCR
        const extractedText = await extractTextFromImage(imageUrl);
        
        if (!extractedText) {
            return {
                found: false,
                reason: 'no_text_extracted',
                message: 'Could not extract any text from the image'
            };
        }

        // ⭐ CHECK FOR SHIPPING/LR NUMBERS FIRST (before product search)
        const textLower = extractedText.toLowerCase();
        const shippingIndicators = ['vrl', 'logistics', 'consignment', 'docket', 'lr no', 'awb', 'waybill'];
        const hasShippingIndicator = shippingIndicators.some(indicator => textLower.includes(indicator));
        
        // Look for LR number pattern (typically 10 digits)
        const lrPattern = /\b\d{10,12}\b/g;
        const lrMatches = extractedText.match(lrPattern);
        
        if (hasShippingIndicator && lrMatches && lrMatches.length > 0) {
            console.log('[OCR] Detected shipping document with LR numbers:', lrMatches);
            return {
                found: true,
                isShippingSlip: true,
                lrNumber: lrMatches[0], // First match is usually the LR number
                extractedText,
                confidence: 'high',
                message: 'Shipping slip detected',
                method: 'ocr_lr_detection'
            };
        }

        // Search products
        const matchingProducts = await searchProductsByText(tenantId, extractedText);

        // Check if this is a visual description (no actual text extracted)
        const isVisualDescription = extractedText.toUpperCase().startsWith('VISUAL:');

        if (matchingProducts.length === 0) {
            return {
                found: false,
                reason: 'no_matches',
                extractedText,
                isVisualDescription,
                message: 'No matching products found for the extracted text'
            };
        }

        const topMatch = matchingProducts[0];

        // For visual descriptions, require higher relevance score
        // For actual text extraction, lower threshold is acceptable
        const highThreshold = isVisualDescription ? 8 : 5;
        const mediumThreshold = isVisualDescription ? 5 : 3;

        const confidence = topMatch.relevanceScore >= highThreshold ? 'high' :
                          topMatch.relevanceScore >= mediumThreshold ? 'medium' : 'low';

        return {
            found: true,
            confidence,
            extractedText,
            products: matchingProducts,
            topMatch,
            isVisualDescription,
            method: isVisualDescription ? 'visual_matching' : 'ocr_text_matching'
        };

    } catch (error) {
        console.error('[PRODUCT_IDENTIFICATION] Failed:', error.message);
        return {
            found: false,
            reason: 'processing_error',
            error: error.message
        };
    }
};

module.exports = {
    extractTextFromImage,
    searchProductsByText,
    identifyProductFromImage
};

