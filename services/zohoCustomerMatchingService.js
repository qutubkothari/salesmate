// services/zohoCustomerMatchingService.js
// New service to match and pull customer data from Zoho

const zoho = require('./zohoIntegrationService');
const { dbClient } = require('./config');

class ZohoCustomerMatchingService {
    
    /**
     * Match customer by phone or company name when they message
     */
    async matchAndSyncCustomer(tenantId, phoneNumber) {
        try {
            console.log('[Zoho Match] Checking for existing Zoho customer:', phoneNumber);
            const cleanPhone = phoneNumber.replace(/\D/g, '');
            // Check if customer already linked
            const { data: existingProfile } = await dbClient
                .from('customer_profiles_new')
                .select('id, zoho_customer_id, company')
                .eq('tenant_id', tenantId)
                .eq('phone', cleanPhone)
                .single();

            // Null check before accessing .id
            if (!existingProfile || !existingProfile.id) {
                console.log('[Zoho Match] Customer profile is null, skipping sync');
                return { success: false, action: 'profile_missing' };
            }

            // Already linked to Zoho
            if (existingProfile.zoho_customer_id) {
                console.log('[Zoho Match] Customer already linked:', existingProfile.zoho_customer_id);
                return { 
                    success: true, 
                    action: 'already_linked',
                    zohoCustomerId: existingProfile.zoho_customer_id 
                };
            }

            // Search Zoho by phone number
            const phoneMatch = await this.searchZohoByPhone(cleanPhone);
            if (phoneMatch.success && phoneMatch.customer) {
                console.log('[Zoho Match] Found by phone:', phoneMatch.customer.contact_id);
                await this.linkCustomerToZoho(existingProfile.id, phoneMatch.customer);
                return { 
                    success: true, 
                    action: 'matched_by_phone',
                    zohoCustomer: phoneMatch.customer 
                };
            }

            // Search Zoho by company name (if available)
            if (existingProfile.company) {
                const companyMatch = await this.searchZohoByCompanyName(existingProfile.company);
                if (companyMatch.success && companyMatch.customer) {
                    console.log('[Zoho Match] Found by company:', companyMatch.customer.contact_id);
                    await this.linkCustomerToZoho(existingProfile.id, companyMatch.customer);
                    return { 
                        success: true, 
                        action: 'matched_by_company',
                        zohoCustomer: companyMatch.customer 
                    };
                }
            }
            
            console.log('[Zoho Match] No match found in Zoho');
            return { 
                success: false, 
                action: 'no_match' 
            };
            
        } catch (error) {
            console.error('[Zoho Match] Error:', error);
            return { success: false, error: error.message };
        }
    }
    
    /**
     * Search Zoho by phone number
     */
    async searchZohoByPhone(phone) {
        try {
            const result = await zoho.makeRequest(`contacts?phone=${phone}`);
            
            if (result.success && result.data.contacts?.length > 0) {
                return { 
                    success: true, 
                    customer: result.data.contacts[0] 
                };
            }
            
            return { success: false };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }
    
    /**
     * Search Zoho by company name
     */
    async searchZohoByCompanyName(companyName) {
        try {
            const result = await zoho.makeRequest(
                `contacts?company_name=${encodeURIComponent(companyName)}`
            );
            
            if (result.success && result.data.contacts?.length > 0) {
                return { 
                    success: true, 
                    customer: result.data.contacts[0] 
                };
            }
            
            return { success: false };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }
    
    /**
     * Link database customer to Zoho customer and pull data
     */
    async linkCustomerToZoho(customerId, zohoCustomer) {
        try {
            const updateData = {
                zoho_customer_id: zohoCustomer.contact_id,
                company: zohoCustomer.company_name || null,
                gst_number: zohoCustomer.gst_no || null,
                updated_at: new Date().toISOString()
            };
            
            // Extract name from contact persons if available
            if (zohoCustomer.contact_persons?.length > 0) {
                const contact = zohoCustomer.contact_persons[0];
                if (contact.first_name) {
                    updateData.first_name = contact.first_name;
                }
                if (contact.last_name) {
                    updateData.last_name = contact.last_name;
                }
            }
            
            await dbClient
                .from('customer_profiles_new')
                .update(updateData)
                .eq('id', customerId);
            
            console.log('[Zoho Match] Customer linked and data pulled from Zoho');
            
            return { success: true };
        } catch (error) {
            console.error('[Zoho Match] Link failed:', error);
            return { success: false, error: error.message };
        }
    }
}

module.exports = new ZohoCustomerMatchingService();

// ========================================
// Usage in your webhook/message handler:
// ========================================

/*
// In routes/webhook.js or your message handler:

const zohoMatching = require('./services/zohoCustomerMatchingService');

// When customer sends first message
const matchResult = await zohoMatching.matchAndSyncCustomer(
    tenantId, 
    phoneNumber
);

if (matchResult.success) {
    console.log('Customer matched:', matchResult.action);
    // Customer data is now in your database
} else {
    console.log('No Zoho match found');
    // Continue with normal flow
}
*/

