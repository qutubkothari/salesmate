const express = require('express');
const router = express.Router();
const { supabase } = require('../../services/config');
const crypto = require('crypto');
const { validate, zTrimmedString, zOptionalTrimmedString, z } = require('../../middleware/validate');

const loginBodySchema = z
    .object({
        phone: zTrimmedString(3, 40),
        password: zTrimmedString(1, 200),
    })
    .strict();

const changePasswordBodySchema = z
    .object({
        tenantId: zTrimmedString(1, 128),
        currentPassword: zTrimmedString(1, 200),
        newPassword: zTrimmedString(1, 200),
    })
    .strict();

/**
 * POST /api/auth/login
 * Login with phone number and password
 */
router.post('/login', validate({ body: loginBodySchema }), async (req, res) => {
    try {
        const { phone, password } = req.body;

        if (!phone || !password) {
            return res.status(400).json({
                success: false,
                error: 'Phone number and password are required'
            });
        }

        const normalizePhoneDigits = (value) => {
            if (!value) return '';
            const withoutSuffix = String(value).replace(/@c\.us$/i, '');
            return withoutSuffix.replace(/\D/g, '');
        };

        const inputDigits = normalizePhoneDigits(phone);
        if (!inputDigits) {
            return res.status(400).json({
                success: false,
                error: 'Phone number is invalid'
            });
        }

        console.log('[AUTH] Login attempt for phone digits:', inputDigits);

        // Try multiple phone number formats to find tenant
        // Format 1: Just digits (e.g., 919537653927)
        // Format 2: With @c.us suffix (e.g., 919537653927@c.us)
        const phoneFormats = [
            inputDigits,
            `${inputDigits}@c.us`
        ];

        const getTenantId = (tenantRow) => tenantRow?.id || tenantRow?.tenantId || tenantRow?.tenant_id;
        const getBusinessName = (tenantRow) =>
            tenantRow?.business_name ||
            tenantRow?.businessName ||
            tenantRow?.business ||
            tenantRow?.tenant_name ||
            tenantRow?.tenantName ||
            tenantRow?.company_name ||
            tenantRow?.companyName ||
            tenantRow?.store_name ||
            tenantRow?.storeName ||
            tenantRow?.shop_name ||
            tenantRow?.shopName ||
            tenantRow?.name;
        const getPrimaryPhone = (tenantRow) => tenantRow?.phone_number || tenantRow?.phoneNumber || tenantRow?.phone || tenantRow?.owner_whatsapp_number || tenantRow?.ownerWhatsappNumber;
        const getPasswordField = (tenantRow) => tenantRow?.password || tenantRow?.pass || tenantRow?.pwd;

        let tenant = null;

        // Try a few likely column names first (fast path)
        const phoneColumnsToTry = ['phone_number', 'phone', 'owner_whatsapp_number', 'owner_phone'];
        for (const col of phoneColumnsToTry) {
            if (tenant) break;
            for (const phoneFormat of phoneFormats) {
                const { data, error } = await supabase
                    .from('tenants')
                    .select('*')
                    .eq(col, phoneFormat)
                    .single();

                if (data && !error) {
                    tenant = data;
                    break;
                }
            }
        }

        // Fallback: allow login without country code or with extra formatting.
        // We do a safe suffix match against stored digits across multiple possible fields.
        // If ambiguous, fail.
        if (!tenant) {
            const { data: allTenants, error: listError } = await supabase
                .from('tenants')
                .select('*');

            if (!listError && Array.isArray(allTenants)) {
                const matches = allTenants.filter((t) => {
                    const phoneDigits = normalizePhoneDigits(t.phone_number || t.phoneNumber || t.phone);
                    const ownerDigits = normalizePhoneDigits(t.owner_whatsapp_number || t.ownerWhatsappNumber || t.owner_phone);
                    return (
                        (phoneDigits && phoneDigits.endsWith(inputDigits)) ||
                        (ownerDigits && ownerDigits.endsWith(inputDigits))
                    );
                });

                if (matches.length === 1) {
                    tenant = matches[0];
                }
            }
        }

        if (!tenant) {
            console.log('[AUTH] Tenant not found for any format:', phoneFormats);
            return res.status(401).json({
                success: false,
                error: 'Invalid phone number or password'
            });
        }

        // Check if password field exists, if not, fall back to business name
        const storedPassword = getPasswordField(tenant) || getBusinessName(tenant);
        if (!storedPassword) {
            console.log('[AUTH] Tenant has no password or business name set:', getTenantId(tenant));
            return res.status(401).json({
                success: false,
                error: 'Account not configured for password login'
            });
        }

        // Simple password comparison (you can enhance this with bcrypt later)
        if (password !== storedPassword) {
            console.log('[AUTH] Invalid password for phone digits:', inputDigits);
            return res.status(401).json({
                success: false,
                error: 'Invalid phone number or password'
            });
        }

        console.log('[AUTH] Login successful for:', getBusinessName(tenant) || getTenantId(tenant));

        // Create session object
        const session = {
            tenantId: getTenantId(tenant),
            businessName: getBusinessName(tenant) || inputDigits || String(getTenantId(tenant) || 'Sales Dashboard'),
            phoneNumber: getPrimaryPhone(tenant),
            loginTime: new Date().toISOString()
        };

        if (!session.tenantId || !session.businessName) {
            console.warn('[AUTH] Login succeeded but session fields are incomplete:', session);
        }

        res.json({
            success: true,
            message: 'Login successful',
            session: session
        });

    } catch (error) {
        console.error('[AUTH] Login error:', error);
        res.status(500).json({
            success: false,
            error: 'An error occurred during login'
        });
    }
});

/**
 * POST /api/auth/change-password
 * Change user password
 */
router.post('/change-password', validate({ body: changePasswordBodySchema }), async (req, res) => {
    try {
        const { tenantId, currentPassword, newPassword } = req.body;

        if (!tenantId || !currentPassword || !newPassword) {
            return res.status(400).json({
                success: false,
                error: 'All fields are required'
            });
        }

        // Get tenant
        const { data: tenant, error: tenantError } = await supabase
            .from('tenants')
            .select('*')
            .eq('id', tenantId)
            .single();

        if (tenantError || !tenant) {
            return res.status(404).json({
                success: false,
                error: 'Tenant not found'
            });
        }

        // Verify current password
        const storedPassword = tenant.password || tenant.business_name;
        if (currentPassword !== storedPassword) {
            return res.status(401).json({
                success: false,
                error: 'Current password is incorrect'
            });
        }

        // Update password
        const { error: updateError } = await supabase
            .from('tenants')
            .update({ password: newPassword })
            .eq('id', tenantId);

        if (updateError) {
            throw updateError;
        }

        console.log('[AUTH] Password changed for tenant:', tenantId);

        res.json({
            success: true,
            message: 'Password changed successfully'
        });

    } catch (error) {
        console.error('[AUTH] Change password error:', error);
        res.status(500).json({
            success: false,
            error: 'An error occurred while changing password'
        });
    }
});

/**
 * POST /api/auth/logout
 * Logout (client-side will clear localStorage)
 */
router.post('/logout', async (req, res) => {
    res.json({
        success: true,
        message: 'Logged out successfully'
    });
});

module.exports = router;
