// services/templateResponseService.js
// Module 2: Template Responses & Database-First Lookups
// SAFE TO EXTRACT - Handles common queries without AI

const { dbClient } = require('./config');

class TemplateResponseService {
    constructor() {
        this.responseTemplates = {
            gst: (profile) => `*Your GST Details:*\n\nðŸ“‹ *GST Number:* ${profile.gst_number}\nðŸ¢ *Company:* ${profile.company || 'Not provided'}\nðŸ‘¤ *Name:* ${profile.first_name || ''} ${profile.last_name || ''}`.trim(),
            
            price: (product) => `*${product.name}*\nðŸ’° *Price:* â‚¹${product.price}\nðŸ“¦ *Units per carton:* ${product.units_per_carton || 'N/A'}\n\nWould you like to place an order?`,
            
            greeting: (name, company) => `Hello ${name}${company ? ` from ${company}` : ''}! How can I help you today?`,
            
            order_status: () => "Your recent orders are being processed. You'll receive updates via WhatsApp.\n\nFor specific order details, please contact our team directly.",
            
            help: () => `I can help you with:\n\nðŸ“‹ GST details and company information\nðŸ’° Product prices and specifications\nðŸ›’ Placing orders\nðŸ“¦ Order status updates\n\nWhat would you like to know?`,
            
            product_unavailable: (searchTerm) => `Sorry, I couldn't find "${searchTerm}" in our catalog.\n\nPlease contact us for more product information.`,
            
            fallback: () => "Thank you for your message. Our team will respond to you shortly."
        };

        console.log('[TEMPLATE_RESPONSE] Service initialized');
    }

    /**
     * Check if query matches GST inquiry patterns
     * @param {string} userQuery - User's message
     * @returns {boolean} - True if GST query detected
     */
    isGSTQuery(userQuery) {
        const gstPatterns = [
            /gst.*detail/i,
            /my.*gst/i,
            /gst.*number/i,
            /gst.*info/i,
            /tax.*detail/i,
            /what.*is.*my/i,
            /my.*detail/i
        ];

        return gstPatterns.some(pattern => pattern.test(userQuery)) || 
               userQuery.toLowerCase().includes('gst');
    }

    /**
     * Handle GST lookup query
     * @param {string} tenantId - Tenant ID
     * @param {string} phone - Customer phone number
     * @returns {Object} - {handled: boolean, response: string, type: string}
     */
    async handleGSTLookup(tenantId, phone) {
        try {
            console.log('[GST_LOOKUP] Attempting database lookup for phone:', phone);
            
            const { data: profile, error } = await dbClient
                .from('customer_profiles')
                .select('gst_number, company, first_name, last_name')
                .eq('tenant_id', tenantId)
                .eq('phone', phone)
                .single();
            
            console.log('[GST_LOOKUP] Database result:', { found: !!profile, error: error?.message });
            
            if (profile?.gst_number) {
                return {
                    handled: true,
                    response: this.responseTemplates.gst(profile),
                    type: 'gst_lookup_success'
                };
            } else if (profile) {
                return {
                    handled: true,
                    response: "I found your profile but don't have your GST information yet.\n\nPlease share your GST certificate or number so I can update your details.",
                    type: 'gst_lookup_no_data'
                };
            } else {
                return {
                    handled: true,
                    response: "I don't have your details in our system yet.\n\nPlease share your company information and GST certificate so I can help you better.",
                    type: 'gst_lookup_no_profile'
                };
            }
        } catch (error) {
            console.error('[GST_LOOKUP] Database error:', error.message);
            return {
                handled: true,
                response: "Sorry, I'm having trouble accessing your GST details right now.\n\nPlease contact our team directly or try again in a moment.",
                type: 'gst_lookup_error'
            };
        }
    }

    /**
     * Check if query is a price inquiry
     * @param {string} userQuery - User's message
     * @returns {Object} - {isPrice: boolean, productCode: string|null}
     */
    isPriceQuery(userQuery) {
        // Enhanced patterns to catch more price inquiries
        const pricePatterns = [
            /price|rate|cost|kitna|kya price|kitne ka/i, // Hindi: kitna, kya price, kitne ka
            /how much|what.*(price|cost)/i,
            /price.*of|cost.*of|rate.*of/i
        ];
        const hasProductCode = /(\d+[x*]\d+|NFF\s*\d+[x*]\d+)/i.test(userQuery);
        const hasPriceKeyword = pricePatterns.some(pattern => pattern.test(userQuery));
        if (!hasPriceKeyword || !hasProductCode) {
            return { isPrice: false, productCode: null };
        }
        const productMatch = userQuery.match(/(\d+[x*]\d+|NFF\s*\d+[x*]\d+)/i);
        return {
            isPrice: true,
            productCode: productMatch ? productMatch[1].replace('*', 'x') : null
        };
    }

