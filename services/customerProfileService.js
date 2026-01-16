// services/customerProfileService.js
const { dbClient } = require('./config');
const { normalizePhone, toWhatsAppFormat } = require('../utils/phoneUtils');

// ALWAYS use local SQLite now (Supabase deprecated)
const USE_LOCAL_DB = true;
const CUSTOMER_PHONE_COL = 'phone_number';

function normalizeCustomerRow(row) {
    if (!row || typeof row !== 'object') return row;
    const phone = row.phone ?? row.phone_number ?? row.phoneNumber ?? null;
    const name = row.name ?? row.business_name ?? row.first_name ?? row.customer_name ?? null;
    return { ...row, phone, name };
}

/**
 * Search customers by tenantId and optional filters
 * @param {Object} params - { tenantId, phone, name, minSpent, maxSpent, minOrderDate, maxOrderDate }
 * @returns {Promise<{ customers: Array }>} 
 */
async function searchCustomers(params) {
    const { tenantId, phone, name, minSpent, maxSpent, minOrderDate, maxOrderDate } = params;
    let query = dbClient
        .from('customer_profiles_new')
        .select('*')
        .eq('tenant_id', tenantId);

    if (phone) query = query.ilike(CUSTOMER_PHONE_COL, `%${phone}%`);
    if (name) {
        if (USE_LOCAL_DB) {
            query = query.ilike('name', `%${name}%`);
        } else {
            // Postgres: support multiple possible name columns
            query = query.or(`name.ilike.%${name}%,first_name.ilike.%${name}%,business_name.ilike.%${name}%`);
        }
    }
    if (minSpent) query = query.gte('total_spent', minSpent);
    if (maxSpent) query = query.lte('total_spent', maxSpent);
    if (minOrderDate) query = query.gte('last_order_date', minOrderDate);
    if (maxOrderDate) query = query.lte('last_order_date', maxOrderDate);

    const { data, error } = await query;
    if (error) return { customers: [], error };
    return { customers: (data || []).map(normalizeCustomerRow) };
}

async function getCustomerByPhone(tenantId, rawPhone) {
    const normalizedPhone = normalizePhone(rawPhone);
    if (!tenantId || !normalizedPhone) return { customer: null, error: null };

    const { data, error } = await dbClient
        .from('customer_profiles_new')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq(CUSTOMER_PHONE_COL, normalizedPhone)
        .maybeSingle();

    if (error && error.code !== 'PGRST116') {
        return { customer: null, error };
    }
    return { customer: data ? normalizeCustomerRow(data) : null, error: null };
}

async function upsertCustomerByPhone(tenantId, rawPhone, profileData) {
    const normalizedPhone = normalizePhone(rawPhone);
    if (!tenantId || !normalizedPhone) {
        throw new Error('tenantId and phone are required');
    }

    const allowed = {
        name: profileData?.name ?? null,
        email: profileData?.email ?? null,
        customer_type: profileData?.customer_type ?? null,
        address: profileData?.address ?? null,
        city: profileData?.city ?? null,
        state: profileData?.state ?? null,
        pincode: profileData?.pincode ?? null,
        gst_number: profileData?.gst_number ?? null,
        lead_score: profileData?.lead_score ?? null
    };

    // Remove null/undefined keys we don't want to overwrite unless explicitly provided
    Object.keys(allowed).forEach((k) => {
        if (allowed[k] === undefined) delete allowed[k];
    });

    const now = new Date().toISOString();
    const { customer: existing } = await getCustomerByPhone(tenantId, normalizedPhone);

    if (existing && existing.id) {
        const { data, error } = await dbClient
            .from('customer_profiles_new')
            .update({ ...allowed, updated_at: now })
            .eq('tenant_id', tenantId)
            .eq('id', existing.id)
            .select('*')
            .single();

        if (error) throw error;
        return normalizeCustomerRow(data);
    }

    const insertPayload = {
        tenant_id: tenantId,
        [CUSTOMER_PHONE_COL]: normalizedPhone,
        ...allowed,
        created_at: now,
        updated_at: now
    };

    const { data, error } = await dbClient
        .from('customer_profiles_new')
        .insert(insertPayload)
        .select('*')
        .single();

    if (error) throw error;
    return normalizeCustomerRow(data);
}

/**
 * Get customer profile with NORMALIZED phone lookup
 * This prevents duplicate profiles
 * @param {string|number} tenantId
 * @param {string|number} rawPhone
 * @returns {Promise<Object|null>} profile or null
 */
