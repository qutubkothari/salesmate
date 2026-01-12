const { dbClient } = require('./config');
const { formatPersonalizedPriceDisplay, createPriceMessage } = require('./pricingDisplayService');
const { searchWebsiteForQuery, isProductInfoQuery } = require('./websiteContentIntegration');

/**
 * Auto-learn verified answer by storing it in tenant documents
 * This creates a knowledge base entry that can be retrieved later
 */
async function autoLearnVerifiedAnswer({ tenantId, question, answer, sources = [], createdBy = 'bot_auto' }) {
    try {
        const q = String(question || '').trim();
        const a = String(answer || '').trim();
        
        if (!tenantId || !q || !a) return;
        if (q.length < 5 || a.length < 10) return; // Skip trivial Q&A
        
        // Skip context-dependent queries (greetings, cart ops, etc.)
        const contextDependent = /^(hi|hello|hey|thanks|add|remove|cart|order|buy|checkout|yes|no|ok)\b/i.test(q);
        if (contextDependent) return;
        
        const clippedAnswer = a.length > 1400 ? `${a.slice(0, 1400)}…` : a;
        const sourcesText = Array.isArray(sources) && sources.length > 0 
            ? `\n\nSources: ${sources.slice(0, 5).join(', ')}` 
            : '';
        
        const learnedText = `Question: ${q}\n\nAnswer: ${clippedAnswer}${sourcesText}\n\n[Auto-learned by bot from verified response]`;
        const filename = `auto-learned-${Date.now()}-${Math.random().toString(36).slice(2, 9)}.txt`;
        
        await dbClient
            .from('tenant_documents')
            .insert({
                tenant_id: tenantId,
                original_name: `Bot Auto-Learning: ${q.slice(0, 100)}`,
                filename: filename,
                extracted_text: learnedText,
                created_at: new Date().toISOString()
            });
        
        console.log('[AUTO_LEARN] Stored verified answer for:', q.slice(0, 80));
    } catch (e) {
        console.error('[AUTO_LEARN] Failed to store:', e?.message || e);
    }
}

async function buildTenantDocumentsContext(tenantId, userQuery, { limit = 2 } = {}) {
    try {
        const q = String(userQuery || '').trim();
        if (!tenantId || q.length < 3) return null;

        const needle = q.slice(0, 120).replace(/%/g, '').trim();
        if (!needle) return null;

        const { data: docs, error } = await dbClient
            .from('tenant_documents')
            .select('id, original_name, filename, extracted_text, created_at')
            .eq('tenant_id', tenantId)
            .or(`original_name.ilike.%${needle}%,filename.ilike.%${needle}%,extracted_text.ilike.%${needle}%`)
            .order('created_at', { ascending: false })
            .limit(limit);

        if (error) {
            console.error('[SMART_ROUTER][DOCS] Search error:', error.message || error);
            return null;
        }

        const rows = (docs || []).filter(d => (d.extracted_text || '').trim().length > 0);
        if (!rows.length) return null;

        const snippets = rows.map((d, idx) => {
            const name = d.original_name || d.filename || 'document';
            const text = String(d.extracted_text || '').trim().slice(0, 1500);
            return `[Document ${idx + 1}: ${name}]\n${text}`;
        }).join('\n\n---\n\n');

        return `--- TENANT DOCUMENTS (Uploaded Knowledge) ---\n${snippets}\n--- END TENANT DOCUMENTS ---`;
    } catch (e) {
        console.error('[SMART_ROUTER][DOCS] Build context failed:', e?.message || e);
        return null;
    }
}

/**
 * ðŸ¤– AI INTELLIGENCE LAYER
 * Analyzes queries without hardcoded patterns
 */
const analyzeQueryWithAI = async (userQuery, tenantId) => {
    try {
        const { openai } = require('./config');
        const FAST_MODEL = process.env.AI_MODEL_FAST || 'grok-code-fast-1';
        
        const analysis = await openai.chat.completions.create({
            model: FAST_MODEL,
            messages: [{
                role: 'system',
                content: `Analyze this customer query and extract:

1. Intent: "price_inquiry" | "order_request" | "availability_check" | "discount_request" | "general"
2. Query Type: 
   - "product_category": Brand/category queries (NFF, Nylon, anchors) OR "all products" OR "latest prices for all"
   - "specific_products": Specific product codes (8x80, 10x100)
3. Products/terms mentioned
4. Quantities if any

CRITICAL RULES:
- "8x80 10" or "8x80 5" (product code + number) = intent: "price_inquiry", extract product and quantity
- "NFF" alone OR "NFF prices" OR "order NFF" OR "latest prices for NFF" = queryType: "product_category"
- "give me all NFF products" = queryType: "product_category"
- "I want to order NFF" = queryType: "product_category" (show catalog first, not place order)
- ANY brand name without specific product code = "product_category"
- If user says "order [brand]" or "want [brand]", intent is still "price_inquiry" (show catalog first)
- Simple "8x80" alone = intent: "price_inquiry", queryType: "specific_products"

Respond in JSON:
{
  "intent": "price_inquiry",
  "queryType": "specific_products",
  "searchTerms": ["8x80"],
  "quantities": [{"product": "8x80", "quantity": 10, "unit": "cartons"}],
  "confidence": 0.95,
  "reasoning": "User asking for price/quote of 8x80 with quantity 10"
}`
            }, {
                role: 'user',
                content: userQuery
            }],
            response_format: { type: 'json_object' },
            temperature: 0.2
        });
        
        const result = JSON.parse(analysis.choices[0].message.content);
        console.log('[AI_ANALYSIS]', result);
        return result;
        
    } catch (error) {
        console.error('[AI_ANALYSIS] Error:', error.message);
        return null;
    }
};

/**
 * ðŸ” AI-POWERED PRODUCT SEARCH
 * Finds products intelligently without hardcoded patterns
 */
const searchProductsWithAI = async (tenantId, searchTerm, queryType) => {
    try {
        console.log('[AI_SEARCH] Searching for:', searchTerm, 'Type:', queryType);

        // Split search term into individual keywords
        let searchTerms = [];
        if (queryType === 'product_category') {
            searchTerms = searchTerm.toLowerCase().split(/\s+/).filter(t => t.length > 2);
            console.log('[AI_SEARCH] Split category search into terms:', searchTerms);
        } else {
            searchTerms = [searchTerm.toLowerCase()];
        }

        // Get all active products with ALL searchable fields
        const { data: allProducts } = await dbClient
            .from('products')
            .select('id, name, description, price, packaging_unit, units_per_carton, technical_details, category, subcategory, search_keywords')
            .eq('tenant_id', tenantId)
            .eq('is_active', true)
            .gt('price', 0)
            .order('name');

        if (!allProducts || allProducts.length === 0) {
            console.log('[AI_SEARCH] No products in database');
            return [];
        }

        console.log('[AI_SEARCH] Checking', allProducts.length, 'products against search terms:', searchTerms);

        // Enhanced matching: whole and partial terms
        let matchedProducts = allProducts.filter(product => {
            const searchableText = [
                product.name || '',
                product.description || '',
                product.category || '',
                product.subcategory || '',
                Array.isArray(product.search_keywords) ? product.search_keywords.join(' ') : (product.search_keywords || ''),
                product.technical_details?.type || '',
                typeof product.technical_details === 'string' ? product.technical_details : ''
            ].join(' ').toLowerCase();

            // Match whole or partial terms
            const matches = searchTerms.some(term => {
                return searchableText.includes(term) ||
                    searchableText.split(/\s+/).some(word => word.startsWith(term));
            });

            if (matches) {
                console.log(`[AI_SEARCH] âœ… Product "${product.name}" matched for terms:`, searchTerms);
            }
            return matches;
        });

        // Fallback: if no matches, try single-term search
        if (matchedProducts.length === 0 && searchTerms.length > 1) {
            console.log('[AI_SEARCH] No multi-term matches, trying single-term fallback...');
            matchedProducts = allProducts.filter(product => {
                const searchableText = [
                    product.name || '',
                    product.description || '',
                    product.category || '',
                    product.subcategory || '',
                    Array.isArray(product.search_keywords) ? product.search_keywords.join(' ') : (product.search_keywords || ''),
                    product.technical_details?.type || '',
                    typeof product.technical_details === 'string' ? product.technical_details : ''
                ].join(' ').toLowerCase();
                return searchTerms.some(term => searchableText.includes(term));
            });
        }

        console.log('[AI_SEARCH] Search terms:', searchTerms);
        console.log('[AI_SEARCH] Found', matchedProducts.length, 'matching products:', matchedProducts.map(p => p.name));

        if (matchedProducts.length > 0) {
            console.log('[AI_SEARCH] Sample matches:', matchedProducts.slice(0, 3).map(p => p.name));
        }

        return matchedProducts;

    } catch (error) {
        console.error('[AI_SEARCH] Error:', error.message);
        return [];
    }
};

/**
 * âœï¸ AI-POWERED RESPONSE GENERATION
 * Creates natural responses without templates
 */
