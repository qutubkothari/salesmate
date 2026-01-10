// services/enhancedProductService.js - ENHANCED SEARCH FIX

const { dbClient } = require('./config');

/**
 * Enhanced product search with flexible matching
 * Handles partial matches, variants, and priority-based results
 */
const findProductByNameOrCode = async (tenantId, searchTerm) => {
    try {
        console.log('[PRODUCT_SEARCH_ENHANCED] Starting search for:', searchTerm, 'tenantId:', tenantId);
        
        if (!searchTerm || !tenantId) {
            console.log('[PRODUCT_SEARCH_ENHANCED] Missing required parameters');
            return null;
        }

        const cleanSearchTerm = searchTerm.toString().trim();
        console.log('[PRODUCT_SEARCH_ENHANCED] Clean search term:', cleanSearchTerm);

        // Strategy 1: Exact name match (highest priority)
        console.log('[PRODUCT_SEARCH_ENHANCED] Strategy 1: Exact name match');
        let { data: exactMatch } = await dbClient
            .from('products')
            .select('*')
            .eq('tenant_id', tenantId)
            .eq('is_active', true)
            .ilike('name', cleanSearchTerm)
            .gt('price', 0) // Only products with valid price
            .order('price', { ascending: false }) // Prefer higher-priced (likely main) products
            .limit(1);

        if (exactMatch && exactMatch.length > 0) {
            console.log('[PRODUCT_SEARCH_ENHANCED] Found exact match:', exactMatch[0].name);
            return exactMatch[0];
        }

        // Strategy 2: Partial name match with flexible patterns
        console.log('[PRODUCT_SEARCH_ENHANCED] Strategy 2: Partial name match');
        let { data: partialMatches } = await dbClient
            .from('products')
            .select('*')
            .eq('tenant_id', tenantId)
            .eq('is_active', true)
            .or(`name.ilike.%${cleanSearchTerm}%,description.ilike.%${cleanSearchTerm}%`)
            .order([
                { column: 'price', ascending: false }, // Prefer products with higher price (likely main products)
                { column: 'name', ascending: true }
            ])
            .limit(10);

        if (partialMatches && partialMatches.length > 0) {
            console.log(`[PRODUCT_SEARCH_ENHANCED] Found ${partialMatches.length} partial matches`);
            
            // Filter and rank results
            const rankedResults = rankSearchResults(partialMatches, cleanSearchTerm);
            
            if (rankedResults.length > 0) {
                console.log('[PRODUCT_SEARCH_ENHANCED] Best partial match:', rankedResults[0].name, 'Score:', rankedResults[0].searchScore);
                return rankedResults[0];
            }
        }

        // Strategy 3: Fuzzy search for common variations
        console.log('[PRODUCT_SEARCH_ENHANCED] Strategy 3: Fuzzy search');
        const fuzzyResults = await fuzzyProductSearch(tenantId, cleanSearchTerm);
        if (fuzzyResults) {
            console.log('[PRODUCT_SEARCH_ENHANCED] Found fuzzy match:', fuzzyResults.name);
            return fuzzyResults;
        }

        // Strategy 4: Product code/SKU search (if numeric or alphanumeric)
        if (/^[a-zA-Z0-9x\-_]+$/.test(cleanSearchTerm)) {
            console.log('[PRODUCT_SEARCH_ENHANCED] Strategy 4: Product code search');
            let { data: codeMatches } = await dbClient
                .from('products')
                .select('*')
                .eq('tenant_id', tenantId)
                .eq('is_active', true)
                .or(`name.ilike.%${cleanSearchTerm}%,description.ilike.%${cleanSearchTerm}%`)
                .gt('price', 0)
                .limit(5);

            if (codeMatches && codeMatches.length > 0) {
                // Prefer products where the search term appears early in the name
                const bestCodeMatch = codeMatches.find(p => 
                    p.name.toLowerCase().includes(cleanSearchTerm.toLowerCase())
                ) || codeMatches[0];
                
                console.log('[PRODUCT_SEARCH_ENHANCED] Found code match:', bestCodeMatch.name);
                return bestCodeMatch;
            }
        }

        console.log('[PRODUCT_SEARCH_ENHANCED] No matches found for:', cleanSearchTerm);
        return null;

    } catch (error) {
        console.error('[PRODUCT_SEARCH_ENHANCED] Search error:', error);
        return null;
    }
};

/**
 * Rank search results by relevance
 */
const rankSearchResults = (products, searchTerm) => {
    const lowerSearchTerm = searchTerm.toLowerCase();
    
    return products.map(product => {
        let score = 0;
        const lowerName = product.name.toLowerCase();
        const lowerDesc = (product.description || '').toLowerCase();

        // Exact name match (highest score)
        if (lowerName === lowerSearchTerm) {
            score += 100;
        }
        
        // Name starts with search term
        else if (lowerName.startsWith(lowerSearchTerm)) {
            score += 80;
        }
        
        // Search term appears early in name
        else if (lowerName.indexOf(lowerSearchTerm) === 0) {
            score += 70;
        }
        
        // Name contains search term
        else if (lowerName.includes(lowerSearchTerm)) {
            const position = lowerName.indexOf(lowerSearchTerm);
            score += Math.max(50 - position, 10); // Earlier position = higher score
        }
        
        // Description contains search term
        if (lowerDesc.includes(lowerSearchTerm)) {
            score += 20;
        }

        // Bonus for having valid price
        if (product.price && product.price > 0) {
            score += 10;
        }

        // Bonus for higher prices (likely main products vs test products)
        if (product.price > 1000) {
            score += 5;
        }

        return {
            ...product,
            searchScore: score
        };
    })
    .filter(p => p.searchScore > 0)
    .sort((a, b) => b.searchScore - a.searchScore);
};

