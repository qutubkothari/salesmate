/**
 * CustomerService - Centralized Customer Profile Management
 * 
 * This service is the SINGLE SOURCE OF TRUTH for all customer profile operations.
 * It guarantees:
 * 1. Profile exists for every customer interaction
 * 2. Consistent phone format (with @c.us)
 * 3. Atomic operations with proper error handling
 * 4. Validation before database operations
 * 
 * @module services/core/CustomerService
 */

const { supabase, USE_LOCAL_DB } = require('../config');
const { toWhatsAppFormat, normalizePhone } = require('../../utils/phoneUtils');

/**
 * Validate phone number format
 * @private
 */
function validatePhone(phone) {
    if (!phone || typeof phone !== 'string') {
        throw new Error('Phone number is required and must be a string');
    }
    
    const normalized = normalizePhone(phone);
    if (normalized.length < 10 || normalized.length > 15) {
        throw new Error(`Invalid phone number length: ${normalized.length}`);
    }
    
    return true;
}

/**
 * Validate tenant ID
 * @private
 */
function validateTenantId(tenantId) {
    if (!tenantId) {
        throw new Error('Tenant ID is required');
    }
    return true;
}

/**
 * Get or create customer profile - GUARANTEED to return a profile
 * This is called on EVERY customer interaction to ensure profile exists
 * 
 * @param {string} tenantId - Tenant UUID
 * @param {string} phoneNumber - Customer phone (any format)
 * @returns {Promise<{profile: Object, created: boolean}>}
 */
async function ensureCustomerProfile(tenantId, phoneNumber) {
    try {
        validateTenantId(tenantId);
        validatePhone(phoneNumber);

        const phoneCol = USE_LOCAL_DB ? 'phone_number' : 'phone';
        const storedPhone = USE_LOCAL_DB ? normalizePhone(phoneNumber) : toWhatsAppFormat(phoneNumber);
        console.log(`[CustomerService] Ensuring profile exists: ${storedPhone}`);
        
        // First, try to get existing profile
        const { data: existingProfile, error: fetchError } = await supabase
            .from('customer_profiles')
            .select('*')
            .eq('tenant_id', tenantId)
            .eq(phoneCol, storedPhone)
            .maybeSingle();
        
        if (fetchError && fetchError.code !== 'PGRST116') {
            console.error('[CustomerService] Error fetching profile:', fetchError);
            throw new Error(`Failed to fetch customer profile: ${fetchError.message}`);
        }
        
        // Profile exists - return it
        if (existingProfile) {
            console.log(`[CustomerService] Profile exists: ${existingProfile.id}`);
            return { profile: existingProfile, created: false };
        }
        
        // Profile doesn't exist - create it
        console.log(`[CustomerService] Creating new profile for: ${storedPhone}`);
        const now = new Date().toISOString();
        const profileData = USE_LOCAL_DB
            ? {
                tenant_id: tenantId,
                [phoneCol]: storedPhone,
                customer_type: 'retail',
                lead_score: 0,
                total_orders: 0,
                total_spent: 0,
                created_at: now,
                updated_at: now
              }
            : {
                tenant_id: tenantId,
                [phoneCol]: storedPhone,
                customer_tier: 'standard',
                credit_limit: '0.00',
                payment_terms: 'cod',
                total_orders: 0,
                total_spent: '0.00',
                communication_preference: 'whatsapp',
                business_verified: false,
                onboarding_completed: false,
                customer_source: 'whatsapp',
                retail_visit_count: 0,
                created_at: now,
                updated_at: now,
                first_contact_date: now
              };
        
        const { data: newProfile, error: createError } = await supabase
            .from('customer_profiles')
            .insert(profileData)
            .select()
            .single();
        
        if (createError) {
            console.error('[CustomerService] Error creating profile:', createError);
            
            // If error is duplicate, try to fetch again (race condition)
            if (createError.code === '23505') {
                console.log('[CustomerService] Duplicate detected, fetching existing profile');
                const { data: retryProfile } = await supabase
                    .from('customer_profiles')
                    .select('*')
                    .eq('tenant_id', tenantId)
                    .eq(phoneCol, storedPhone)
                    .single();
                
                if (retryProfile) {
                    return { profile: retryProfile, created: false };
                }
            }
            
            throw new Error(`Failed to create customer profile: ${createError.message}`);
        }
        
        console.log(`[CustomerService] Profile created successfully: ${newProfile.id}`);
        return { profile: newProfile, created: true };
        
    } catch (error) {
        console.error('[CustomerService] ensureCustomerProfile failed:', error.message);
        throw error;
    }
}

/**
 * Get customer profile by phone
 * Returns null if not found (use ensureCustomerProfile to create)
 * 
 * @param {string} tenantId - Tenant UUID
 * @param {string} phoneNumber - Customer phone (any format)
 * @returns {Promise<Object|null>}
 */
async function getCustomerProfile(tenantId, phoneNumber) {
    try {
        validateTenantId(tenantId);
        validatePhone(phoneNumber);
        
        const phoneCol = USE_LOCAL_DB ? 'phone_number' : 'phone';
        const storedPhone = USE_LOCAL_DB ? normalizePhone(phoneNumber) : toWhatsAppFormat(phoneNumber);
        
        const { data, error } = await supabase
            .from('customer_profiles')
            .select('*')
            .eq('tenant_id', tenantId)
            .eq(phoneCol, storedPhone)
            .maybeSingle();
        
        if (error && error.code !== 'PGRST116') {
            console.error('[CustomerService] Error fetching profile:', error);
            throw new Error(`Failed to get customer profile: ${error.message}`);
        }
        
        return data;
        
    } catch (error) {
        console.error('[CustomerService] getCustomerProfile failed:', error.message);
        throw error;
    }
}