const generateResponseWithAI = async (products, userQuery) => {
    try {
        const { openai } = require('./config');
        
        const generation = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [{
                role: 'system',
                content: `Create a professional sales response showing product pricing.

STYLE:
- Use emojis: ðŸ“¦ ðŸ’° ðŸ”¹ âœ…
- Show per-piece AND per-carton pricing clearly
- Format: â‚¹XX.XX/pc, â‚¹XX/carton
- Clean list format if multiple products
- Add helpful call-to-action
- Be conversational but professional

IMPORTANT:
- Always end with "To order, reply with product code and quantity (e.g., '8x80 - 10 cartons')"
- Do NOT use phrases that trigger orders like "added to cart" or "place order"
- This is ONLY a price catalog, not an order confirmation

Keep it concise and scannable.`
            }, {
                role: 'user',
                content: `Query: "${userQuery}"

Products:
${products.map(p => {
    const perPiece = p.units_per_carton ? (p.price / p.units_per_carton).toFixed(2) : p.price;
    return `- ${p.name}: â‚¹${p.price}/carton (${p.units_per_carton || 1} pcs, â‚¹${perPiece}/pc)`;
}).join('\n')}`
            }],
            temperature: 0.7,
            max_tokens: 1000
        });
        
        return generation.choices[0].message.content;
        
    } catch (error) {
        console.error('[AI_GENERATE] Error:', error.message);
        // Fallback formatting
        let response = 'ðŸ’° **Latest Pricing Information:**\n\n';
        for (const p of products) {
            const perPiece = p.units_per_carton ? (p.price / p.units_per_carton).toFixed(2) : p.price;
            response += `ðŸ“¦ **${p.name}**\n`;
            response += `   ðŸ”¹ â‚¹${perPiece}/pc per piece\n`;
            response += `   ðŸ“¦ â‚¹${p.price}/${p.packaging_unit || 'carton'}\n`;
            response += `   (${p.units_per_carton || 1} pcs/${p.packaging_unit || 'carton'})\n\n`;
        }
        response += '\nâœ… To order, reply with product code and quantity (e.g., "8x80 - 10 cartons")';
        return response;
    }
};

/**
 * Calculate proper quote based on unit type
 */
const calculateQuoteAmount = (product, quantity, unit, isPieces) => {
    const unitsPerCarton = product.units_per_carton || 1;
    const pricePerCarton = product.price;
    
    if (isPieces || unit === 'pieces') {
        // Convert pieces to cartons for total
        const cartonsNeeded = quantity / unitsPerCarton;
        const totalAmount = cartonsNeeded * pricePerCarton;
        const pricePerPiece = pricePerCarton / unitsPerCarton;
        
        return {
            displayQuantity: quantity,
            displayUnit: 'pieces',
            cartonsEquivalent: cartonsNeeded.toFixed(2),
            pricePerUnit: pricePerPiece.toFixed(2),
            totalAmount: totalAmount.toFixed(2),
            calculation: `${quantity} pcs Ã· ${unitsPerCarton} Ã— â‚¹${pricePerCarton} = â‚¹${totalAmount.toFixed(2)}`
        };
    } else {
        // Cartons - direct calculation
        const totalAmount = quantity * pricePerCarton;
        
        return {
            displayQuantity: quantity,
            displayUnit: 'cartons',
            piecesEquivalent: quantity * unitsPerCarton,
            pricePerUnit: pricePerCarton.toFixed(2),
            totalAmount: totalAmount.toFixed(2),
            calculation: `${quantity} cartons Ã— â‚¹${pricePerCarton} = â‚¹${totalAmount.toFixed(2)}`
        };
    }
};

/**
 * Handle multi-product price inquiry with personalized pricing
 */