async function getCustomerProfile(tenantId, rawPhone) {
    // CRITICAL: Always normalize before database lookup
    const normalizedPhone = normalizePhone(rawPhone);
    
    console.log('[CUSTOMER_PROFILE] Lookup:', {
        raw: rawPhone,
        normalized: normalizedPhone
    });
    
    const { data: profile, error } = await dbClient
        .from('customer_profiles_new')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq(CUSTOMER_PHONE_COL, normalizedPhone)  // ✅ Use normalized phone
        .maybeSingle();
    
    if (error && error.code !== 'PGRST116') {
        console.error('[CUSTOMER_PROFILE] Error:', error.message);
        return null;
    }
    
    return profile;
}

/**
 * Create or update customer profile
 * ALWAYS uses normalized phone
 * @param {string|number} tenantId
 * @param {string|number} rawPhone
 * @param {Object} profileData
 * @returns {Promise<Object>} profile
 */
async function upsertCustomerProfile(tenantId, rawPhone, profileData) {
    const normalizedPhone = normalizePhone(rawPhone);
    
    console.log('[CUSTOMER_PROFILE] Upsert:', {
        raw: rawPhone,
        normalized: normalizedPhone,
        data: profileData
    });
    
    // dbClient has upsert; local SQLite wrapper does not.
    if (!USE_LOCAL_DB && typeof dbClient.from('customer_profiles_new').upsert === 'function') {
        const { data, error } = await dbClient
            .from('customer_profiles_new')
            .upsert({
                tenant_id: tenantId,
                [CUSTOMER_PHONE_COL]: normalizedPhone,
                ...profileData,
                updated_at: new Date().toISOString()
            }, {
                onConflict: 'tenant_id,phone'
            })
            .select()
            .single();

        if (error) {
            console.error('[CUSTOMER_PROFILE] Upsert error:', error.message);
            throw error;
        }
        return data;
    }

    // Manual upsert for local mode
    return await upsertCustomerByPhone(tenantId, normalizedPhone, profileData);
}

/**
 * Sync customer profile from WhatsApp API
 * @param {string} tenantId - Tenant ID
 * @param {string} phoneNumber - Customer phone number
 * @param {Object} whatsappProfile - WhatsApp profile data
 * @returns {Object} Sync result
 */
const syncCustomerProfile = async (tenantId, phoneNumber, whatsappProfile = null) => {
    try {
        console.log('[CUSTOMER_PROFILE] Syncing profile for:', phoneNumber);

        // If no profile data provided, try to fetch from WhatsApp API
        if (!whatsappProfile) {
            whatsappProfile = await fetchWhatsAppProfile(phoneNumber);
        }

        // Get existing conversation
        const { data: conversation, error: convErr } = await dbClient
            .from('conversations_new')
            .select('id, customer_name, customer_name_updated_at')
            .eq('tenant_id', tenantId)
            .eq('end_user_phone', phoneNumber)
            .maybeSingle();

        if (convErr) {
            console.warn('[CUSTOMER_PROFILE] Conversation fetch error:', convErr);
        }

        if (!conversation) {
            console.log('[CUSTOMER_PROFILE] No conversation found, creating customer profile anyway.');
            // Create customer profile with WhatsApp format (includes @c.us)
            const whatsappPhone = toWhatsAppFormat(phoneNumber);
            const profileData = {
                tenant_id: tenantId,
                phone: whatsappPhone,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
            };
            const { data: profile, error } = await dbClient
                .from('customer_profiles_new')
                .upsert(profileData, { onConflict: 'tenant_id,phone' })
                .select()
                .single();
            if (error) {
                console.error('[CUSTOMER_PROFILE] Upsert error:', error.message);
                return { success: false, error: error.message };
            }
            return { success: true, created: true, profile };
        }

        // Conversation exists - ensure customer_profiles record exists too
        const whatsappPhone = toWhatsAppFormat(phoneNumber);
        const { data: existingProfile, error: profileCheckError } = await dbClient
            .from('customer_profiles_new')
            .select('id')
            .eq('tenant_id', tenantId)
            .eq('phone', whatsappPhone)
            .maybeSingle();

        if (!existingProfile && !profileCheckError) {
            console.log('[CUSTOMER_PROFILE] Creating missing customer_profiles record for existing conversation');
            const profileData = {
                tenant_id: tenantId,
                phone: whatsappPhone,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
            };
            const { error: createError } = await dbClient
                .from('customer_profiles_new')
                .insert(profileData);
            
            if (createError) {
                console.error('[CUSTOMER_PROFILE] Error creating profile:', createError.message);
            } else {
                console.log('[CUSTOMER_PROFILE] Customer profile created successfully');
            }
        }

        // Extract name from WhatsApp profile
        const newName = extractNameFromProfile(whatsappProfile);
        const currentName = conversation.customer_name;
        const lastUpdated = conversation.customer_name_updated_at;

        console.log('[CUSTOMER_PROFILE] Profile comparison:', {
            currentName,
            newName,
            lastUpdated
        });

        // Determine if update is needed
        const shouldUpdate = shouldUpdateCustomerName(currentName, newName, lastUpdated);

        if (!shouldUpdate.update) {
            console.log('[CUSTOMER_PROFILE] No update needed:', shouldUpdate.reason);
            return { 
                success: true, 
                updated: false, 
                reason: shouldUpdate.reason,
                currentName: currentName
            };
        }

        // Update customer name
        const { data: updated, error } = await dbClient
            .from('conversations_new')
            .update({
                customer_name: newName,
                customer_name_updated_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
            })
            .eq('id', conversation.id)
            .select('customer_name, customer_name_updated_at')
            .maybeSingle();

        if (error) {
            throw error;
        }

        console.log('[CUSTOMER_PROFILE] Profile updated successfully:', {
            oldName: currentName,
            newName: newName,
            conversationId: conversation.id
        });

        return {
            success: true,
            updated: true,
            oldName: currentName,
            newName: newName,
            conversationId: conversation.id
        };

    } catch (error) {
        console.error('[CUSTOMER_PROFILE] Error syncing profile:', error && error.message ? error.message : error);
        return { success: false, error: error && error.message ? error.message : String(error) };
    }
};

