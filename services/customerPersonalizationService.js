// services/customerPersonalizationService.js

const { dbClient } = require('./config');

/**
 * Get customer name and business info for personalization
 */
async function getCustomerInfo(tenantId, phoneNumber) {
    try {
        const cleanPhone = phoneNumber.replace('@c.us', '').replace(/\D/g, '');
        

        // Check customer_profiles table - use 'phone' column (not 'phone_number')
        const { data: profile } = await dbClient
            .from('customer_profiles_new')
            .select('id, first_name, last_name, company, gst_number, business_verified')
            .eq('tenant_id', tenantId)
            .eq('phone', cleanPhone)
            .single();

        if (!profile) {
            return { hasName: false };
        }

        // Determine best name to use
        let displayName = null;
        let greeting = '';

        if (profile.first_name) {
            displayName = profile.first_name;
            greeting = `Hi ${displayName}`;
        } else if (profile.company) {
            // Use business name
            displayName = profile.company;
            greeting = `Hello from ${displayName}`;
        }

        return {
            hasName: !!displayName,
            displayName,
            greeting,
            firstName: profile.first_name,
            lastName: profile.last_name,
            companyName: profile.company,
            isVerifiedBusiness: profile.business_verified,
            gstNumber: profile.gst_number
        };

    } catch (error) {
        console.error('[PERSONALIZATION] Error fetching customer info:', error.message);
        return { hasName: false };
    }
}

/**
 * Extract name from business info if customer profile doesn't have it
 */
async function extractNameFromBusinessInfo(tenantId, phoneNumber) {
    try {
        const cleanPhone = phoneNumber.replace('@c.us', '').replace(/\D/g, '');
        
        // Get recent business info extractions
        const { data: extractions } = await dbClient
            .from('business_info_extractions')
            .select('extracted_fields')
            .eq('tenant_id', tenantId)
            .order('created_at', { ascending: false })
            .limit(1);

        if (extractions && extractions.length > 0) {
            const fields = extractions[0].extracted_fields;
            
            // Try to extract proprietor/partner name
            if (fields.proprietor_name && !fields.proprietor_name.toLowerCase().includes('proprietor')) {
                return fields.proprietor_name;
            }
            
            // Try contact person
            if (fields.contact_person) {
                return fields.contact_person;
            }
        }

        return null;
    } catch (error) {
        console.error('[PERSONALIZATION] Error extracting name from business info:', error.message);
        return null;
    }
}

/**
 * Generate personalized greeting for AI prompt
 */
async function getPersonalizedGreeting(tenantId, phoneNumber) {
    const customerInfo = await getCustomerInfo(tenantId, phoneNumber);
    if (customerInfo.hasName) {
        if (customerInfo.firstName) {
            return {
                greeting: `(Customer name: ${customerInfo.firstName})`,
                contextNote: `Address the customer as ${customerInfo.firstName} in your response to make it more personal.`,
                customerName: customerInfo.firstName,
                companyName: customerInfo.companyName
            };
        } else if (customerInfo.companyName) {
            return {
                greeting: `(Customer business: ${customerInfo.companyName})`,
                contextNote: `The customer represents ${customerInfo.companyName}. Reference their business when appropriate.`,
                companyName: customerInfo.companyName
            };
        }
    }
    return {
        greeting: '',
        contextNote: '',
        customerName: null,
        companyName: null
    };
}

module.exports = {
    getCustomerInfo,
    extractNameFromBusinessInfo,
    getPersonalizedGreeting
};