const handleMultiProductPriceInquiry = async (query, tenantId, phoneNumber = null, aiQuantities = null) => {
    try {
        console.log('[MULTI_PRODUCT] Processing multi-product price inquiry:', query);
        console.log('[MULTI_PRODUCT] Customer phone:', phoneNumber || 'Not provided');
        
        // Extract all product codes and their quantities from the query
        // Patterns: "8x80 10", "8x100 5 cartons", "8x120 2 ctns", etc.
        const productCodes = (query.match(/\d+[x*]\d+/gi) || []).map(code => code.replace('*', 'x'));
        
        console.log('[MULTI_PRODUCT] Found product codes:', productCodes);
        
        if (productCodes.length === 0) {
            return null;
        }
        
        // Build a map of product code to quantity and unit
        const codeToQuantityMap = {};
        const codeToUnitMap = {};
        
        // First, use AI-detected quantities if available
        if (aiQuantities && Array.isArray(aiQuantities)) {
            console.log('[MULTI_PRODUCT] Using AI-detected quantities:', aiQuantities);
            for (const qtyInfo of aiQuantities) {
                const code = qtyInfo.product.replace('*', 'x');
                codeToQuantityMap[code] = qtyInfo.quantity;
                codeToUnitMap[code] = qtyInfo.unit || 'carton';
                console.log('[MULTI_PRODUCT] AI quantity for', code, ':', qtyInfo.quantity, qtyInfo.unit);
            }
        }
        
        // Fallback: extract quantities from query string for any missing codes
        for (const code of productCodes) {
            if (codeToQuantityMap[code] === undefined) {
                // Look for quantity and unit after this product code
                // Pattern: "8x80 10 pcs", "8x80: 10 cartons", "8x80 - 10 pieces", "8x80 25ctns"
                const codePattern = code.replace(/[x*]/g, '[x*]');
                const quantityUnitRegex = new RegExp(codePattern + '\\s*[:-]?\\s*(\\d+)\\s*(cartons?|ctns?|pcs?|pieces?)?', 'i');
                const match = query.match(quantityUnitRegex);
                if (match && match[1]) {
                    codeToQuantityMap[code] = parseInt(match[1]);
                    let unit = 'carton';
                    if (match[2]) {
                        const unitStr = match[2].toLowerCase();
                        if (unitStr.startsWith('pc')) unit = 'pcs';
                        else if (unitStr.startsWith('carton') || unitStr.startsWith('ctn')) unit = 'carton';
                    }
                    codeToUnitMap[code] = unit;
                    console.log('[MULTI_PRODUCT] Regex extracted quantity for', code, ':', match[1], unit);
                } else {
                    codeToQuantityMap[code] = 1; // Default to 1 if no quantity specified
                    codeToUnitMap[code] = 'carton'; // Default unit
                    console.log('[MULTI_PRODUCT] No quantity found for', code, '- defaulting to 1 carton');
                }
            }
        }
        
        const products = [];
        const quotedProducts = [];
        const foundProductIds = new Set();
        
        for (const code of productCodes) {
            console.log('[MULTI_PRODUCT] Looking up product:', code);
            const product = await findProductByCode(tenantId, code);
            
            if (product && !foundProductIds.has(product.id)) {
                console.log('[MULTI_PRODUCT] Found product:', product.name, 'for code:', code);
                foundProductIds.add(product.id);
                
                const quantity = codeToQuantityMap[code] || 1;
                const unit = codeToUnitMap[code] || 'carton';
                products.push({ ...product, requestedQuantity: quantity, requestedUnit: unit });
                
                quotedProducts.push({
                    productCode: code,
                    productName: product.name,
                    productId: product.id,
                    price: product.price,
                    quantity: quantity,
                    unit: unit,
                    unitsPerCarton: product.units_per_carton
                });
                
                console.log('[MULTI_PRODUCT] Added to quotedProducts with quantity:', quantity);
            } else if (product && foundProductIds.has(product.id)) {
                console.log('[MULTI_PRODUCT] Skipping duplicate product:', product.name);
            } else {
                console.log('[MULTI_PRODUCT] Product not found for code:', code);
            }
        }
        
        if (products.length === 0) {
            return "Sorry, I couldn't find any of those products in our catalog.";
        }
        
        // Check if this is a volume order (10k+ pieces)
        const hasVolumeOrder = products.some(p => 
            p.requestedUnit === 'pcs' && p.requestedQuantity >= 10000
        );
        
        // If single product WITHOUT volume order, use beautiful personalized format
        // For volume orders, always use the detailed pricing with discounts
        if (products.length === 1 && phoneNumber && !hasVolumeOrder) {
            console.log('[MULTI_PRODUCT] Single product without volume order - using simple personalized pricing');
            const priceDisplay = await formatPersonalizedPriceDisplay(tenantId, phoneNumber, products[0].id);
            if (priceDisplay) {
                const message = createPriceMessage(priceDisplay, true, query); // Pass originalQuery for quantity extraction
                return {
                    response: message,
                    quotedProducts: quotedProducts
                };
            }
        }
        
        // For volume orders or multiple products, use detailed pricing
        if (hasVolumeOrder) {
            console.log('[MULTI_PRODUCT] Volume order detected - using detailed pricing with discounts');
        } else {
            console.log('[MULTI_PRODUCT] Multiple products - using detailed pricing');
        }
        
        // Multiple products - show compact list with per-piece pricing and personalization
        let response = "ðŸ’° **Price Information:**\n\n";
        let hasAnyPersonalizedPrice = false;
        
        console.log('[MULTI_PRODUCT] Starting to process', products.length, 'products');
        console.log('[MULTI_PRODUCT] Phone number for personalization:', phoneNumber);
        
        for (const product of products) {
            const unitsPerCarton = parseInt(product.units_per_carton) || 1;
            const pricePerPiece = (product.price / unitsPerCarton).toFixed(2);
            const requestedQuantity = product.requestedQuantity || 1;
            const requestedUnit = product.requestedUnit || 'carton';
            
            console.log('[MULTI_PRODUCT] Processing product:', product.name, 'ID:', product.id, 'Quantity:', requestedQuantity);
            
            // Get personalized pricing if available
            let personalizedInfo = null;
            if (phoneNumber) {
                console.log('[MULTI_PRODUCT] Fetching personalized pricing for:', product.name);
                personalizedInfo = await formatPersonalizedPriceDisplay(tenantId, phoneNumber, product.id);
                console.log('[MULTI_PRODUCT] Personalized info result:', personalizedInfo ? 'Found' : 'Not found');
                if (personalizedInfo) {
                    console.log('[MULTI_PRODUCT] Last purchase price:', personalizedInfo.lastPurchasePrice);
                }
            } else {
                console.log('[MULTI_PRODUCT] No phone number - skipping personalization');
            }
            
            response += `ðŸ“¦ **${product.name}**\n`;
            
            // Determine the base price to use
            let basePrice = product.price;
            let priceSource = 'catalog';
            
            if (personalizedInfo && personalizedInfo.lastPurchasePrice) {
                basePrice = personalizedInfo.lastPurchasePrice;
                priceSource = 'personalized';
                hasAnyPersonalizedPrice = true;
            }
            
            const basePricePerPiece = (basePrice / unitsPerCarton).toFixed(2);
            
            // âœ… VOLUME DISCOUNT LOGIC
            let finalPrice = basePrice;
            let finalPricePerPiece = basePricePerPiece;
            let discountPercent = 0;
            let volumeDiscountApplied = false;
            
            // Check for volume discounts based on quantity
            if (requestedUnit === 'pcs' && requestedQuantity >= 10000) {
                // Large volume orders get automatic discount
                if (requestedQuantity >= 100000) {
                    discountPercent = 15; // 15% off for 1 lakh+ pieces
                } else if (requestedQuantity >= 50000) {
                    discountPercent = 12; // 12% off for 50k+ pieces
                } else if (requestedQuantity >= 25000) {
                    discountPercent = 10; // 10% off for 25k+ pieces
                } else if (requestedQuantity >= 10000) {
                    discountPercent = 7; // 7% off for 10k+ pieces
                }
                
                if (discountPercent > 0) {
                    finalPrice = basePrice * (1 - discountPercent / 100);
                    finalPricePerPiece = (finalPrice / unitsPerCarton).toFixed(2);
                    volumeDiscountApplied = true;
                }
            }
            
            // Show price information
            if (priceSource === 'personalized') {
                response += `âœ¨ Your Special Price:\n`;
            } else {
                response += `ðŸ’µ Price:\n`;
            }
            
            if (volumeDiscountApplied) {
                // Show volume discount prominently
                response += `ðŸŽ‰ **VOLUME DISCOUNT: ${discountPercent}% OFF**\n`;
                response += `ï¿½ ~~â‚¹${basePricePerPiece}/pc~~ â†’ **â‚¹${finalPricePerPiece}/pc** per piece\n`;
                response += `ðŸ“¦ ~~â‚¹${basePrice.toFixed(2)}~~ â†’ **â‚¹${finalPrice.toFixed(2)}/carton**\n`;
                response += `   (${unitsPerCarton} pcs/carton)\n`;
            } else {
                response += `ðŸ”¹ â‚¹${finalPricePerPiece}/pc per piece\n`;
                response += `ðŸ“¦ â‚¹${finalPrice.toFixed(2)}/carton\n`;
                response += `   (${unitsPerCarton} pcs/carton)\n`;
            }
            
            if (priceSource === 'personalized' && personalizedInfo.savingsAmount > 0 && !volumeDiscountApplied) {
                response += `ðŸ’° Saves â‚¹${personalizedInfo.savingsAmount.toFixed(2)} vs catalog\n`;
            }
            
            // Show quote for requested quantity if specified
            if (requestedQuantity >= 1) {
                let totalAmount, calculationText, cartonsNeeded;
                
                if (requestedUnit === 'pcs') {
                    // Pieces calculation
                    totalAmount = parseFloat(finalPricePerPiece) * requestedQuantity;
                    cartonsNeeded = Math.ceil(requestedQuantity / unitsPerCarton);
                    const totalCartonPrice = cartonsNeeded * finalPrice;
                    
                    response += `\nðŸ“Š **Quote for ${requestedQuantity.toLocaleString('en-IN')} pieces:**\n`;
                    response += `   ${requestedQuantity.toLocaleString('en-IN')} pcs Ã— â‚¹${finalPricePerPiece} = **â‚¹${totalAmount.toLocaleString('en-IN', {minimumFractionDigits: 2, maximumFractionDigits: 2})}**\n`;
                    response += `   (â‰ˆ ${cartonsNeeded.toLocaleString('en-IN')} cartons)\n`;
                    
                    if (volumeDiscountApplied) {
                        const savingsAmount = (parseFloat(basePricePerPiece) * requestedQuantity) - totalAmount;
                        response += `   ðŸ’° You save: â‚¹${savingsAmount.toLocaleString('en-IN', {minimumFractionDigits: 2, maximumFractionDigits: 2})} (${discountPercent}% off)\n`;
                    }
                } else {
                    // Cartons calculation
                    totalAmount = finalPrice * requestedQuantity;
                    const totalPieces = requestedQuantity * unitsPerCarton;
                    
                    response += `\nðŸ“Š **Quote for ${requestedQuantity.toLocaleString('en-IN')} cartons:**\n`;
                    response += `   ${requestedQuantity.toLocaleString('en-IN')} cartons Ã— â‚¹${finalPrice.toFixed(2)} = **â‚¹${totalAmount.toLocaleString('en-IN', {minimumFractionDigits: 2, maximumFractionDigits: 2})}**\n`;
                    response += `   (${totalPieces.toLocaleString('en-IN')} pieces total)\n`;
                    
                    if (volumeDiscountApplied) {
                        const savingsAmount = (basePrice * requestedQuantity) - totalAmount;
                        response += `   ï¿½ You save: â‚¹${savingsAmount.toLocaleString('en-IN', {minimumFractionDigits: 2, maximumFractionDigits: 2})} (${discountPercent}% off)\n`;
                    }
                }
            }
            
            response += `\n`;
        }
        
        // Calculate total if multiple products with quantities
        // IMPORTANT: totalCartons is actually total QUANTITY (could be pieces or cartons)
        const totalQuantity = products.reduce((sum, p) => sum + (p.requestedQuantity || 1), 0);
        const hasMultipleQuantities = products.some(p => (p.requestedQuantity || 1) > 1);
        
        // Calculate actual cartons for volume discount checks
        let actualCartonsTotal = 0;
        for (const product of products) {
            const qty = product.requestedQuantity || 1;
            const unit = product.requestedUnit || 'carton';
            if (unit === 'pcs' || unit === 'pieces') {
                // Convert pieces to cartons
                actualCartonsTotal += qty / (product.units_per_carton || 1);
            } else {
                actualCartonsTotal += qty;
            }
        }
        actualCartonsTotal = Math.ceil(actualCartonsTotal);
        
        if (hasMultipleQuantities && products.length > 1) {
            let grandTotal = 0;
            let totalUnits = 0;
            for (const product of products) {
                const qty = product.requestedQuantity || 1;
                const unit = product.requestedUnit || 'carton';
                if (unit === 'pcs' || unit === 'pieces') {
                    const pricePerPiece = product.price / (product.units_per_carton || 1);
                    grandTotal += pricePerPiece * qty;
                    totalUnits += qty / (product.units_per_carton || 1); // Convert to cartons for summary
                } else {
                    grandTotal += product.price * qty;
                    totalUnits += qty;
                }
            }
            
            response += `â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”\n`;
            response += `ðŸ“‹ **Total Summary:**\n`;
            response += `   ${totalUnits.toFixed(1)} cartons total\n`;
            response += `   Grand Total: â‚¹${grandTotal.toLocaleString('en-IN', {minimumFractionDigits: 2, maximumFractionDigits: 2})}\n\n`;
        }
        
        // Only show volume discount info for new customers (no personalized pricing)
        // Use actualCartonsTotal for accurate discount tier messaging
        if (!hasAnyPersonalizedPrice && actualCartonsTotal >= 11) {
            const discountPercent = actualCartonsTotal >= 100 ? '7-10%' : 
                                   actualCartonsTotal >= 51 ? '5-7%' :
                                   actualCartonsTotal >= 26 ? '3-5%' : '2-3%';
            response += `ðŸ’¡ **Volume Discount Eligible:** ${discountPercent} off for ${actualCartonsTotal} cartons!\n\n`;
        } else if (!hasAnyPersonalizedPrice) {
            response += "ðŸ’¡ **Volume Discounts Available:**\n";
            response += "â€¢ 11-25 cartons: 2-3% off\n";
            response += "â€¢ 26-50 cartons: 3-5% off\n";
            response += "â€¢ 51-100 cartons: 5-7% off\n";
            response += "â€¢ 100+ cartons: 7-10% off\n\n";
        }
        
        response += hasMultipleQuantities ? 
            "ðŸ›’ Ready to place this order? Just say 'yes' or 'add to cart'!" :
            "âœ… To order any of these products, just let me know the quantities!";
        
        console.log('[MULTI_PRODUCT] Returning', products.length, 'products');
        console.log('[MULTI_PRODUCT] â­ Final return value:', {
            hasResponse: !!response,
            hasQuotedProducts: !!quotedProducts,
            quotedProductsCount: quotedProducts.length,
            quotedProductsPreview: JSON.stringify(quotedProducts).substring(0, 200)
        });
        
        return {
            response: response,
            quotedProducts: quotedProducts
        };
        
    } catch (error) {
        console.error('[MULTI_PRICE_HANDLER] Error:', error.message);
        return null;
    }
};

/**
 * FIXED: Handle price queries without triggering order processing
 */