/**
 * Fetch WhatsApp profile information
 * @param {string} phoneNumber - Customer phone number
 * @returns {Object|null} WhatsApp profile data
 */
const fetchWhatsAppProfile = async (phoneNumber) => {
    try {
        // This depends on your WhatsApp API provider (Maytapi, etc.)
        // You might need to adjust this based on your specific API
        
        console.log('[CUSTOMER_PROFILE] Fetching WhatsApp profile for:', phoneNumber);

        // Example for Maytapi (adjust based on your provider)
        if (process.env.MAYTAPI_TOKEN && process.env.MAYTAPI_PHONE_ID) {
            const response = await fetch(
                `https://api.maytapi.com/api/${process.env.MAYTAPI_PHONE_ID}/getProfile/${phoneNumber}`,
                {
                    headers: {
                        'x-maytapi-key': process.env.MAYTAPI_TOKEN
                    }
                }
            );

            if (response.ok) {
                const data = await response.json();
                console.log('[CUSTOMER_PROFILE] WhatsApp API response:', data);
                return data;
            } else {
                console.warn('[CUSTOMER_PROFILE] WhatsApp API error:', response.status);
            }
        }

        // If WhatsApp API is not available, return null
        return null;

    } catch (error) {
        console.error('[CUSTOMER_PROFILE] Error fetching WhatsApp profile:', error && error.message ? error.message : error);
        return null;
    }
};

/**
 * Extract customer name from WhatsApp profile data
 * @param {Object} profile - WhatsApp profile data
 * @returns {string|null} Extracted name
 */
const extractNameFromProfile = (profile) => {
    if (!profile) {
        return null;
    }

    // Try different possible name fields based on API provider
    const possibleNameFields = [
        'name',
        'pushname', 
        'notify',
        'displayName',
        'formattedName',
        'verifiedName'
    ];

    for (const field of possibleNameFields) {
        if (profile[field] && typeof profile[field] === 'string') {
            const name = profile[field].trim();
            if (name.length > 0 && name.length < 100) {
                return name;
            }
        }
    }

    // If profile has nested structure, try to extract from it
    if (profile.contact && profile.contact.name) {
        return profile.contact.name.trim();
    }

    if (profile.user && profile.user.name) {
        return profile.user.name.trim();
    }

    return null;
};

/**
 * Determine if customer name should be updated
 * @param {string} currentName - Current name in database
 * @param {string} newName - New name from WhatsApp
 * @param {string} lastUpdated - Last update timestamp
 * @returns {Object} Update decision
 */
const shouldUpdateCustomerName = (currentName, newName, lastUpdated) => {
    // If no new name available, don't update
    if (!newName) {
        return { update: false, reason: 'No new name available' };
    }

    // If no current name, always update
    if (!currentName) {
        return { update: true, reason: 'No current name stored' };
    }

    // If names are the same, don't update
    if (currentName.toLowerCase().trim() === newName.toLowerCase().trim()) {
        return { update: false, reason: 'Names are identical' };
    }

    // Check if enough time has passed since last update (prevent too frequent updates)
    if (lastUpdated) {
        const hoursSinceUpdate = (new Date() - new Date(lastUpdated)) / (1000 * 60 * 60);
        
        // Only update if it's been more than 24 hours since last update
        if (hoursSinceUpdate < 24) {
            return { 
                update: false, 
                reason: `Updated recently (${hoursSinceUpdate.toFixed(1)} hours ago)` 
            };
        }
    }

    // Update if names are different and enough time has passed
    return { update: true, reason: 'Names differ and update interval met' };
};

