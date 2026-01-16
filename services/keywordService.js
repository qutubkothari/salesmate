/**
 * @title Keyword Response Service
 * @description Handles keyword-based automatic responses and routing.
 */
const { dbClient } = require('./config');

/**
 * Adds a new keyword-response pair for a tenant.
 * @param {string} tenantId The ID of the tenant.
 * @param {string} keyword The keyword to match.
 * @param {string} response The response to send when the keyword is matched.
 * @returns {Promise<string>} A confirmation or error message.
 */
const addKeyword = async (tenantId, keyword, response) => {
    try {
        const { error } = await dbClient.from('keywords').insert({
            tenant_id: tenantId,
            keyword: keyword.toLowerCase(),
            response: response
        });
        
        if (error) {
            if (error.code === '23505') {
                return `The keyword "${keyword}" already exists. Use /delete_keyword first to replace it.`;
            }
            throw error;
        }
        
        return `Keyword "${keyword}" has been added successfully.`;
    } catch (error) {
        console.error('Error adding keyword:', error.message);
        return 'An error occurred while adding the keyword.';
    }
};

/**
 * Deletes a keyword for a tenant.
 * @param {string} tenantId The ID of the tenant.
 * @param {string} keyword The keyword to delete.
 * @returns {Promise<string>} A confirmation or error message.
 */
const deleteKeyword = async (tenantId, keyword) => {
    try {
        const { data, error } = await dbClient
            .from('keywords')
            .delete()
            .eq('tenant_id', tenantId)
            .eq('keyword', keyword.toLowerCase())
            .select();
            
        if (error) throw error;
        
        if (!data || data.length === 0) {
            return `No keyword "${keyword}" found to delete.`;
        }
        
        return `Keyword "${keyword}" has been deleted successfully.`;
    } catch (error) {
        console.error('Error deleting keyword:', error.message);
        return 'An error occurred while deleting the keyword.';
    }
};

/**
 * Lists all keywords for a tenant.
 * Supports both object-based and direct parameter interfaces.
 * @param {string|Object} tenantIdOrOptions The tenant ID or options object with { tenantId }
 * @returns {Promise<string|Array>} A formatted list of keywords (string) or array of keyword objects
 */
const listKeywords = async (tenantIdOrOptions) => {
    try {
        // Support both interfaces: listKeywords(tenantId) and listKeywords({ tenantId })
        let tenantId;
        let returnArray = false;
        
        if (typeof tenantIdOrOptions === 'object' && tenantIdOrOptions.tenantId) {
            // Object-based interface for admin commands - return array
            tenantId = tenantIdOrOptions.tenantId;
            returnArray = true;
        } else {
            // Direct parameter interface - return formatted string
            tenantId = tenantIdOrOptions;
        }
        
        const { data, error } = await dbClient
            .from('keywords')
            .select('keyword, response')
            .eq('tenant_id', tenantId)
            .order('keyword');
            
        if (error) throw error;
        
        if (!data || data.length === 0) {
            return returnArray ? [] : 'You have no keywords configured yet. Use /add_keyword to create some.';
        }
        
        if (returnArray) {
            // Return array format for admin commands
            return data.map(item => ({
                word: item.keyword,
                response: item.response
            }));
        } else {
            // Return formatted string for direct calls
            let result = '*Your Keywords:*\n';
            data.forEach(item => {
                result += `• "${item.keyword}" → "${item.response}"\n`;
            });
            return result;
        }
    } catch (error) {
        console.error('Error listing keywords:', error.message);
        return returnArray ? [] : 'An error occurred while fetching your keywords.';
    }
};

/**
 * Finds a keyword response for a given message and tenant.
 * @param {string} tenantId The tenant ID to check keywords for.
 * @param {string} message The incoming message to check for keywords.
 * @returns {Promise<string|null>} The response string or null if no match.
 */
const findKeywordResponse = async (tenantId, message) => {
    try {
        if (!message || !tenantId) {
            return null;
        }

        const messageText = message.toLowerCase().trim();
        console.log(`[KEYWORD] Checking message for keywords: "${messageText}"`);

        // Get all keywords for this tenant
        const { data: keywords, error } = await dbClient
            .from('keywords')
            .select('keyword, response')
            .eq('tenant_id', tenantId);

        if (error) {
            console.error('[KEYWORD] Error fetching keywords:', error.message);
            return null;
        }

        if (!keywords || keywords.length === 0) {
            console.log('[KEYWORD] No keywords found for tenant');
            return null;
        }

        // Check each keyword for matches
        for (const keywordData of keywords) {
            const keyword = keywordData.keyword.toLowerCase();
            
            // Check for exact match or keyword contained in message
            if (messageText === keyword || messageText.includes(keyword)) {
                console.log(`[KEYWORD] Match found: ${keyword} -> ${keywordData.response}`);
                return keywordData.response;
            }
        }

        console.log('[KEYWORD] No keyword matches found');
        return null;

    } catch (error) {
        console.error('[KEYWORD] Exception in findKeywordResponse:', error.message);
        return null;
    }
};

module.exports = {
    addKeyword,
    deleteKeyword,
    listKeywords,
    findKeywordResponse
};