const handlePriceQueriesFixed = async (query, tenantId, phoneNumber = null) => {
    // [LOG] Processing price handler query
    const cleanQuery = query.toLowerCase().trim();
    console.log('[PRICE_HANDLER] Customer phone:', phoneNumber || 'Not provided');
    // === CRITICAL: Detect ORDER intent (not just price inquiry with quantity) ===
    // Only treat as order if it has CLEAR order keywords like "need", "want", "order", "buy", "chahiye"
    const hasOrderIntent = /(?:need|want|order|buy|place|chahiye|mangao|bhejo|send me)\s+\d+/i.test(cleanQuery);
    const hasQuantity = /(\d+)\s*(?:ctns?|cartons?|pcs|pieces)/i.test(cleanQuery);
    const hasPriceKeyword = /price|prices|rate|cost|kitna|best\s+price|final\s+price/i.test(cleanQuery);
    
    // If has ORDER intent with quantity (e.g., "I want 10 ctns"), skip price handler
    if (hasOrderIntent && hasQuantity && !hasPriceKeyword) {
    // [LOG] Order intent detected, treating as order
        return null; // Let order processing handle it
    }
    // === CRITICAL FIX: Detect "i need price for" patterns FIRST ===
    const explicitPricePatterns = [
        /^how\s+much\s+for\s+(.+)$/i,                    // "how much for 10000 pieces of 10x100"
        /^i\s+need\s+prices?\s+for\s+(.+)$/i,            // "i need price(s) for 8x80, 8x100"
        /^need\s+prices?\s+for\s+(.+)$/i,                // "need price(s) for 8x80" (without "i")
        /^i\s+want\s+prices?\s+for\s+(.+)$/i,            // "i want price(s) for 8x80"  
        /^want\s+prices?\s+for\s+(.+)$/i,                // "want price(s) for 8x80" (without "i")
        /^prices?\s+for\s+(.+)$/i,                       // "price(s) for 8x80, 8x100"
        /^give\s+me\s+(?:final|best|your)?\s*prices?\s+for\s+(.+)$/i,  // "give me final price for 8x80"
        /^tell\s+me\s+prices?\s+for\s+(.+)$/i,           // "tell me price(s) for 8x80"
        /^what\s+is\s+prices?\s+for\s+(.+)$/i,           // "what is price(s) for 8x80"
        /^what\s+are\s+prices?\s+for\s+(.+)$/i,          // "what are prices for 8x80"
        /^best\s+prices?\s+for\s+(.+)$/i,                // "best price(s) for 8x80" or "best price for 10x100"
        /^final\s+prices?\s+for\s+(.+)$/i,               // "final price for 8x80 100 ctns"
        /^(.+)\s+ki\s+prices?\s+chahiye$/i,              // "8x80, 8x100 ki price(s) chahiye"
        /^(.+)\s+ka\s+rate\s+batao$/i,                   // "8x80 ka rate batao"
    ];
    // Check explicit price patterns first
    for (const pattern of explicitPricePatterns) {
        const match = cleanQuery.match(pattern);
        if (match && match[1]) {
            const productPart = match[1].trim();
            // [LOG] Explicit price pattern matched
            // Check if it contains multiple products (comma separated)
            if (productPart.includes(',')) {
                // [LOG] Multi-product price inquiry detected
                // --- PATCHED LOGIC FOR MULTI-PRODUCT PRICE/ORDER INTENT ---
                // Check if explicitly asking for prices (has price keywords)
                const hasPriceKeywords = /price|prices|rate|cost|kitna|batao/i.test(productPart);
                // Simulate quantity/order intent detection (for demo, use >1 product as proxy)
                const quantity = (productPart.match(/\d+/g) || []).length;
                const hasOrderIntent = /order|buy|need|chahiye|mangao|bhejo|send|supply|purchase|le lo|lo/i.test(productPart);

                // Only treat as order if NO price keywords present
                if (!hasPriceKeywords && quantity > 1 && hasOrderIntent) {
                    // [LOG] Order intent detected, not a price inquiry
                    return null;
                }

                // Continue with price response if price keywords present
                // [LOG] Price inquiry with quantity
                const multiResult = await handleMultiProductPriceInquiry(productPart, tenantId, phoneNumber);
                console.log('[SMART_ROUTER] Multi-product result:', {
                    hasResult: !!multiResult,
                    isObject: typeof multiResult === 'object',
                    hasResponse: !!(multiResult && multiResult.response),
                    hasQuotedProducts: !!(multiResult && multiResult.quotedProducts),
                    quotedProductsLength: multiResult?.quotedProducts?.length || 0
                });
                if (multiResult && typeof multiResult === 'object' && multiResult.response) {
                    console.log('[SMART_ROUTER] âœ… Returning structured response with quotedProducts');
                    return multiResult; // Return structured response with quotedProducts
                }
                return multiResult;
            }
            // Single product price inquiry
            const productCode = productPart.match(/(\d+[x*]\d+)/i);
            if (productCode) {
                const code = productCode[1].replace('*', 'x');
                const product = await findProductByCode(tenantId, code);
                if (product) {
                    const priceMessage = await formatProductPrice(product, tenantId, phoneNumber, cleanQuery);
                    
                    // Extract quantity from query if mentioned
                    const quantityMatch = cleanQuery.match(/(\d+)\s*(?:pcs?|pieces?|cartons?|ctns?)/i);
                    let quantity = 1;
                    let unit = 'carton';
                    
                    if (quantityMatch) {
                        const extractedQty = parseInt(quantityMatch[1]);
                        const extractedUnit = quantityMatch[0].match(/cartons?|ctns?/i) ? 'cartons' : 'pieces';
                        
                        // Convert pieces to cartons if needed
                        if (extractedUnit === 'pieces') {
                            const unitsPerCarton = parseInt(product.units_per_carton) || 1;
                            quantity = Math.ceil(extractedQty / unitsPerCarton);
                            unit = 'carton';
                            console.log(`[QUANTITY_CALC] Converted ${extractedQty} pieces to ${quantity} cartons (${unitsPerCarton} pcs/carton)`);
                        } else {
                            quantity = extractedQty;
                            unit = 'carton';
                        }
                    }
                    
                    console.log(`[QUOTED_PRODUCT_SAVE] Saving quotedProduct with quantity:`, quantity, 'type:', typeof quantity);
                    
                    // Quick Test
                    console.log('ðŸ” QUOTE DEBUG:', {
                        quantity: quantity,
                        unit: unit,
                        isPieces: unit === 'pieces',
                        calculation: unit === 'pieces' ? 
                            `${quantity} pieces` : 
                            `${quantity} cartons`
                    });
                    
                    // Return structured response with quotedProducts for context-based ordering
                    return {
                        response: priceMessage,
                        source: 'product_price',
                        quotedProducts: [{
                            productCode: code,
                            productName: product.name,
                            productId: product.id,
                            price: product.price,
                            quantity: quantity,
                            unit: unit,
                            unitsPerCarton: product.units_per_carton
                        }]
                    };
                } else {
                    return `Sorry, I couldn't find product "${code}" in our catalog. Please check the product code.`;
                }
            }
        }
    }
    // === ENHANCED MULTI-PRODUCT DETECTION ===
    // Detect patterns like "8x80, 8x100" with price keywords
    const productCodesInQuery = (cleanQuery.match(/\d+[x*]\d+/g) || []).map(code => code.replace('*', 'x'));
    const hasPriceKeywords = /price|rate|cost|kitna|batao|chahiye/.test(cleanQuery);
    const hasMultipleProducts = productCodesInQuery.length > 1;
    if (hasMultipleProducts && hasPriceKeywords) {
    // [LOG] Multi-product with price keywords detected
        const multiResult = await handleMultiProductPriceInquiry(cleanQuery, tenantId, phoneNumber);
        if (multiResult && typeof multiResult === 'object' && multiResult.response) {
            return multiResult;
        }
        return multiResult;
    }
    // === ORDER EXCLUSION PATTERNS (More Aggressive) ===
    const orderPatterns = [
        /i\s+need\s+\d+\s+(?:cartons|ctns|pieces|pcs)/i,  // "i need 5 cartons"
        /mujhe\s+\d+\s+(?:cartons|ctns)\s+chahiye/i,       // "mujhe 5 ctns chahiye"
        /\d+\s+ctns?\s+each/i,                              // "5 ctns each"
        /each\s+\d+\s+ctns?/i,                             // "each 5 ctns"
        /order\s+\d+/i,                                     // "order 10"
        /add\s+\d+/i,                                       // "add 5"
    ];
    // Test for order exclusions
    for (const pattern of orderPatterns) {
        if (pattern.test(cleanQuery)) {
            // [LOG] Order pattern detected, excluding from price handling
            return null;
        }
    }
    // Rest of existing logic for other price patterns...
    const priceOnlyPatterns = [
        /^(?:price|pricing|cost|rate|kitna|kya rate).*(?:chahiye|batao|bata|tell|give|hai)$/i,
        /^(?:chahiye|batao|bata|tell|give).*(?:price|pricing|cost|rate)$/i,
        /^.*(?:price|rate|cost).*(?:chahiye|batao|bata)(?:\s+(?:bhai|sir|ji))?$/i,
        /^(?:kya|kitna).*(?:price|rate|cost).*hai$/i,
        /^prices?\s+chahiye$/i,
        /^rate\s+(?:chahiye|batao)$/i,
        // Product-specific price queries
        /^(?:price|cost|rate|best\s+price).*(?:of|for)\s*(\d+[x*]\d+)(?:\s+(?:chahiye|batao|hai))?$/i,  // Added "best price"
        /^(\d+[x*]\d+).*(?:price|cost|rate)(?:\s+(?:chahiye|batao|hai))?$/i,
        /^(?:how much|kitna).*(\d+[x*]\d+)(?:\s+(?:chahiye|hai))?$/i,
        /^(\d+[x*]\d+).*(?:ka|ka price|kitna)(?:\s+(?:chahiye|hai))?$/i,
    ];
    let productCode = null;
    for (let i = 0; i < priceOnlyPatterns.length; i++) {
        const pattern = priceOnlyPatterns[i];
        const match = cleanQuery.match(pattern);
        if (match) {
            if (match[1]) {
                productCode = match[1].replace('*', 'x');
            }
            // [LOG] Price pattern matched for productCode
            break;
        }
    }
    if (!productCode && !priceOnlyPatterns.some(pattern => pattern.test(cleanQuery))) {
    // [LOG] No price patterns matched, returning null
        return null;
    }
    // Handle specific product or general pricing
    if (productCode) {
        const product = await findProductByCode(tenantId, productCode);
        if (product) {
            const priceMessage = await formatProductPrice(product, tenantId, phoneNumber, cleanQuery);
            
            // Extract quantity from query if mentioned
            const quantityMatch = cleanQuery.match(/(\d+)\s*(?:pcs?|pieces?|cartons?|ctns?)/i);
            let quantity = 1;
            let unit = 'carton';
            
            if (quantityMatch) {
                const extractedQty = parseInt(quantityMatch[1]);
                const extractedUnit = quantityMatch[0].match(/cartons?|ctns?/i) ? 'cartons' : 'pieces';
                
                // Convert pieces to cartons if needed
                if (extractedUnit === 'pieces') {
                    const unitsPerCarton = parseInt(product.units_per_carton) || 1;
                    quantity = Math.ceil(extractedQty / unitsPerCarton);
                    unit = 'carton';
                    console.log(`[QUANTITY_CALC_FALLBACK] Converted ${extractedQty} pieces to ${quantity} cartons (${unitsPerCarton} pcs/carton)`);
                } else {
                    quantity = extractedQty;
                    unit = 'carton';
                }
            }
            
            console.log(`[QUOTED_PRODUCT_SAVE_FALLBACK] Saving quotedProduct with quantity:`, quantity, 'type:', typeof quantity);
            
            // Return object with quotedProducts for context-based ordering
            return {
                response: priceMessage,
                source: 'product_price',
                quotedProducts: [{
                    productCode: productCode,
                    productName: product.name,
                    productId: product.id,
                    price: product.price,
                    quantity: quantity,
                    unit: unit,
                    unitsPerCarton: product.units_per_carton
                }]
            };
        } else {
            return `Sorry, I couldn't find product "${productCode}" in our catalog. Please check the product code.`;
        }
    }
    return await handleGeneralPriceInquiry(tenantId, query, phoneNumber);
};