/**
 * Update customer profile fields
 * Only updates provided fields, doesn't overwrite others
 * 
 * @param {string} tenantId - Tenant UUID
 * @param {string} phoneNumber - Customer phone (any format)
 * @param {Object} updates - Fields to update
 * @returns {Promise<Object>} Updated profile
 */
async function updateCustomerProfile(tenantId, phoneNumber, updates) {
    try {
        validateTenantId(tenantId);
        validatePhone(phoneNumber);
        
        if (!updates || typeof updates !== 'object') {
            throw new Error('Updates object is required');
        }
        
        const whatsappPhone = toWhatsAppFormat(phoneNumber);
        
        // Add updated_at timestamp
        const updateData = {
            ...updates,
            updated_at: new Date().toISOString()
        };
        
        // Don't allow updating tenant_id or phone
        delete updateData.tenant_id;
        delete updateData.phone;
        delete updateData.created_at;
        
        console.log(`[CustomerService] Updating profile: ${whatsappPhone}`, Object.keys(updateData));
        
        const { data, error } = await supabase
            .from('customer_profiles')
            .update(updateData)
            .eq('tenant_id', tenantId)
            .eq('phone', whatsappPhone)
            .select()
            .single();
        
        if (error) {
            console.error('[CustomerService] Error updating profile:', error);
            throw new Error(`Failed to update customer profile: ${error.message}`);
        }
        
        if (!data) {
            throw new Error('Profile not found for update');
        }
        
        console.log(`[CustomerService] Profile updated successfully: ${data.id}`);
        return data;
        
    } catch (error) {
        console.error('[CustomerService] updateCustomerProfile failed:', error.message);
        throw error;
    }
}

/**
 * Update customer name from WhatsApp profile
 * Handles name sync logic with timestamp check
 * 
 * @param {string} tenantId - Tenant UUID
 * @param {string} phoneNumber - Customer phone
 * @param {string} firstName - First name from WhatsApp
 * @param {string} lastName - Last name from WhatsApp (optional)
 * @returns {Promise<boolean>} True if updated, false if skipped
 */
async function syncCustomerName(tenantId, phoneNumber, firstName, lastName = null) {
    try {
        if (!firstName) {
            console.log('[CustomerService] No name provided, skipping sync');
            return false;
        }
        
        const profile = await getCustomerProfile(tenantId, phoneNumber);
        if (!profile) {
            console.log('[CustomerService] Profile not found for name sync');
            return false;
        }
        
        // Check if we should update (name changed or never set)
        const shouldUpdate = !profile.first_name || 
                           profile.first_name !== firstName ||
                           (lastName && profile.last_name !== lastName);
        
        if (!shouldUpdate) {
            console.log('[CustomerService] Name unchanged, skipping update');
            return false;
        }
        
        await updateCustomerProfile(tenantId, phoneNumber, {
            first_name: firstName,
            last_name: lastName
        });
        
        console.log(`[CustomerService] Name synced: ${firstName} ${lastName || ''}`);
        return true;
        
    } catch (error) {
        console.error('[CustomerService] syncCustomerName failed:', error.message);
        // Don't throw - name sync failures shouldn't break the flow
        return false;
    }
}

/**
 * Save GST preference for customer
 * 
 * @param {string} tenantId - Tenant UUID
 * @param {string} phoneNumber - Customer phone
 * @param {string|null} preference - 'with_gst', 'no_gst', or null to clear
 * @param {string} gstNumber - GST number (optional, for with_gst)
 * @returns {Promise<Object>} Updated profile
 */
async function saveGSTPreference(tenantId, phoneNumber, preference, gstNumber = null) {
    try {
        // Allow null to clear preference, otherwise validate
        if (preference !== null && !['with_gst', 'no_gst'].includes(preference)) {
            throw new Error(`Invalid GST preference: ${preference}. Must be 'with_gst', 'no_gst', or null`);
        }
        
        console.log(`[CustomerService] Saving GST preference: ${preference} for ${phoneNumber}`);
        
        const updates = { gst_preference: preference };
        if (gstNumber && preference === 'with_gst') {
            updates.gst_number = gstNumber.toUpperCase();
        } else {
            updates.gst_number = null;
        }
        
        const profile = await updateCustomerProfile(tenantId, phoneNumber, updates);
        
        console.log(`[CustomerService] GST preference saved successfully`);
        return profile;
        
    } catch (error) {
        console.error('[CustomerService] saveGSTPreference failed:', error.message);
        throw error;
    }
}

/**
 * Get GST preference for customer
 * 
 * @param {string} tenantId - Tenant UUID
 * @param {string} phoneNumber - Customer phone
 * @returns {Promise<{hasPreference: boolean, preference: string|null, gst_number: string|null}>}
 */
async function getGSTPreference(tenantId, phoneNumber) {
    try {
        const profile = await getCustomerProfile(tenantId, phoneNumber);
        
        if (!profile) {
            return { hasPreference: false, preference: null, gst_number: null };
        }
        
        return {
            hasPreference: !!profile.gst_preference,
            preference: profile.gst_preference,
            gst_number: profile.gst_number,
            profileId: profile.id
        };
        
    } catch (error) {
        console.error('[CustomerService] getGSTPreference failed:', error.message);
        return { hasPreference: false, preference: null, gst_number: null };
    }
}

module.exports = {
    ensureCustomerProfile,
    getCustomerProfile,
    updateCustomerProfile,
    syncCustomerName,
    saveGSTPreference,
    getGSTPreference
};
