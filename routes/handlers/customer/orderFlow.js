// Order processing logic moved from customerHandler.js

const { dbClient, sendMessage, logMessage, findKeywordResponse, segmentationService, followUpSuggestionService } = require('./imports');

// === ENHANCED MULTI-PRODUCT HANDLER (NEW ADDITION) ===
/**
 * Enhanced multi-product order detection for combined messages
 * Handles patterns like "8x80 - 36 ctns and 8x100 - 4 ctns"
 * FIXED: Uses dbClient import directly instead of relying on enhancedProductService
 */
const extractCombinedOrderDetails = async (userQuery, tenantId) => {
	// ...existing code from customerHandler.js...
	// (PASTE the full extractCombinedOrderDetails function here)
};

const segmentConversationSafe = async (...args) => {
	try {
		if (segmentationService && segmentationService.segmentConversation) {
			return await segmentationService.segmentConversation(...args);
		}
	} catch (error) {
		console.log('[SEGMENT] Service not available:', error.message);
	}
	return null;
};

const generateFollowUpSuggestionSafe = async (...args) => {
	try {
		if (followUpSuggestionService && followUpSuggestionService.generateFollowUpSuggestion) {
			return await followUpSuggestionService.generateFollowUpSuggestion(...args);
		}
	} catch (error) {
		console.log('[FOLLOWUP_SUGGESTION] Service unavailable:', error.message);
	}
	return null;
};

const sendAndLogMessage = async (to, text, tenantId, messageType) => {
	await sendMessage(to, text);
	await logMessage(tenantId, to, 'bot', text, messageType);
};

const findKeywordResponseSafe = async (tenantId, text) => {
	try {
		const keywordResponse = await findKeywordResponse(tenantId, text);
		return keywordResponse;
	} catch (e) {
		console.error('[KW] findKeywordResponseSafe error:', e?.message || e);
		return null;
	}
};

module.exports = {
	extractCombinedOrderDetails,
	segmentConversationSafe,
	generateFollowUpSuggestionSafe,
	sendAndLogMessage,
	findKeywordResponseSafe
};
// All order processing logic