/**
 * AI-POWERED: Intelligent query understanding (no regex, pure AI)
 */
const getSmartResponse = async (userQuery, tenantId, phoneNumber = null) => {
    console.log('[SMART_ROUTER] AI-powered processing for:', userQuery);
    console.log('[SMART_ROUTER] Customer phone:', phoneNumber || 'Not provided');

    // Fast-path: greetings - USE AI FOR PERSONALIZED RESPONSE
    // Disabled static greetings in favor of AI-powered human-like responses
    // AI will handle greetings with context awareness and personalization
    // The AI system remembers conversation context and provides intelligent greetings

    // Fast-path: product catalog / product overview queries.
    // Avoids falling into clarification loops when the user clearly asks what products are available.
    try {
        const q = String(userQuery || '').toLowerCase().trim();
        const looksLikeCatalogQuery = (
            q === 'catalog' ||
            q === 'products' ||
            q === 'product list' ||
            /\b(products?|catalog|items)\b/.test(q) && /\b(have|available|show|list|what|wha|which|menu)\b/.test(q)
        );

        if (looksLikeCatalogQuery && tenantId) {
            console.log('[SMART_ROUTER][FASTPATH] Catalog query detected');
            const { data: products, error } = await dbClient
                .from('products')
                .select('id, name, sku, description, price, packaging_unit, units_per_carton')
                .eq('tenant_id', tenantId)
                .order('created_at', { ascending: false })
                .limit(15);

            if (error) {
                console.error('[SMART_ROUTER][CATALOG] Fetch error:', error.message || error);
            }

            const rows = Array.isArray(products) ? products : [];
            if (!rows.length) {
                return {
                    response: `We don't have any products uploaded in the catalog right now.\n\nPlease ask the admin to upload the product list, or tell me what item you need and Iâ€™ll help you.`,
                    source: 'catalog_empty'
                };
            }

            let msg = `Here are some products we have:\n\n`;
            for (const p of rows) {
                const name = (p.name || 'Unnamed product').toString().trim();
                const sku = (p.sku || '').toString().trim();
                const price = (p.price !== null && p.price !== undefined && p.price !== '') ? `â‚¹${Number(p.price)}` : null;
                const unit = (p.packaging_unit || 'carton').toString().trim();
                const upc = p.units_per_carton ? ` (${p.units_per_carton} pcs/carton)` : '';
                msg += `â€¢ *${name}*`;
                if (sku) msg += ` (SKU: ${sku})`;
                if (price) msg += ` â€” ${price}/${unit}${upc}`;
                msg += `\n`;
            }
            msg += `\nReply with a product name/SKU and quantity (e.g., "${rows[0].sku || rows[0].name} 5 cartons"), or ask "price of ${rows[0].sku || rows[0].name}".`;

            return {
                response: msg,
                source: 'catalog_list'
            };
        }
    } catch (e) {
        console.error('[SMART_ROUTER][CATALOG] Fast-path failed:', e?.message || e);
        // Continue to AI layer
    }
    
    // ============================================
    // ðŸ†• NEW: AI INTELLIGENCE LAYER (ZERO HARDCODING)
    // ============================================
    try {
        console.log('[AI_LAYER] Activating AI intelligence...');
        
        // Step 1: AI analyzes the query
        const aiAnalysis = await analyzeQueryWithAI(userQuery, tenantId);
        
        if (aiAnalysis && aiAnalysis.intent === 'price_inquiry') {
            console.log('[AI_LAYER] Price inquiry detected by AI');
            console.log('[AI_LAYER] Query type:', aiAnalysis.queryType);
            console.log('[AI_LAYER] Search terms:', aiAnalysis.searchTerms);
            console.log('[AI_LAYER] Quantities:', aiAnalysis.quantities);
            
            let searchTerm = aiAnalysis.searchTerms[0];
            let queryType = aiAnalysis.queryType;
            
            // --- CATEGORY SEARCH (e.g., "NFF", "all products") ---
            if (queryType === 'product_category' && searchTerm) {
                console.log('[AI_LAYER] Processing as category search for:', searchTerm);
                const products = await searchProductsWithAI(tenantId, searchTerm, 'product_category');
                if (products.length > 0) {
                    console.log('[AI_LAYER] âœ… AI found', products.length, 'products for category:', searchTerm);
                    const aiResponse = await generateResponseWithAI(products, userQuery);
                    const quotedProducts = products.map(p => ({
                        productCode: p.name.match(/\d+[x*]\d+/)?.[0] || p.name,
                        productName: p.name,
                        productId: p.id,
                        price: p.price,
                        unitsPerCarton: p.units_per_carton || 1,
                        quantity: 1,
                        unit: 'cartons'
                    }));
                    return {
                        response: aiResponse,
                        source: 'ai_intelligence',
                        quotedProducts: quotedProducts,
                        aiPowered: true
                    };
                } else {
                    console.log('[AI_LAYER] No products found in table for category:', searchTerm);
                    
                    // Try website content as fallback
                    console.log('[AI_LAYER] Searching website content for category...');
                    const websiteResults = await searchWebsiteForQuery(userQuery, tenantId);
                    
                    if (websiteResults && websiteResults.length > 0) {
                        console.log('[AI_LAYER] âœ… Found category info in website content!');
                        
                        let websiteResponse = `ðŸ“„ Found information about "${searchTerm}" on our website:\n\n`;
                        
                        websiteResults.forEach((result, index) => {
                            websiteResponse += `${index + 1}. *${result.pageTitle}*\n`;
                            websiteResponse += `${result.content.substring(0, 200)}...\n`;
                            if (result.url) {
                                websiteResponse += `ðŸ”— ${result.url}\n`;
                            }
                            websiteResponse += '\n';
                        });
                        
                        websiteResponse += '\nðŸ’¬ Would you like more details about any specific product?';
                        
                        return {
                            response: websiteResponse,
                            source: 'website_content',
                            quotedProducts: [],
                            aiPowered: true
                        };
                    }
                    
                    return {
                        response: `Sorry, I couldn't find any "${searchTerm}" products in our catalog or website.`,
                        source: 'ai_not_found',
                        quotedProducts: []
                    };
                }
            }
            
            // --- SPECIFIC PRODUCT SEARCH (e.g., "8x80", "8x80 10") ---
            if (queryType === 'specific_products' && searchTerm) {
                console.log('[AI_LAYER] Processing as specific product search for:', searchTerm);
                
                // First try products table
                const multiResult = await handleMultiProductPriceInquiry(
                    userQuery, 
                    tenantId, 
                    phoneNumber, 
                    aiAnalysis.quantities
                );
                
                if (multiResult && typeof multiResult === 'object' && multiResult.response) {
                    console.log('[AI_LAYER] âœ… Found in products table, returning price quote');
                    return {
                        ...multiResult,
                        source: 'ai_intelligence',
                        aiPowered: true
                    };
                } else if (typeof multiResult === 'string') {
                    // Check if product not found
                    if (multiResult.toLowerCase().includes('not found') || 
                        multiResult.toLowerCase().includes('couldn\'t find')) {
                        
                        console.log('[AI_LAYER] Product not in table, searching website content...');
                        
                        // Try website content as fallback
                        const websiteResults = await searchWebsiteForQuery(
                            userQuery, 
                            tenantId, 
                            searchTerm
                        );
                        
                        if (websiteResults && websiteResults.length > 0) {
                            console.log('[AI_LAYER] âœ… Found in website content!');
                            
                            // Format website results for customer
                            let websiteResponse = `ðŸ“„ Found information about "${searchTerm}" on our website:\n\n`;
                            
                            websiteResults.forEach((result, index) => {
                                websiteResponse += `${index + 1}. *${result.pageTitle}*\n`;
                                websiteResponse += `${result.content.substring(0, 200)}...\n`;
                                if (result.url) {
                                    websiteResponse += `ðŸ”— ${result.url}\n`;
                                }
                                websiteResponse += '\n';
                            });
                            
                            websiteResponse += '\nðŸ’¬ Would you like more details or to place an order?';
                            
                            return {
                                response: websiteResponse,
                                source: 'website_content',
                                aiPowered: true
                            };
                        }
                    }
                    
                    return {
                        response: multiResult,
                        source: 'ai_intelligence',
                        aiPowered: true
                    };
                }
            }
        }
        console.log('[AI_LAYER] Not a price inquiry, falling through to existing handlers');
    } catch (aiError) {
        console.error('[AI_LAYER] Error:', aiError.message);
        console.log('[AI_LAYER] Falling back to existing handlers');
    }
    
    // ============================================
    // EXISTING CODE CONTINUES HERE - DON'T CHANGE ANYTHING BELOW
    // ============================================
    
    // STEP 1: Use AI to understand what the customer wants
    const { openai } = require('./config');
    
    try {
        const understanding = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [{
                role: 'system',
                content: `You are a product query analyzer. Analyze the customer's message and extract:
1. Intent: "price_inquiry", "availability_check", "specifications", "order_request", "discount_request", "brand_inquiry", or "general"
2. Product codes mentioned (e.g., "8x80", "10x140", "NFF 8x100")
3. Brand/Product lines mentioned (e.g., "NFF", "Nylon Anchors", "Nylon Frame")
4. Quantities if mentioned (e.g., "10 ctns", "1000 pieces")

IMPORTANT RULES:
- If message contains brand names like "NFF", "Nylon Anchors", "Nylon Frame" â†’ intent should be "brand_inquiry"
- If the message contains multiple product codes (like "8x80 10 ctns, 8x100 5ctns"), prioritize "price_inquiry" even if discount terms are mentioned.
- Brand inquiries should return all products in that brand/line

Respond in JSON format:
{
  "intent": "price_inquiry" | "brand_inquiry" | "availability_check" | "specifications" | "order_request" | "discount_request" | "general",
  "products": ["8x80", "10x140"],
  "brands": ["NFF", "Nylon Anchors"],
  "quantities": [{"product": "8x80", "quantity": 10, "unit": "cartons"}],
  "confidence": 0.95
}`
            }, {
                role: 'user',
                content: userQuery
            }],
            response_format: { type: 'json_object' },
            temperature: 0.3
        });
        
        const parsed = JSON.parse(understanding.choices[0].message.content);
        console.log('[SMART_ROUTER] AI Understanding:', parsed);
        
        // STEP 2: Handle brand inquiries (e.g., "NFF", "Nylon Anchors")
        if (parsed.intent === 'brand_inquiry' && parsed.brands && parsed.brands.length > 0) {
            console.log('[SMART_ROUTER] Brand inquiry detected for:', parsed.brands);
            
            // Handle the first brand mentioned
            const brand = parsed.brands[0].toLowerCase();
            console.log('[SMART_ROUTER] Processing brand inquiry for:', brand);
            
            // Map common brand names to database search terms
            const brandMappings = {
                'nff': 'nff',
                'nylon': 'nylon',
                'nylon anchors': 'nylon',
                'nylon frame': 'nylon',
                'anchors': 'anchor',
                'frame': 'frame',
                'anchor': 'anchor'
            };
            
            const searchTerm = brandMappings[brand] || brand;
            console.log('[SMART_ROUTER] Searching for products with term:', searchTerm);
            
            // Fetch all products containing the brand term
            const { data: products } = await dbClient
                .from('products')
                .select('name, price, packaging_unit, units_per_carton')
                .eq('tenant_id', tenantId)
                .ilike('name', `%${searchTerm}%`)
                .order('name');
            
            if (products && products.length > 0) {
                let priceMsg = `Here are all ${parsed.brands[0]} products and their prices:\n\n`;
                for (const product of products) {
                    priceMsg += `*${product.name}*: â‚¹${product.price} per ${product.packaging_unit || 'carton'}`;
                    if (product.units_per_carton) priceMsg += ` (${product.units_per_carton} pcs/carton)`;
                    priceMsg += '\n';
                }
                priceMsg += '\nTo order, reply with the product code and quantity (e.g., "8x80 - 10 cartons").';
                
                return {
                    response: priceMsg,
                    source: 'brand_inquiry'
                };
            } else {
                return `No ${parsed.brands[0]} products found in our catalog.`;
            }
        }
        
        // STEP 3: Based on intent, fetch and display information
        if ((parsed.intent === 'price_inquiry' || (parsed.intent === 'discount_request' && parsed.products && parsed.products.length > 1)) && parsed.products && parsed.products.length > 0) {
            console.log('[SMART_ROUTER] Price inquiry detected for:', parsed.products);
            
            // DIRECTLY fetch pricing using AI-extracted product codes (NO pattern matching!)
            const productCodes = parsed.products.map(p => p.replace('*', 'x'));
            console.log('[SMART_ROUTER_AI] Fetching prices for AI-extracted products:', productCodes);
            
            if (productCodes.length === 1) {
                // Single product inquiry
                const code = productCodes[0];
                
                // ðŸ†• Check if this looks like a brand query (NFF, Nylon Anchors, Nylon Frame, etc.)
                const brandKeywords = ['nff', 'nylon', 'anchors', 'frame', 'anchor'];
                const isBrandQuery = brandKeywords.some(keyword => 
                    code.toLowerCase().includes(keyword) && 
                    !/\d/.test(code) // No numbers = likely a brand, not a product code
                );
                
                console.log('[SMART_ROUTER_AI] Brand detection for code:', code, 'isBrandQuery:', isBrandQuery);
                
                if (isBrandQuery) {
                    console.log('[SMART_ROUTER_AI] Detected brand query for:', code);
                    
                    // Fetch all products containing the brand term
                    const { data: products } = await dbClient
                        .from('products')
                        .select('name, price, packaging_unit, units_per_carton')
                        .eq('tenant_id', tenantId)
                        .ilike('name', `%${code}%`)
                        .order('name');
                    
                    if (products && products.length > 0) {
                        let priceMsg = `Here are all ${code.toUpperCase()} products and their prices:\n\n`;
                        for (const product of products) {
                            priceMsg += `*${product.name}*: â‚¹${product.price} per ${product.packaging_unit || 'carton'}`;
                            if (product.units_per_carton) priceMsg += ` (${product.units_per_carton} pcs/carton)`;
                            priceMsg += '\n';
                        }
                        priceMsg += '\nTo order, reply with the product code and quantity (e.g., "8x80 - 10 cartons").';
                        
                        return {
                            response: priceMsg,
                            source: 'ai_brand_inquiry'
                        };
                    } else {
                        return `No ${code.toUpperCase()} products found in our catalog.`;
                    }
                }
                
                // Regular product code search
                const product = await findProductByCode(tenantId, code);
                
                if (product) {
                    const priceMessage = await formatProductPrice(product, tenantId, phoneNumber, userQuery);
                    
                    // Extract quantity if mentioned
                    const quantityMatch = userQuery.match(/(\d+)\s*(?:pcs?|pieces?|cartons?|ctns?)/i);
                    let quantity = 1;
                    let unit = 'carton';
                    
                    if (quantityMatch) {
                        const extractedQty = parseInt(quantityMatch[1]);
                        const extractedUnit = quantityMatch[0].match(/cartons?|ctns?/i) ? 'cartons' : 'pieces';
                        
                        if (extractedUnit === 'pieces') {
                            const unitsPerCarton = parseInt(product.units_per_carton) || 1;
                            quantity = Math.ceil(extractedQty / unitsPerCarton);
                            console.log(`[AI_PRICE] Converted ${extractedQty} pieces to ${quantity} cartons`);
                        } else {
                            quantity = extractedQty;
                        }
                    }
                    
                    return {
                        response: priceMessage,
                        source: 'ai_direct_price',
                        quotedProducts: [{
                            productCode: code,
                            productName: product.name,
                            productId: product.id,
                            price: product.price,
                            quantity: quantity,
                            unit: unit,
                            unitsPerCarton: product.units_per_carton
                        }]
                    };
                } else {
                    return { 
                        response: `Sorry, I couldn't find product "${code}" in our catalog. Please check the product code.`,
                        source: 'ai_direct_price'
                    };
                }
            } else if (productCodes.length > 1) {
                // Multi-product inquiry
                console.log('[SMART_ROUTER_AI] Multi-product AI inquiry:', productCodes);
                console.log('[SMART_ROUTER_AI] AI extracted quantities:', parsed.quantities);
                
                // Pass the ORIGINAL QUERY and AI quantities to preserve quantity/unit information
                // The handleMultiProductPriceInquiry will use AI quantities when available
                const multiResult = await handleMultiProductPriceInquiry(userQuery, tenantId, phoneNumber, parsed.quantities);
                if (multiResult && typeof multiResult === 'object' && multiResult.response) {
                    return { ...multiResult, source: 'ai_direct_price' };
                }
                return multiResult;
            }
        }
        
        // STEP 3: If AI can't determine clear intent, use fallback handlers
        console.log('[SMART_ROUTER] No clear intent, trying specialized handlers...');
        
    } catch (aiError) {
        console.error('[SMART_ROUTER] AI understanding failed:', aiError.message);
        // Fall back to pattern-based handlers if AI fails
    }
    
    // FALLBACK: Pattern-based handlers (only if AI fails)
    // --- DYNAMIC FIELD SEARCH FOR NFF/NYLON/ANCHOR ---
    const lowerQuery = userQuery.toLowerCase();
    const brandKeywords = ['nff', 'nylon', 'anchor'];
    const matchedBrand = brandKeywords.find(k => lowerQuery.includes(k));
    if (matchedBrand) {
        const { getAllProducts } = require('./productService');
        const allProducts = await getAllProducts(tenantId);
        console.log(`[DYNAMIC_BRAND_SEARCH] Triggered for brand: ${matchedBrand}`);
        // Search all string fields for the keyword
        const matchedProducts = allProducts.filter(product => {
            return Object.values(product).some(val => {
                if (typeof val === 'string') {
                    return val.toLowerCase().includes(matchedBrand);
                }
                if (typeof val === 'object' && val !== null) {
                    return Object.values(val).some(subVal => typeof subVal === 'string' && subVal.toLowerCase().includes(matchedBrand));
                }
                return false;
            });
        });
        console.log(`[DYNAMIC_BRAND_SEARCH] Matched products for '${matchedBrand}':`, matchedProducts.map(p => p.name));
        if (matchedProducts.length > 0) {
            let priceMsg = `Here are all ${matchedBrand.toUpperCase()} products and their prices:\n\n`;
            for (const product of matchedProducts) {
                priceMsg += `*${product.name}*: â‚¹${product.price} per ${product.packaging_unit || 'carton'}`;
                if (product.units_per_carton) priceMsg += ` (${product.units_per_carton} pcs/carton)`;
                priceMsg += '\n';
            }
            priceMsg += '\nTo order, reply with the product code and quantity (e.g., "8x80 - 10 cartons").';
            console.log(`[DYNAMIC_BRAND_SEARCH] Returning ${matchedProducts.length} products for '${matchedBrand}'.`);
            return {
                response: priceMsg,
                source: 'dynamic_brand_search',
                quotedProducts: matchedProducts.map(p => ({
                    productCode: p.name.match(/\d+[x*]\d+/)?.[0] || p.name,
                    productName: p.name,
                    productId: p.id,
                    price: p.price,
                    unitsPerCarton: p.units_per_carton || 1,
                    quantity: 1,
                    unit: 'cartons'
                }))
            };
        } else {
            console.log(`[DYNAMIC_BRAND_SEARCH] No products found for '${matchedBrand}'.`);
            return { response: `No ${matchedBrand.toUpperCase()} products found in our catalog.`, source: 'dynamic_brand_search' };
        }
    }
    const priceResponse = await handlePriceQueriesFixed(userQuery, tenantId, phoneNumber);
    if (priceResponse) {
        if (typeof priceResponse === 'object' && priceResponse.response) {
            return { 
                response: priceResponse.response, 
                source: 'database',
                quotedProducts: priceResponse.quotedProducts || []
            };
        } else if (typeof priceResponse === 'string') {
            return { response: priceResponse, source: 'database' };
        }
    }

    const availabilityResponse = await handleAvailabilityQueries(userQuery, tenantId);
    if (availabilityResponse) return { response: availabilityResponse, source: 'database' };

    const specsResponse = await handleSpecQueries(userQuery, tenantId);
    if (specsResponse) return { response: specsResponse, source: 'database' };

    const businessResponse = await handleBusinessQueries(userQuery, tenantId);
    if (businessResponse) return { response: businessResponse, source: 'cached' };

    // FINAL FALLBACK: Check if it's a general product info query that could be in website content
    if (isProductInfoQuery(userQuery)) {
        console.log('[SMART_ROUTER] Query appears to be asking for product info, searching website...');
        
        try {
            const websiteResults = await searchWebsiteForQuery(userQuery, tenantId);
            
            if (websiteResults && websiteResults.length > 0) {
                console.log('[SMART_ROUTER] âœ… Found relevant info in website content!');
                
                let websiteResponse = `ðŸ“„ Here's what I found:\n\n`;
                
                websiteResults.slice(0, 3).forEach((result, index) => {
                    websiteResponse += `${index + 1}. *${result.pageTitle}*\n`;
                    websiteResponse += `${result.content.substring(0, 250)}...\n`;
                    if (result.url) {
                        websiteResponse += `ðŸ”— ${result.url}\n`;
                    }
                    websiteResponse += '\n';
                });
                
                websiteResponse += '\nðŸ’¬ Would you like more details or assistance with an order?';
                
                return {
                    response: websiteResponse,
                    source: 'website_content'
                };
            }
        } catch (websiteError) {
            console.error('[SMART_ROUTER] Website search error:', websiteError.message);
        }
    }

    // FINAL FALLBACK (Knowledge): Use uploaded tenant documents (and optional website context) to answer.
    try {
        const { openai } = require('./config');
        const docsContext = await buildTenantDocumentsContext(tenantId, userQuery, { limit: 2 });

        // Only fetch website context when it looks like product/info query
        let websiteContextBlock = null;
        if (isProductInfoQuery(userQuery)) {
            const websiteResults = await searchWebsiteForQuery(userQuery, tenantId);
            if (websiteResults && websiteResults.length > 0) {
                websiteContextBlock = `--- WEBSITE INDEXING (Crawled Content) ---\n${websiteResults
                    .slice(0, 3)
                    .map((r, i) => `[Source ${i + 1}: ${r.pageTitle || r.page_title || 'Website'}]\n${String(r.content || r.chunk_text || '').slice(0, 1500)}\n${r.url ? `URL: ${r.url}` : ''}`)
                    .join('\n\n---\n\n')}\n--- END WEBSITE INDEXING ---`;
            }
        }

        if (docsContext || websiteContextBlock) {
            const kbResponse = await openai.chat.completions.create({
                model: 'gpt-4o-mini',
                messages: [
                    {
                        role: 'system',
                        content: `You are a helpful sales assistant. Answer the user's question using ONLY the context provided.
If the context does not contain the answer, ask a short clarifying question or say you don't have that information.
Do not invent details.`
                    },
                    {
                        role: 'user',
                        content: `${docsContext ? docsContext + '\n\n' : ''}${websiteContextBlock ? websiteContextBlock + '\n\n' : ''}User Question: ${userQuery}`
                    }
                ],
                temperature: 0.2,
                max_tokens: 600
            });

            const answer = kbResponse?.choices?.[0]?.message?.content?.trim();
            if (answer) {
                // Auto-learn verified document/website answer
                const learningSources = [];
                if (docsContext) learningSources.push('tenant_documents');
                if (websiteContextBlock) learningSources.push('website_crawl');
                
                autoLearnVerifiedAnswer({
                    tenantId,
                    question: userQuery,
                    answer: answer,
                    sources: learningSources,
                    createdBy: 'bot_auto_docs'
                }).catch(() => {}); // Fire and forget
                
                return {
                    response: answer,
                    source: 'ai_knowledge_fallback',
                    aiPowered: true
                };
            }
        }
    } catch (error) {
        console.error('[SMART_ROUTER][KB] Knowledge fallback error:', error?.message || error);
    }

    console.log('[SMART_ROUTER_DEBUG] NO RESPONSE FOUND - returning null');
    console.log('[SMART_ROUTER_DEBUG] ==========================================');
    return null; // No smart response available, use AI
};