    /**
     * Handle price lookup query
     * @param {string} tenantId - Tenant ID
     * @param {string} productCode - Product code to search for
     * @returns {Object} - {handled: boolean, response: string, type: string}
     */
    async handlePriceLookup(tenantId, productCode) {
        if (!productCode) {
            return { handled: false };
        }

        try {
            // Prioritize NFF products with valid prices
            const { data: products } = await dbClient
                .from('products')
                .select('name, price, units_per_carton')
                .eq('tenant_id', tenantId)
                .ilike('name', `%${productCode}%`)
                .eq('is_active', true)
                .gt('price', 0); // Only products with valid prices
            
            if (products && products.length > 0) {
                // Prioritize NFF products
                let product = products.find(p => p.name.startsWith('NFF')) || products[0];
                
                return {
                    handled: true,
                    response: this.responseTemplates.price(product),
                    type: 'price_lookup_success'
                };
            }
        } catch (error) {
            console.warn('[PRICE_LOOKUP] Error:', error.message);
        }

        return { handled: false };
    }

    /**
     * Check for common template patterns
     * @param {string} userQuery - User's message
     * @param {Object} customerProfile - Customer profile data
     * @returns {Object} - {handled: boolean, response: string, type: string}
     */
    getTemplateResponse(userQuery, customerProfile = null) {
        const query = userQuery.toLowerCase();
        
        // Greeting patterns
        if (/^(hi|hello|hey|good morning|good afternoon|good evening|namaste)$/i.test(query)) {
            const name = customerProfile?.first_name || 'there';
            const company = customerProfile?.company;
            return {
                handled: true,
                response: this.responseTemplates.greeting(name, company),
                type: 'greeting_template'
            };
        }
        
        // Help requests
        if (/help|assist|support/.test(query)) {
            return {
                handled: true,
                response: this.responseTemplates.help(),
                type: 'help_template'
            };
        }
        
        // Order status
        if (/order.*status|status.*order|my.*order/.test(query)) {
            return {
                handled: true,
                response: this.responseTemplates.order_status(),
                type: 'order_status_template'
            };
        }
        
        return { handled: false };
    }

    /**
     * Get customer profile for template responses
     * @param {string} tenantId - Tenant ID
     * @param {string} phone - Customer phone number
     * @returns {Object|null} - Customer profile or null
     */
    async getCustomerProfileForTemplate(tenantId, phone) {
        try {
            const { data: profile } = await dbClient
                .from('customer_profiles')
                .select('gst_number, company, first_name, last_name, business_address, email')
                .eq('tenant_id', tenantId)
                .eq('phone', phone)
                .single();
            return profile;
        } catch (error) {
            console.error('[PROFILE_LOOKUP] Error:', error.message);
            return null;
        }
    }

    /**
     * Main template response handler
     * @param {string} userQuery - User's message
     * @param {string} tenantId - Tenant ID
     * @param {string} phone - Customer phone number
     * @returns {Object} - {handled: boolean, response: string, type: string}
     */
    async handleTemplateResponse(userQuery, tenantId, phone) {
        console.log('[TEMPLATE_RESPONSE] Processing query for patterns');
        
        // Priority 1: GST Queries (most common for your use case)
        if (this.isGSTQuery(userQuery)) {
            console.log('[TEMPLATE_RESPONSE] GST query detected');
            return await this.handleGSTLookup(tenantId, phone);
        }
        
        /*
        // Priority 2: Price Queries
        const priceCheck = this.isPriceQuery(userQuery);
        if (priceCheck.isPrice && priceCheck.productCode) {
            console.log('[TEMPLATE_RESPONSE] Price query detected for:', priceCheck.productCode);
            const priceResult = await this.handlePriceLookup(tenantId, priceCheck.productCode);
            if (priceResult.handled) {
                return priceResult;
            }
        }
        */
        
        // Priority 3: General templates (greetings, help, etc.)
        const customerProfile = await this.getCustomerProfileForTemplate(tenantId, phone);
        const templateResult = this.getTemplateResponse(userQuery, customerProfile);
        if (templateResult.handled) {
            console.log('[TEMPLATE_RESPONSE] Template response found:', templateResult.type);
            return templateResult;
        }
        
        console.log('[TEMPLATE_RESPONSE] No template response found');
        return { handled: false };
    }
}

// Export singleton instance
const templateResponseService = new TemplateResponseService();
module.exports = templateResponseService;