/**
 * Fuzzy search for common product variations
 */
const fuzzyProductSearch = async (tenantId, searchTerm) => {
    try {
        const variations = generateSearchVariations(searchTerm);
        console.log('[FUZZY_SEARCH] Trying variations:', variations);

        for (const variation of variations) {
            const { data: results } = await dbClient
                .from('products')
                .select('*')
                .eq('tenant_id', tenantId)
                .eq('is_active', true)
                .ilike('name', `%${variation}%`)
                .gt('price', 0)
                .order('price', { ascending: false })
                .limit(1);

            if (results && results.length > 0) {
                console.log('[FUZZY_SEARCH] Found match with variation:', variation, '->', results[0].name);
                return results[0];
            }
        }
        
        return null;
    } catch (error) {
        console.error('[FUZZY_SEARCH] Error:', error);
        return null;
    }
};

/**
 * Generate search term variations for fuzzy matching
 */
const generateSearchVariations = (searchTerm) => {
    const variations = [searchTerm];
    const lower = searchTerm.toLowerCase();
    
    // Add common prefixes for NFF products
    if (/^\d+x\d+/.test(lower)) {
        variations.push(`nff ${searchTerm}`);
        variations.push(`nff-${searchTerm}`);
        variations.push(`nff${searchTerm}`);
    }
    
    // Remove common prefixes
    if (lower.startsWith('nff')) {
        variations.push(searchTerm.replace(/^nff[-\s]?/i, ''));
    }
    
    // Handle x variations (8x100, 8 x 100, 8*100)
    if (lower.includes('x')) {
        variations.push(searchTerm.replace('x', ' x '));
        variations.push(searchTerm.replace('x', '*'));
        variations.push(searchTerm.replace('x', '-'));
    }
    
    // Add dash and space variations
    variations.push(searchTerm.replace(/[-\s]/g, ''));
    variations.push(searchTerm.replace(/[-]/g, ' '));
    variations.push(searchTerm.replace(/\s/g, '-'));
    
    return [...new Set(variations)]; // Remove duplicates
};

/**
 * Search products with enhanced debugging
 */
const searchProductsAndVariants = async (tenantId, searchTerm, limit = 20) => {
    try {
        console.log('[PRODUCT_SEARCH_VARIANTS] Searching:', searchTerm);
        
        // Use the enhanced search first
        const primaryResult = await findProductByNameOrCode(tenantId, searchTerm);
        
        if (primaryResult) {
            console.log('[PRODUCT_SEARCH_VARIANTS] Primary result found:', primaryResult.name);
            return [formatProductForDisplay(primaryResult)];
        }

        // Fallback to basic search if no primary result
        const { data: fallbackResults, error } = await dbClient
            .from('products')
            .select('*')
            .eq('tenant_id', tenantId)
            .eq('is_active', true)
            .or(`name.ilike.%${searchTerm}%,description.ilike.%${searchTerm}%`)
            .order('price', { ascending: false })
            .limit(limit);

        if (error) throw error;

        console.log(`[PRODUCT_SEARCH_VARIANTS] Fallback found ${fallbackResults?.length || 0} results`);
        
        return (fallbackResults || []).map(formatProductForDisplay);

    } catch (error) {
        console.error('[PRODUCT_SEARCH_VARIANTS] Error:', error);
        return [];
    }
};

/**
 * Format product for display with packaging info
 */
const formatProductForDisplay = (product) => {
    return {
        ...product,
        variant_info: { 
            has_variants: false, 
            variant_count: 0,
            is_variant: false
        },
        packaging_info: {
            packaging_unit: product.packaging_unit || 'piece',
            units_per_packet: product.units_per_packet || 1,
            packets_per_carton: product.packets_per_carton || 1,
            total_units_per_carton: (product.units_per_packet || 1) * (product.packets_per_carton || 1),
            unit_price: product.unit_price,
            packet_price: product.packet_price,
            carton_price: product.carton_price || product.price
        }
    };
};

/**
 * Debug product search - logs all steps
 */
const debugProductSearch = async (tenantId, searchTerm) => {
    console.log('[DEBUG_SEARCH] ========== Product Search Debug ==========');
    console.log('[DEBUG_SEARCH] Tenant:', tenantId);
    console.log('[DEBUG_SEARCH] Search Term:', searchTerm);
    
    // Check if products exist at all
    const { data: allProducts } = await dbClient
        .from('products')
        .select('id, name, price, is_active')
        .eq('tenant_id', tenantId)
        .limit(10);
    
    console.log('[DEBUG_SEARCH] Total products in DB:', allProducts?.length || 0);
    if (allProducts && allProducts.length > 0) {
        console.log('[DEBUG_SEARCH] Sample products:');
        allProducts.slice(0, 3).forEach(p => {
            console.log(`  - ${p.name} (Price: â‚¹${p.price}, Active: ${p.is_active})`);
        });
    }
    
    // Try the enhanced search
    const result = await findProductByNameOrCode(tenantId, searchTerm);
    console.log('[DEBUG_SEARCH] Enhanced search result:', result ? result.name : 'Not found');
    console.log('[DEBUG_SEARCH] ===============================');
    
    return result;
};

module.exports = {
    findProductByNameOrCode,
    searchProductsAndVariants,
    rankSearchResults,
    fuzzyProductSearch,
    generateSearchVariations,
    formatProductForDisplay,
    debugProductSearch
};