/**
 * Batch sync customer profiles (for maintenance/cleanup)
 * @param {string} tenantId - Tenant ID
 * @param {number} batchSize - Number of profiles to sync
 * @returns {Object} Batch sync result
 */
const batchSyncCustomerProfiles = async (tenantId, batchSize = 10) => {
    try {
        console.log('[CUSTOMER_PROFILE] Starting batch sync for tenant:', tenantId);

        // Get conversations that need profile updates
        // Priority: conversations without names or old updates
        const { data: conversations, error } = await dbClient
            .from('conversations_new')
            .select('id, end_user_phone, customer_name, customer_name_updated_at')
            .eq('tenant_id', tenantId)
            .or(`customer_name.is.null,customer_name_updated_at.lt.${new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()}`)
            .limit(batchSize);

        if (error) {
            throw error;
        }

        const results = {
            total: conversations.length,
            updated: 0,
            skipped: 0,
            errors: 0,
            details: []
        };

        // Process each conversation
        for (const conversation of conversations) {
            try {
                const syncResult = await syncCustomerProfile(
                    tenantId, 
                    conversation.end_user_phone
                );

                if (syncResult.success && syncResult.updated) {
                    results.updated++;
                } else {
                    results.skipped++;
                }

                results.details.push({
                    phoneNumber: conversation.end_user_phone,
                    result: syncResult
                });

                // Small delay to avoid rate limiting
                await new Promise(resolve => setTimeout(resolve, 100));

            } catch (error) {
                results.errors++;
                results.details.push({
                    phoneNumber: conversation.end_user_phone,
                    result: { success: false, error: error.message }
                });
            }
        }

        console.log('[CUSTOMER_PROFILE] Batch sync completed:', results);
        return results;

    } catch (error) {
        console.error('[CUSTOMER_PROFILE] Error in batch sync:', error.message);
        return { success: false, error: error.message };
    }
};

/**
 * Clean up invalid customer names
 * @param {string} tenantId - Tenant ID
 * @returns {Object} Cleanup result
 */
const cleanupCustomerNames = async (tenantId) => {
    try {
        console.log('[CUSTOMER_PROFILE] Starting name cleanup for tenant:', tenantId);

        // Find conversations with potentially invalid names
        const { data: conversations, error } = await dbClient
            .from('conversations_new')
            .select('id, customer_name')
            .eq('tenant_id', tenantId)
            .not('customer_name', 'is', null);

        if (error) {
            throw error;
        }

        let cleaned = 0;

        for (const conversation of conversations) {
            const name = conversation.customer_name;
            
            // Check if name needs cleanup
            if (shouldCleanupName(name)) {
                const cleanedName = cleanupName(name);
                
                if (cleanedName !== name) {
                    const { error: updateError } = await dbClient
                        .from('conversations_new')
                        .update({ 
                            customer_name: cleanedName,
                            customer_name_updated_at: new Date().toISOString()
                        })
                        .eq('id', conversation.id);

                    if (!updateError) {
                        cleaned++;
                        console.log('[CUSTOMER_PROFILE] Cleaned name:', { 
                            old: name, 
                            new: cleanedName 
                        });
                    }
                }
            }
        }

        return { success: true, cleaned };

    } catch (error) {
        console.error('[CUSTOMER_PROFILE] Error in cleanup:', error.message);
        return { success: false, error: error.message };
    }
};

/**
 * Check if a name needs cleanup
 */
const shouldCleanupName = (name) => {
    if (!name || typeof name !== 'string') return false;
    
    // Check for obviously invalid names
    const invalidPatterns = [
        /^\+?\d+$/,  // Only numbers/phone numbers
        /^null$|^undefined$/i,
        /^\s*$/,     // Only whitespace
        /[^\w\s\-\'\.]/g  // Invalid characters (except basic punctuation)
    ];

    return invalidPatterns.some(pattern => pattern.test(name));
};

/**
 * Clean up a customer name
 */
const cleanupName = (name) => {
    if (!name) return null;
    
    // Remove invalid characters, keep only letters, numbers, spaces, hyphens, apostrophes, dots
    let cleaned = name.replace(/[^\w\s\-\'\.]/g, '').trim();
    
    // If name becomes empty or is just numbers, return null
    if (!cleaned || /^\d+$/.test(cleaned)) {
        return null;
    }
    
    // Limit length
    if (cleaned.length > 50) {
        cleaned = cleaned.substring(0, 50).trim();
    }
    
    return cleaned;
};

module.exports = {
    syncCustomerProfile,
    fetchWhatsAppProfile,
    extractNameFromProfile,
    getCustomerProfile,
    upsertCustomerProfile,  // ✅ Export new function
    getCustomerByPhone,
    upsertCustomerByPhone,
    batchSyncCustomerProfiles,
    cleanupCustomerNames,
    shouldUpdateCustomerName,
    searchCustomers
};