const handleGeneralPriceInquiry = async (tenantId, query, phoneNumber = null) => {
    try {
        // Get a few popular products to show pricing
        const { data: products } = await dbClient
            .from('products')
            .select('id, name, price, units_per_carton, packaging_unit')
            .eq('tenant_id', tenantId)
            .eq('is_active', true)
            .limit(5);
            
        if (!products || products.length === 0) {
            return "Please contact us for current pricing information.";
        }
        
        let response = "ðŸ“‹ **Current Pricing:**\n\n";
        products.forEach(product => {
            const unitsPerCarton = parseInt(product.units_per_carton) || 1;
            const pricePerPiece = (product.price / unitsPerCarton).toFixed(2);
            
            response += `ðŸ“¦ **${product.name}**\n`;
            response += `ðŸ”¹ â‚¹${pricePerPiece}/pc per piece\n`;
            response += `ðŸ“¦ *â‚¹${product.price}/${product.packaging_unit || 'carton'}*\n`;
            response += `   (${unitsPerCarton} pcs/${product.packaging_unit || 'carton'})\n\n`;
        });
        
        response += "ðŸ’¬ For specific products, ask: 'price of [product name]'";
        return response;
        
    } catch (error) {
        console.error('[PRICE_HANDLER] Error in general price inquiry:', error.message);
        return "Please contact us for current pricing information.";
    }
};
/**
 * Format individual product price response with personalized pricing
 */
