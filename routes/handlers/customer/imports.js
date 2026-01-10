// All imports from customerHandler.js centralized here for modularization
const { viewCartWithDiscounts, checkoutWithDiscounts } = require('../../services/cartService');
const { processOrderRequestEnhanced, processMultipleOrderRequest } = require('../../services/orderProcessingService');
const { extractOrderDetails } = require('../../services/smartOrderExtractionService');
const { 
	handleInvoiceRequest, 
	handleOrderApproval, 
	handleZohoStatusCommand 
} = require('./zohoOperationsHandler');
const { sendMessage, sendMessageWithImage } = require('../../services/whatsappService');
const { logMessage, getConversationHistory, getConversationId } = require('../../services/historyService');
const { getAIResponse, getAIResponseV2 } = require('../../services/aiService');
const { categorizeResponse, updateConversationCategory } = require('../../services/followUpService');
const { isWithinOfficeHours } = require('../../services/officeHoursService');
const { dbClient } = require('../../services/config');
const { getCustomerProfile } = require('../../services/customerProfileService');
const debug = require('../../services/debug');
const { processFollowUpResponse } = require('../../services/enhancedFollowUpService');
const { detectLanguage, translateMessage } = require('../../services/multiLanguageService');
const { handleFollowUpRequest } = require('../../services/followUpSchedulerService');
const { trackCustomerMessage, trackBotMessage } = require('../../services/realtimeTestingService');
const { findQuickReplyResponse } = require('../../services/quickReplyService');
const { findFaqResponse } = require('../../services/faqService');
const { findKeywordResponse } = require('../../services/keywordService');
const { getProductRecommendations } = require('../../services/recommendationService');
const { isHandoverRequest, flagAndNotifyForHandover } = require('../../services/handoverService');
const { detectHandoverTriggers } = require('../../services/humanHandoverService');
const { scoreLead } = require('../../services/leadScoringService');
const { unsubscribeUser } = require('../../services/dripCampaignService');
const menuService = require('../../services/menuService');
const segmentationService = require('../../services/segmentationService');
const followUpSuggestionService = require('../../services/followUpSuggestionService');
const { getSmartResponse } = require('../../services/smartResponseRouter');
const { trackResponse } = require('../../services/responseAnalytics');
const { detectQuantityChange, updateCartQuantity } = require('../../services/quantityChangeService');
const {
	applyDiscount,
	removeDiscount,
	getAutomaticDiscounts
} = require('../../services/discountService');
const {
	addCartonProductToCart,
	viewCartonCart
} = require('../../services/cartonPricingService');
const {
	findProductOrVariant,
	findProductByNameOrCode,
	calculatePackagingPricing,
	formatProductDisplay,
	searchProductsAndVariants
} = require('../../services/enhancedProductService');
const { convertSalesOrderToInvoice, generateInvoicePDF } = require('../../services/zohoInvoiceService');
// Centralized imports for customer handler modules
// Add all require statements here as you modularize