const formatProductPrice = async (product, tenantId, phoneNumber = null, originalQuery = '') => {
    try {
        console.log('[FORMAT_PRICE] Product:', product.name, 'Phone:', phoneNumber || 'Not provided');
        
        // If phoneNumber is provided, use personalized pricing
        if (phoneNumber && product.id) {
            const priceDisplay = await formatPersonalizedPriceDisplay(tenantId, phoneNumber, product.id);
            if (priceDisplay) {
                console.log('[FORMAT_PRICE] Using personalized pricing for returning customer');
                return createPriceMessage(priceDisplay, true, originalQuery); // Pass originalQuery for quantity detection
            }
        }
        
        // Fallback to basic pricing if no phoneNumber or personalization unavailable
        console.log('[FORMAT_PRICE] Using basic pricing display');
        const unitsPerCarton = parseInt(product.units_per_carton) || 1;
        const pricePerPiece = (product.price / unitsPerCarton).toFixed(2);
        
        // Check if quantity was mentioned in the original query
        const quantityMatch = originalQuery.match(/(\d+)\s*(?:pcs?|pieces?|cartons?|ctns?)/i);
        let response = `ðŸ“¦ *${product.name}*\n\n`;
        response += `ðŸ’µ *Price*\n`;
        response += `â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”\n`;
        response += `ðŸ”¹ *â‚¹${pricePerPiece}/pc* per piece\n`;
        response += `ðŸ“¦ *â‚¹${product.price}/${product.packaging_unit || 'carton'}*\n\n`;
        
        if (quantityMatch) {
            const quantity = parseInt(quantityMatch[1]);
            const unit = quantityMatch[0].match(/cartons?|ctns?/i) ? 'cartons' : 'pieces';
            
            let finalQuantity, totalAmount;
            if (unit === 'pieces') {
                // Convert pieces to cartons - show exact then rounded
                const exactCartons = (quantity / unitsPerCarton).toFixed(2);
                const roundedCartons = Math.ceil(quantity / unitsPerCarton);
                finalQuantity = roundedCartons;
                totalAmount = (roundedCartons * product.price).toFixed(2);
                
                response += `ðŸ“Š *Quote for ${quantity.toLocaleString('en-IN')} pieces:*\n`;
                response += `   ${quantity.toLocaleString('en-IN')} pcs Ã· ${unitsPerCarton} pcs/carton = ${exactCartons} cartons\n`;
                response += `   (Rounded to ${roundedCartons} carton${roundedCartons !== 1 ? 's' : ''})\n`;
                response += `   ${roundedCartons} carton${roundedCartons !== 1 ? 's' : ''} Ã— â‚¹${product.price.toLocaleString('en-IN', {minimumFractionDigits: 2, maximumFractionDigits: 2})} = *â‚¹${parseFloat(totalAmount).toLocaleString('en-IN', {minimumFractionDigits: 2, maximumFractionDigits: 2})}*\n\n`;
            } else {
                // Already in cartons
                finalQuantity = quantity;
                totalAmount = (quantity * product.price).toFixed(2);
                
                response += `ðŸ“Š *Quote for ${quantity} carton${quantity !== 1 ? 's' : ''}:*\n`;
                response += `   ${quantity} carton${quantity !== 1 ? 's' : ''} Ã— â‚¹${product.price.toLocaleString('en-IN', {minimumFractionDigits: 2, maximumFractionDigits: 2})} = *â‚¹${parseFloat(totalAmount).toLocaleString('en-IN', {minimumFractionDigits: 2, maximumFractionDigits: 2})}*\n\n`;
            }
            
            response += `ðŸ’¡ *Volume Discounts:*\n`;
            response += `* 11-25 ctns: 2-3% â€¢ 26-50 ctns: 3-5%\n`;
            response += `* 51-100 ctns: 5-7% â€¢ 100+ ctns: 7-10%\n\n`;
            response += `ðŸ›’ Ready to add ${quantity.toLocaleString('en-IN')} ${unit} to your cart? Just say "yes"!`;
        } else {
            response += `ðŸ“Š *Breakdown:*\n`;
            response += `   â‚¹${pricePerPiece}/pc Ã— ${unitsPerCarton} pcs = â‚¹${product.price}/${product.packaging_unit || 'carton'}\n\n`;
            response += `ðŸ’¡ *Volume Discounts:*\n`;
            response += `* 11-25 ctns: 2-3% â€¢ 26-50 ctns: 3-5%\n`;
            response += `* 51-100 ctns: 5-7% â€¢ 100+ ctns: 7-10%\n\n`;
            response += `ðŸ›’ Ready to order? Let me know the quantity!`;
        }
        
        return response;
        
    } catch (error) {
        console.error('[FORMAT_PRICE] Error:', error.message);
        // Fallback to simple format
        let response = `ðŸ’° **${product.name} Pricing**\n\n`;
        response += `Price: â‚¹${product.price}/carton\n`;
        
        if (product.units_per_carton && product.units_per_carton > 1) {
            const perPiece = (product.price / product.units_per_carton).toFixed(2);
            response += `Carton contains: ${product.units_per_carton} pieces\n`;
            response += `Per piece: â‚¹${perPiece}\n`;
        }
        
        response += `\nReady to place an order? Just let me know the quantity!`;
        return response;
    }
};
/**
 * Handle availability queries
 */
const handleAvailabilityQueries = async (query, tenantId) => {
    const availabilityPatterns = [
        /(?:available|stock|have|hain|hai).*(\d+[x*]\d+)/i,
        /(\d+[x*]\d+).*(?:available|stock|milega|hain|hai)/i,
        /(?:aapke paas|do you have|paas).*(\d+[x*]\d+)/i,
        /(\d+[x*]\d+)\s+(?:hain|hai)/i  // Direct pattern like "8x80 hain"
    ];
    
    console.log('[AVAILABILITY] Checking query:', query);
    
    for (const pattern of availabilityPatterns) {
        const match = query.match(pattern);
        if (match) {
            const productCode = match[1].replace('*', 'x');
            console.log('[AVAILABILITY] Matched pattern, looking up:', productCode);
            const product = await findProductByCode(tenantId, productCode);
            
            if (product) {
                console.log('[AVAILABILITY] Product found:', product.name);
                return `âœ… **Haan, ${product.name} available hai!**\n\nPrice: â‚¹${product.price}/carton\n${product.units_per_carton ? `(${product.units_per_carton} pcs/carton)\n` : ''}\nKitne cartons chahiye?`;
            } else {
                console.log('[AVAILABILITY] Product not found:', productCode);
            }
        }
    }
    console.log('[AVAILABILITY] No pattern matched');
    return null;
};

// Handle specification queries
const handleSpecQueries = async (query, tenantId) => {
    const specPatterns = [
        /(?:specs|specifications|details).*(\d+[x*]\d+)/i,
        /(\d+[x*]\d+).*(?:specs|details|information)/i,
        /(?:tell me about|kya hai).*(\d+[x*]\d+)/i
    ];
    
    for (const pattern of specPatterns) {
        const match = query.match(pattern);
        if (match) {
            const productCode = match[1].replace('*', 'x');
            const product = await findProductByCode(tenantId, productCode);
            
            if (product) {
                let response = `ðŸ“‹ **${product.name} Specifications**\n\n`;
                response += `â€¢ Price: â‚¹${product.price}/carton\n`;
                response += `â€¢ Carton size: ${product.units_per_carton || 1} pieces\n`;
                response += `â€¢ Per piece: â‚¹${(product.price / (product.units_per_carton || 1)).toFixed(2)}\n`;
                if (product.description) {
                    response += `\n${product.description}`;
                }
                return response;
            }
        }
    }
    return null;
}

// Handle business queries with cached responses
const handleBusinessQueries = async (query, tenantId) => {
    try {
        const { openai } = require('./config');
        
        // Use AI to detect if this is a general business/company info query
        const analysis = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [{
                role: 'system',
                content: `Analyze if this customer query is asking for general business information (company info, about us, product overview, etc.) or operational details (delivery, payment, minimum order).

Respond in JSON:
{
  "isBusinessQuery": true/false,
  "queryType": "company_info" | "product_overview" | "delivery" | "payment" | "minimum_order" | "other",
  "shouldSearchWebsite": true/false,
  "confidence": 0.0-1.0
}

Guidelines:
- "company_info": Questions about the company, who we are, what we do, our business
- "product_overview": General questions about products, product range, what products we have
- "delivery": Questions about shipping, delivery, transport
- "payment": Questions about payment methods, how to pay
- "minimum_order": Questions about minimum order quantities
- shouldSearchWebsite: true for company_info and product_overview, false for operational details`
            }, {
                role: 'user',
                content: query
            }],
            response_format: { type: 'json_object' },
            temperature: 0.2
        });
        
        const result = JSON.parse(analysis.choices[0].message.content);
        console.log('[BUSINESS_QUERIES_AI]', result);
        
        if (!result.isBusinessQuery) {
            return null;
        }
        
        // Handle operational queries with predefined responses
        if (result.queryType === 'delivery') {
            return "ðŸš› We provide delivery across major cities. Delivery time: 2-3 business days. Free delivery on orders above â‚¹10,000.";
        }
        
        if (result.queryType === 'payment') {
            return "ðŸ’³ We accept bank transfer, UPI, and cash on delivery. Payment details shared after order confirmation.";
        }
        
        if (result.queryType === 'minimum_order') {
            return "ðŸ“¦ Minimum order: 1 carton per product. Bulk discounts available on larger quantities.";
        }
        
        // For company info and product overview, search website content
        if (result.shouldSearchWebsite) {
            console.log('[BUSINESS_QUERIES_AI] Searching website for:', result.queryType);
            
            const websiteResults = await searchWebsiteForQuery(query, tenantId);
            
            if (websiteResults && websiteResults.found) {
                console.log('[BUSINESS_QUERIES_AI] âœ… Found', websiteResults.count, 'results from website!');
                
                let websiteResponse = `ðŸ“„ Here's information from our website:\n\n`;
                
                websiteResults.sources.forEach((source, index) => {
                    const resultText = websiteResults.context.split('---')[index] || '';
                    const content = resultText.replace(/\[Source \d+:.*?\]\n/g, '').trim();
                    
                    websiteResponse += `*${source.title}*\n`;
                    websiteResponse += `${content.substring(0, 300)}${content.length > 300 ? '...' : ''}\n\n`;
                    if (source.url) {
                        websiteResponse += `ðŸ”— ${source.url}\n\n`;
                    }
                });
                
                return websiteResponse;
            } else {
                console.log('[BUSINESS_QUERIES_AI] No website content found');
                return "ðŸ¢ We are a leading supplier with 10+ years experience. Quality guaranteed on all products.";
            }
        }
        
        return null;
        
    } catch (error) {
        console.error('[BUSINESS_QUERIES_AI] Error:', error.message);
        return null;
    }
};

/**
 * Find product by code (enhanced version)
 */
// =============================================================================
// FIX 1: Enhanced findProductByCode in smartResponseRouter.js
// =============================================================================

/**
 * Find product by code (enhanced version with exact pattern matching)
 */
const findProductByCode = async (tenantId, productCode) => {
    try {
        console.log('[PRODUCT_SEARCH] Looking for product code:', productCode);
        const code = productCode.trim().toLowerCase();
        
        // First, try exact matches with common patterns
        const exactPatterns = [
            `NFF ${productCode}`,
            `NFF-${productCode}`,
            `NFF ${productCode.toUpperCase()}`,
            `NFF ${productCode.toLowerCase()}`
        ];
        
        for (const pattern of exactPatterns) {
            const { data: exactMatch } = await dbClient
                .from('products')
                .select('*')
                .eq('tenant_id', tenantId)
                .eq('is_active', true)
                .eq('name', pattern)
                .single();
            
            if (exactMatch) {
                console.log('[PRODUCT_SEARCH] Found exact match:', exactMatch.name);
                return exactMatch;
            }
        }
        
        // If no exact match, try pattern matching but be more specific
        const { data: products } = await dbClient
            .from('products')
            .select('*')
            .eq('tenant_id', tenantId)
            .eq('is_active', true)
            .ilike('name', `%${code}%`)
            .neq('price', 0);

        if (!products || products.length === 0) {
            console.log('[PRODUCT_SEARCH] No products found for code:', productCode);
            return null;
        }

        // Filter to find the most specific match
        // Prioritize products where the code appears at word boundaries
        const exactCodeMatch = products.find(product => {
            const name = (product.name || '').toLowerCase();
            // Check if the exact code appears (not as part of another number)
            return name.includes(` ${code}`) || 
                   name.endsWith(code) || 
                   name.includes(`-${code}`);
        });

        if (exactCodeMatch) {
            console.log('[PRODUCT_SEARCH] Found specific match:', exactCodeMatch.name);
            return exactCodeMatch;
        }

        console.log('[PRODUCT_SEARCH] No suitable product found for:', productCode);
        return null;
    } catch (error) {
        console.error('[PRODUCT_SEARCH] Error finding product:', error.message);
        return null;
    }
};

// Ensure all exported functions are defined at the top level
// (No changes to function bodies, just a comment for clarity)
module.exports = {
    getSmartResponse,
    handlePriceQueriesFixed,
    handleAvailabilityQueries,
    handleBusinessQueries,
    findProductByCode,
    handleMultiProductPriceInquiry
};

