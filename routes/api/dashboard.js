// IMPORTANT: The only valid /api/dashboard/conversations/:tenantId endpoint is below.
// It must only query the 'conversations' table and never construct objects from customer_profiles or merge in a way that overwrites the id.
const express = require('express');
const router = express.Router();
const { dbClient, USE_LOCAL_DB, db } = require('../../services/config');
const { sendMessage } = require('../../services/whatsappService');
const multer = require('multer');
const DocumentIngestionService = require('../../services/documentIngestionService');
const { writeAuditLog } = require('../../services/auditLogService');
const { requireAuth } = require('../../middleware/authMiddleware');

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 15 * 1024 * 1024 } // 15MB
});

/**
 * GET /api/dashboard/verify-token
 * Verify magic link token and return tenant info
 */
router.get('/verify-token', async (req, res) => {
    try {
        const { token } = req.query;

        // TEMP: Allow demo access with special token "demo"
        if (token === 'demo') {
            const { data: tenant } = await dbClient
                .from('tenants')
                .select('id, business_name, admin_phones')
                .eq('business_name', 'sak solutions store')
                .single();
            
            if (tenant) {
                console.log('[DASHBOARD_AUTH] Demo access granted for tenant:', tenant.id);
                return res.json({
                    success: true,
                    tenant: {
                        id: tenant.id,
                        business_name: tenant.business_name,
                        admin_phones: tenant.admin_phones
                    }
                });
            }
        }

        if (!token) {
            return res.status(401).json({
                success: false,
                error: 'Token required'
            });
        }

        // Find tenant with this token
        const { data: tenant, error } = await dbClient
            .from('tenants')
            .select('id, business_name, admin_phones, web_auth_token_expires_at')
            .eq('web_auth_token', token)
            .single();

        if (error || !tenant) {
            console.log('[DASHBOARD_AUTH] Invalid token:', token);
            return res.status(401).json({
                success: false,
                error: 'Invalid or expired token'
            });
        }

        // TEMP: Disabled token expiration check for demo purposes
        // const expiresAt = new Date(tenant.web_auth_token_expires_at);
        // if (expiresAt < new Date()) {
        //     console.log('[DASHBOARD_AUTH] Token expired:', token);
        //     return res.status(401).json({
        //         success: false,
        //         error: 'Token expired. Please request a new login link.'
        //     });
        // }

        // TEMP: Token is NOT cleared (allows reuse for demo)
        // await dbClient
        //     .from('tenants')
        //     .update({
        //         web_auth_token: null,
        //         web_auth_token_expires_at: null
        //     })
        //     .eq('id', tenant.id);

        console.log('[DASHBOARD_AUTH] Token verified for tenant:', tenant.id);

        res.json({
            success: true,
            tenant: {
                id: tenant.id,
                business_name: tenant.business_name,
                admin_phones: tenant.admin_phones
            }
        });

    } catch (error) {
        console.error('[DASHBOARD_AUTH] Error verifying token:', error);
        res.status(500).json({
            success: false,
            error: 'Internal server error'
        });
    }
});

/**
 * POST /api/dashboard/verify-token
 * Verify magic link token (POST method for dashboard.html compatibility)
 */
router.post('/verify-token', async (req, res) => {
    try {
        const { token } = req.body;

        // TEMP: Allow demo access with special token "demo"
        if (token === 'demo') {
            const { data: tenant } = await dbClient
                .from('tenants')
                .select('id, business_name, admin_phones')
                .eq('business_name', 'sak solutions store')
                .single();
            
            if (tenant) {
                console.log('[DASHBOARD_AUTH] Demo access granted (POST) for tenant:', tenant.id);
                return res.json({
                    success: true,
                    session: {
                        tenantId: tenant.id,
                        businessName: tenant.business_name,
                        adminPhones: tenant.admin_phones
                    }
                });
            }
        }

        if (!token) {
            return res.status(401).json({
                success: false,
                error: 'Token required'
            });
        }

        // Find tenant with this token
        const { data: tenant, error } = await dbClient
            .from('tenants')
            .select('id, business_name, admin_phones, web_auth_token_expires_at')
            .eq('web_auth_token', token)
            .single();

        if (error || !tenant) {
            console.log('[DASHBOARD_AUTH] Invalid token (POST):', token);
            return res.status(401).json({
                success: false,
                error: 'Invalid or expired token'
            });
        }

        // TEMP: Disabled token expiration check for demo purposes
        // const expiresAt = new Date(tenant.web_auth_token_expires_at);
        // if (expiresAt < new Date()) {
        //     console.log('[DASHBOARD_AUTH] Token expired:', token);
        //     return res.status(401).json({
        //         success: false,
        //         error: 'Token expired. Please request a new login link.'
        //     });
        // }

        console.log('[DASHBOARD_AUTH] Token verified (POST) for tenant:', tenant.id);

        res.json({
            success: true,
            session: {
                tenantId: tenant.id,
                businessName: tenant.business_name,
                adminPhones: tenant.admin_phones
            }
        });

    } catch (error) {
        console.error('[DASHBOARD_AUTH] Error verifying token (POST):', error);
        res.status(500).json({
            success: false,
            error: 'Internal server error'
        });
    }
});

/**
 * GET /api/dashboard/documents/:tenantId
 * List tenant knowledge documents
 */
router.get('/documents/:tenantId', async (req, res) => {
    try {
        const { tenantId } = req.params;

        const { data: documents, error } = await dbClient
            .from('tenant_documents')
            .select('id, tenant_id, filename, original_name, mime_type, size_bytes, created_at')
            .eq('tenant_id', tenantId)
            .order('created_at', { ascending: false });

        if (error) throw error;

        res.json({
            success: true,
            documents: documents || []
        });
    } catch (error) {
        console.error('[DASHBOARD_DOCS] List error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to load documents'
        });
    }
});

/**
 * POST /api/dashboard/documents/:tenantId/upload
 * Upload a document, extract text, and store it for tenant knowledge
 */
router.post('/documents/:tenantId/upload', upload.single('file'), async (req, res) => {
    try {
        const { tenantId } = req.params;

        if (!req.file) {
            return res.status(400).json({
                success: false,
                error: 'No file uploaded'
            });
        }

        const originalName = req.file.originalname || 'document';
        const mimeType = req.file.mimetype || 'application/octet-stream';
        const sizeBytes = req.file.size || req.file.buffer?.length || null;

        const { text: extractedText } = await DocumentIngestionService.extractTextFromUpload({
            buffer: req.file.buffer,
            originalName,
            mimeType
        });

        const { data: inserted, error } = await dbClient
            .from('tenant_documents')
            .insert({
                tenant_id: tenantId,
                filename: originalName,
                original_name: originalName,
                mime_type: mimeType,
                size_bytes: sizeBytes,
                extracted_text: extractedText
            })
            .select()
            .single();

        if (error) throw error;

        res.json({
            success: true,
            document: inserted
        });
    } catch (error) {
        console.error('[DASHBOARD_DOCS] Upload error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to upload document'
        });
    }
});

/**
 * DELETE /api/dashboard/documents/:tenantId/:documentId
 * Delete a tenant knowledge document
 */
router.delete('/documents/:tenantId/:documentId', async (req, res) => {
    try {
        const { tenantId, documentId } = req.params;

        const { error } = await dbClient
            .from('tenant_documents')
            .delete()
            .eq('tenant_id', tenantId)
            .eq('id', documentId);

        if (error) throw error;

        res.json({ success: true });
    } catch (error) {
        console.error('[DASHBOARD_DOCS] Delete error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to delete document'
        });
    }
});

/**
 * GET /api/dashboard/tenant/:tenantId
 * Get tenant information
 */
router.get('/tenant/:tenantId', async (req, res) => {
    try {
        const { tenantId } = req.params;

        const { data: tenant, error } = await dbClient
            .from('tenants')
            .select('id, business_name, admin_phones, created_at')
            .eq('id', tenantId)
            .single();

        if (error) {
            console.error('[DASHBOARD_API] Error fetching tenant:', error);
            return res.status(404).json({
                success: false,
                error: 'Tenant not found',
                details: error.message
            });
        }

        if (!tenant) {
            return res.status(404).json({
                success: false,
                error: 'Tenant not found'
            });
        }

        res.json({
            success: true,
            tenant: tenant
        });

    } catch (error) {
        console.error('[DASHBOARD_API] Error fetching tenant:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch tenant information',
            details: error.message
        });
    }
});

/**
 * REMOVED DUPLICATE /stats/:tenantId endpoint
 * The comprehensive stats endpoint with all counts is at line ~1072
 */

/**
 * REMOVED DUPLICATE - See enriched orders endpoint at line ~1188
 * GET /api/dashboard/orders/:tenantId (DUPLICATE REMOVED)
 * The comprehensive version with items, conversation data, and full pricing is below
 */

/**
 * GET /api/dashboard/customers/:tenantId
 * Get customer list with stats
 */
router.get('/customers/:tenantId', async (req, res) => {
    try {
        const { tenantId } = req.params;

        const { data: customers, error } = await dbClient
            .from('customer_profiles')
            .select('id, phone, first_name, last_name, company, total_spent, total_orders, updated_at')
            .eq('tenant_id', tenantId)
            .order('total_spent', { ascending: false })
            .limit(100);

        if (error) {
            console.error('[DASHBOARD_API] dbClient error fetching customers:', error);
            throw error;
        }

        const formattedCustomers = (customers || []).map(c => ({
            id: c.id,
            name: c.company || `${c.first_name || ''} ${c.last_name || ''}`.trim() || 'Unknown',
            phone: c.phone?.replace('@c.us', '') || '',
            totalOrders: c.total_orders || 0,
            totalSpent: parseFloat(c.total_spent) || 0,
            lastOrder: c.updated_at ? new Date(c.updated_at).toLocaleDateString('en-IN') : 'N/A'
        }));

        res.json({
            success: true,
            customers: formattedCustomers
        });

    } catch (error) {
        console.error('[DASHBOARD_API] Error fetching customers:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch customers',
            details: error.message
        });
    }
});

/**
 * GET /api/dashboard/products/:tenantId
 * Get products for a tenant
 */
router.get('/products/:tenantId', async (req, res) => {
    try {
        const { tenantId } = req.params;

        const { data: products, error } = await dbClient
            .from('products')
            .select('id, name, description, price, stock_quantity, product_type, brand')
            .eq('tenant_id', tenantId)
            .order('name', { ascending: true })
            .limit(100);

        if (error) {
            console.error('[DASHBOARD_API] dbClient error fetching products:', error);
            throw error;
        }

        const formattedProducts = (products || []).map(p => ({
            id: p.id,
            name: p.name || p.product_type || 'Unknown Product',
            description: p.description || (p.brand ? `Brand: ${p.brand}` : 'No description'),
            price: parseFloat(p.price) || 0,
            stock: p.stock_quantity || 0
        }));

        res.json({
            success: true,
            products: formattedProducts
        });

    } catch (error) {
        console.error('[DASHBOARD_API] Error fetching products:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch products',
            details: error.message
        });
    }
});

// Helper functions
function getRelativeTime(timestamp) {
    const now = new Date();
    const past = new Date(timestamp);
    const diffMs = now - past;
    const diffMins = Math.floor(diffMs / 60000);
    
    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins} min ago`;
    
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
    
    const diffDays = Math.floor(diffHours / 24);
    return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
}

function getStateMessage(state) {
    const messages = {
        'greeting': 'Starting conversation...',
        'browsing': 'Browsing products',
        'product_inquiry': 'Asking about products',
        'negotiating': 'Negotiating prices',
        'adding_to_cart': 'Adding items to cart',
        'collecting_business_info': 'Providing business info',
        'collecting_gst': 'Uploading GST certificate',
        'checkout': 'Ready to checkout',
        'awaiting_payment_proof': 'Payment pending'
    };
    return messages[state] || 'Active';
}

/**
 * GET /api/dashboard/tenants
 * Get all tenants for the Zoho admin dashboard
 */
router.get('/tenants', async (req, res) => {
    try {
        const { data: tenants, error } = await dbClient
            .from('tenants')
            .select(`
                id,
                business_name,
                admin_phones,
                created_at,
                zoho_organization_id,
                zoho_organization_name,
                zoho_authorized_at
            `)
            .order('business_name', { ascending: true });

        if (error) {
            console.error('[DASHBOARD_API] Error fetching tenants:', error);
            return res.status(500).json({
                success: false,
                error: 'Failed to fetch tenants'
            });
        }

        // Add authorization status to each tenant
        const tenantsWithStatus = tenants.map(tenant => ({
            ...tenant,
            zoho_authorized: !!tenant.zoho_organization_id,
            zoho_org_name: tenant.zoho_organization_name || 'Not set'
        }));

        res.json({
            success: true,
            tenants: tenantsWithStatus,
            count: tenants.length
        });

    } catch (error) {
        console.error('[DASHBOARD_API] Unexpected error:', error);
        res.status(500).json({
            success: false,
            error: 'Internal server error'
        });
    }
});

/**
 * GET /api/dashboard/customers/:tenantId/:customerId/business
 * Get complete business information for a customer
 */
router.get('/customers/:tenantId/:customerId/business', async (req, res) => {
    try {
        const { tenantId, customerId } = req.params;

        // Get customer business profile
        const { data: customer, error: customerError } = await dbClient
            .from('customer_profiles')
            .select(`
                id, phone, first_name, last_name, company, email,
                gst_number, business_registration_number, business_type,
                business_address, business_verified, customer_tier,
                total_spent, total_orders, created_at
            `)
            .eq('tenant_id', tenantId)
            .eq('id', customerId)
            .single();

        if (customerError || !customer) {
            return res.status(404).json({ success: false, error: 'Customer not found' });
        }

        // Get business documents
        const { data: documents } = await dbClient
            .from('customer_business_documents')
            .select('*')
            .eq('tenant_id', tenantId)
            .eq('customer_id', customerId)
            .order('uploaded_at', { ascending: false });

        // Get extraction history
        const { data: extractions } = await dbClient
            .from('business_info_extractions')
            .select('*')
            .eq('tenant_id', tenantId)
            .eq('customer_id', customerId)
            .order('processed_at', { ascending: false })
            .limit(10);

        // Calculate business profile completeness
        let completeness = 0;
        const totalFields = 5;
        if (customer.company) completeness++;
        if (customer.gst_number) completeness++;
        if (customer.business_type) completeness++;
        if (customer.business_address) completeness++;
        if (customer.business_verified) completeness++;

        const completenessPercentage = Math.round((completeness / totalFields) * 100);

        res.json({
            success: true,
            customer: {
                ...customer,
                businessCompleteness: completenessPercentage,
                documents: documents || [],
                extractionHistory: extractions || []
            }
        });

    } catch (error) {
        console.error('Business info API error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to load business information'
        });
    }
});

/**
 * POST /api/dashboard/customers/:tenantId/:customerId/business/verify
 * Manually verify or update business information
 */
router.post('/customers/:tenantId/:customerId/business/verify', async (req, res) => {
    try {
        const { tenantId, customerId } = req.params;
        const {
            company,
            gst_number,
            business_type,
            business_address,
            business_registration_number,
            verified_by = 'admin'
        } = req.body;

        // Validate GST number format if provided
        if (gst_number) {
            const gstPattern = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;
            if (!gstPattern.test(gst_number)) {
                return res.status(400).json({
                    success: false,
                    error: 'Invalid GST number format'
                });
            }
        }

        // Update customer profile
        const updateData = {
            business_verified: true
        };
        
        if (company) updateData.company = company;
        if (gst_number) updateData.gst_number = gst_number;
        if (business_type) updateData.business_type = business_type;
        if (business_address) updateData.business_address = business_address;
        if (business_registration_number) updateData.business_registration_number = business_registration_number;

        const { data: updatedCustomer, error: updateError } = await dbClient
            .from('customer_profiles')
            .update(updateData)
            .eq('tenant_id', tenantId)
            .eq('id', customerId)
            .select()
            .single();

        if (updateError) {
            throw updateError;
        }

        // Mark all documents as verified
        await dbClient
            .from('customer_business_documents')
            .update({
                verification_status: 'verified',
                verified_at: new Date().toISOString(),
                verified_by
            })
            .eq('customer_id', customerId);

        // Log the manual verification
        await dbClient
            .from('business_info_extractions')
            .insert({
                customer_id: customerId,
                tenant_id: tenantId,
                source_type: 'manual_verification',
                raw_input: `Manual verification by ${verified_by}`,
                extracted_fields: updateData,
                confidence_score: 1.0,
                needs_verification: false
            });

        res.json({
            success: true,
            customer: updatedCustomer,
            message: 'Business information verified and updated successfully'
        });

    } catch (error) {
        console.error('Business verification error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to verify business information'
        });
    }
});

/**
 * GET /api/dashboard/business-documents/:tenantId
 * Get all business documents requiring verification
 */
router.get('/business-documents/:tenantId', async (req, res) => {
    try {
        const { tenantId } = req.params;
        const { status = 'pending' } = req.query;

        const { data: documents, error } = await dbClient
            .from('customer_business_documents')
            .select(`
                *,
                customer_profiles!inner (
                    id, phone, first_name, last_name, company
                )
            `)
            .eq('tenant_id', tenantId)
            .eq('verification_status', status)
            .order('uploaded_at', { ascending: false });

        if (error) {
            throw error;
        }

        res.json({
            success: true,
            documents: documents || [],
            count: documents?.length || 0
        });

    } catch (error) {
        console.error('Business documents API error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to load business documents'
        });
    }
});

/**
 * PATCH /api/dashboard/business-documents/:tenantId/:documentId
 * Update document verification status
 */
router.patch('/business-documents/:tenantId/:documentId', async (req, res) => {
    try {
        const { tenantId, documentId } = req.params;
        const { verification_status, verified_by, notes } = req.body;

        const validStatuses = ['pending', 'verified', 'rejected'];
        if (!validStatuses.includes(verification_status)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid verification status'
            });
        }

        const updateData = {
            verification_status,
            verified_at: verification_status !== 'pending' ? new Date().toISOString() : null,
            verified_by: verification_status !== 'pending' ? verified_by : null
        };

        const { data: document, error } = await dbClient
            .from('customer_business_documents')
            .update(updateData)
            .eq('tenant_id', tenantId)
            .eq('id', documentId)
            .select()
            .single();

        if (error) {
            throw error;
        }

        // If verified, update customer business_verified status
        if (verification_status === 'verified') {
            await dbClient
                .from('customer_profiles')
                .update({ business_verified: true })
                .eq('id', document.customer_id);
        }

        res.json({
            success: true,
            document,
            message: `Document ${verification_status} successfully`
        });

    } catch (error) {
        console.error('Document verification error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to update document status'
        });
    }
});

/**
 * GET /api/dashboard/business-insights/:tenantId
 * Get business insights and statistics
 */
router.get('/business-insights/:tenantId', async (req, res) => {
    try {
        const { tenantId } = req.params;

        // Get business statistics
        const [
            { count: totalBusinessCustomers },
            { count: verifiedBusinessCustomers },
            { count: pendingDocuments },
            { count: totalDocuments }
        ] = await Promise.all([
            dbClient.from('customer_profiles').select('*', { count: 'exact', head: true })
                .eq('tenant_id', tenantId).not('company', 'is', null),
            dbClient.from('customer_profiles').select('*', { count: 'exact', head: true })
                .eq('tenant_id', tenantId).eq('business_verified', true),
            dbClient.from('customer_business_documents').select('*', { count: 'exact', head: true })
                .eq('tenant_id', tenantId).eq('verification_status', 'pending'),
            dbClient.from('customer_business_documents').select('*', { count: 'exact', head: true })
                .eq('tenant_id', tenantId)
        ]);

        // Get business customer tiers
        const { data: tierDistribution } = await dbClient
            .from('customer_profiles')
            .select('customer_tier')
            .eq('tenant_id', tenantId)
            .not('company', 'is', null);

        const tierCounts = tierDistribution?.reduce((acc, customer) => {
            acc[customer.customer_tier] = (acc[customer.customer_tier] || 0) + 1;
            return acc;
        }, {}) || {};

        // Get top business customers by spending
        const { data: topBusinessCustomers } = await dbClient
            .from('customer_profiles')
            .select('company, total_spent, total_orders, business_verified')
            .eq('tenant_id', tenantId)
            .not('company', 'is', null)
            .order('total_spent', { ascending: false })
            .limit(10);

        res.json({
            success: true,
            insights: {
                totalBusinessCustomers: totalBusinessCustomers || 0,
                verifiedBusinessCustomers: verifiedBusinessCustomers || 0,
                pendingDocuments: pendingDocuments || 0,
                totalDocuments: totalDocuments || 0,
                verificationRate: totalBusinessCustomers > 0 ? 
                    Math.round((verifiedBusinessCustomers / totalBusinessCustomers) * 100) : 0,
                tierDistribution: tierCounts,
                topBusinessCustomers: topBusinessCustomers || []
            }
        });

    } catch (error) {
        console.error('Business insights error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to load business insights'
        });
    }
});


/**
 * GET /api/dashboard/customers/:tenantId
 * Enhanced customer search and listing with filters
 */
router.get('/customers/:tenantId', async (req, res) => {
    try {
        const { tenantId } = req.params;
        const {
            search = '',
            tier = '',
            dateFrom = '',
            dateTo = '',
            minSpent = '',
            maxSpent = '',
            limit = '20',
            offset = '0',
            sortBy = 'last_order_date',
            sortOrder = 'desc'
        } = req.query;

        if (!tenantId) {
            return res.status(400).json({ success: false, error: 'tenantId required' });
        }

        // Build dynamic query with filters
        let query = dbClient
            .from('customer_profiles')
            .select(`
                *,
                customer_notes!customer_notes_customer_id_fkey (
                    id,
                    note_text,
                    note_type,
                    priority,
                    created_at,
                    is_resolved
                )
            `)
            .eq('tenant_id', tenantId);

        // Apply search filter (phone, name, or company)
        if (search.trim()) {
            query = query.or(`phone.ilike.%${search}%,first_name.ilike.%${search}%,last_name.ilike.%${search}%,company.ilike.%${search}%`);
        }

        // Apply tier filter
        if (tier && ['vip', 'regular', 'standard', 'dormant'].includes(tier)) {
            query = query.eq('customer_tier', tier);
        }

        // Apply date filters
        if (dateFrom) {
            query = query.gte('last_order_date', dateFrom);
        }
        if (dateTo) {
            query = query.lte('last_order_date', dateTo);
        }

        // Apply spending filters
        if (minSpent) {
            query = query.gte('total_spent', parseFloat(minSpent));
        }
        if (maxSpent) {
            query = query.lte('total_spent', parseFloat(maxSpent));
        }

        // Apply sorting
        const validSortFields = ['last_order_date', 'total_spent', 'total_orders', 'created_at', 'first_name'];
        const sortField = validSortFields.includes(sortBy) ? sortBy : 'last_order_date';
        const sortDirection = sortOrder === 'asc' ? { ascending: true } : { ascending: false };
        
        query = query.order(sortField, sortDirection);

        // Apply pagination
        const limitNum = Math.max(1, Math.min(100, parseInt(limit)));
        const offsetNum = Math.max(0, parseInt(offset));
        query = query.range(offsetNum, offsetNum + limitNum - 1);

        const { data: customers, error } = await query;

        if (error) {
            console.error('Customer search error:', error);
            throw error;
        }

        // Enhance customers with recent order info
        const customerIds = customers.map(c => c.id);
        let recentOrdersMap = {};

        if (customerIds.length > 0) {
            // Get recent orders for these customers
            const { data: recentOrders } = await dbClient
                .from('orders')
                .select('id, total_amount, created_at, order_status, conversation_id')
                .eq('tenant_id', tenantId)
                .in('conversation_id', customers.map(c => c.phone).filter(Boolean))
                .order('created_at', { ascending: false })
                .limit(customerIds.length * 2); // Get up to 2 recent orders per customer

            if (recentOrders) {
                // Map orders to customers by phone lookup
                const phoneToCustomer = customers.reduce((acc, c) => {
                    acc[c.phone] = c.id;
                    return acc;
                }, {});

                recentOrders.forEach(order => {
                    // This is a simplification - you might need to join with conversations table
                    // to get the proper phone mapping
                    const customerId = phoneToCustomer[order.conversation_id];
                    if (customerId) {
                        if (!recentOrdersMap[customerId]) {
                            recentOrdersMap[customerId] = [];
                        }
                        recentOrdersMap[customerId].push(order);
                    }
                });
            }
        }

        // Enhance customer data
        const enhancedCustomers = customers.map(customer => ({
            ...customer,
            recentOrders: recentOrdersMap[customer.id] || [],
            unreadNotes: customer.customer_notes.filter(note => !note.is_resolved).length,
            urgentNotes: customer.customer_notes.filter(note => note.priority === 'urgent' && !note.is_resolved).length
        }));

        res.json({
            success: true,
            customers: enhancedCustomers,
            pagination: {
                limit: limitNum,
                offset: offsetNum,
                hasMore: customers.length === limitNum
            }
        });

    } catch (error) {
        console.error('Customer management API error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to load customers',
            details: error.message
        });
    }
});

/**
 * GET /api/dashboard/customers/:tenantId/:customerId
 * Get detailed customer profile with full order history
 */
router.get('/customers/:tenantId/:customerId', async (req, res) => {
    try {
        const { tenantId, customerId } = req.params;

        // Get customer profile
        const { data: customer, error: customerError } = await dbClient
            .from('customer_profiles')
            .select('*')
            .eq('tenant_id', tenantId)
            .eq('id', customerId)
            .single();

        if (customerError || !customer) {
            return res.status(404).json({ success: false, error: 'Customer not found' });
        }

        // Get all orders for this customer
        const { data: orders, error: ordersError } = await dbClient
            .from('orders')
            .select(`
                id,
                total_amount,
                subtotal_amount,
                discount_amount,
                shipping_charges,
                gst_amount,
                created_at,
                order_status,
                conversation_id
            `)
            .eq('tenant_id', tenantId)
            .eq('conversation_id', customer.phone) // Assuming phone is stored in conversation
            .order('created_at', { ascending: false });

        // Get customer notes
        const { data: notes, error: notesError } = await dbClient
            .from('customer_notes')
            .select('*')
            .eq('customer_id', customerId)
            .order('created_at', { ascending: false });

        // Calculate customer analytics
        const analytics = {
            averageOrderValue: customer.total_orders > 0 ? customer.total_spent / customer.total_orders : 0,
            daysSinceLastOrder: customer.last_order_date ? 
                Math.floor((new Date() - new Date(customer.last_order_date)) / (1000 * 60 * 60 * 24)) : null,
            orderFrequency: customer.total_orders > 1 && customer.last_order_date ? 
                Math.floor((new Date(customer.last_order_date) - new Date(customer.created_at)) / (1000 * 60 * 60 * 24 * customer.total_orders)) : null
        };

        res.json({
            success: true,
            customer: {
                ...customer,
                orders: orders || [],
                notes: notes || [],
                analytics
            }
        });

    } catch (error) {
        console.error('Customer detail API error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to load customer details',
            details: error.message
        });
    }
});

/**
 * PUT /api/dashboard/customers/:tenantId/:customerId
 * Update customer profile information
 */
router.put('/customers/:tenantId/:customerId', async (req, res) => {
    try {
        const { tenantId, customerId } = req.params;
        const {
            first_name,
            last_name,
            company,
            email,
            customer_tier,
            credit_limit,
            payment_terms,
            communication_preference
        } = req.body;

        // Validate customer tier
        const validTiers = ['vip', 'regular', 'standard', 'dormant'];
        if (customer_tier && !validTiers.includes(customer_tier)) {
            return res.status(400).json({ success: false, error: 'Invalid customer tier' });
        }

        // Validate payment terms
        const validPaymentTerms = ['cod', 'net_30', 'net_15', 'prepaid'];
        if (payment_terms && !validPaymentTerms.includes(payment_terms)) {
            return res.status(400).json({ success: false, error: 'Invalid payment terms' });
        }

        const updateData = {};
        if (first_name !== undefined) updateData.first_name = first_name;
        if (last_name !== undefined) updateData.last_name = last_name;
        if (company !== undefined) updateData.company = company;
        if (email !== undefined) updateData.email = email;
        if (customer_tier !== undefined) updateData.customer_tier = customer_tier;
        if (credit_limit !== undefined) updateData.credit_limit = parseFloat(credit_limit);
        if (payment_terms !== undefined) updateData.payment_terms = payment_terms;
        if (communication_preference !== undefined) updateData.communication_preference = communication_preference;

        const { data: customer, error } = await dbClient
            .from('customer_profiles')
            .update(updateData)
            .eq('tenant_id', tenantId)
            .eq('id', customerId)
            .select()
            .single();

        if (error) {
            console.error('Customer update error:', error);
            throw error;
        }

        res.json({
            success: true,
            customer
        });

    } catch (error) {
        console.error('Customer update API error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to update customer',
            details: error.message
        });
    }
});

/**
 * POST /api/dashboard/customers/:tenantId/:customerId/notes
 * Add a note to customer profile
 */
router.post('/customers/:tenantId/:customerId/notes', async (req, res) => {
    try {
        const { tenantId, customerId } = req.params;
        const {
            note_text,
            note_type = 'general',
            priority = 'normal',
            created_by = 'system',
            follow_up_date
        } = req.body;

        if (!note_text || note_text.trim().length === 0) {
            return res.status(400).json({ success: false, error: 'Note text is required' });
        }

        const noteData = {
            customer_id: customerId,
            tenant_id: tenantId,
            note_text: note_text.trim(),
            note_type,
            priority,
            created_by
        };

        if (follow_up_date) {
            noteData.follow_up_date = follow_up_date;
        }

        const { data: note, error } = await dbClient
            .from('customer_notes')
            .insert(noteData)
            .select()
            .single();

        if (error) {
            console.error('Note creation error:', error);
            throw error;
        }

        res.json({
            success: true,
            note
        });

    } catch (error) {
        console.error('Customer note API error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to add note',
            details: error.message
        });
    }
});

/**
 * PATCH /api/dashboard/customers/:tenantId/notes/:noteId
 * Mark a note as resolved or update it
 */
router.patch('/customers/:tenantId/notes/:noteId', async (req, res) => {
    try {
        const { tenantId, noteId } = req.params;
        const { is_resolved, note_text, priority } = req.body;

        const updateData = {};
        if (is_resolved !== undefined) updateData.is_resolved = is_resolved;
        if (note_text !== undefined) updateData.note_text = note_text;
        if (priority !== undefined) updateData.priority = priority;

        const { data: note, error } = await dbClient
            .from('customer_notes')
            .update(updateData)
            .eq('tenant_id', tenantId)
            .eq('id', noteId)
            .select()
            .single();

        if (error) {
            console.error('Note update error:', error);
            throw error;
        }

        res.json({
            success: true,
            note
        });

    } catch (error) {
        console.error('Note update API error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to update note',
            details: error.message
        });
    }
});

/**
 * READ-ONLY dashboard stats (zero risk to WhatsApp operations)
 */
router.get('/stats/:tenantId', async (req, res) => {
    try {
        const { tenantId } = req.params;

        // Basic tenant validation
        const { data: tenant, error: tenantError } = await dbClient
            .from('tenants')
            .select('id, business_name')
            .eq('id', tenantId)
            .single();

        if (tenantError || !tenant) {
            return res.status(404).json({ error: 'Tenant not found' });
        }

        // Safe read-only queries - no impact on WhatsApp system
        // NOTE: In local SQLite mode, the dbClient-like wrapper may not return `count` for `{ head: true }` queries.
        // We compute robust counts with a fallback to `data.length`.
        const [ordersCountRes, conversationsData, productsCountRes, ordersData] = await Promise.all([
            dbClient.from('orders').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId),
            dbClient.from('conversations').select('id').eq('tenant_id', tenantId),
            dbClient.from('products').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId),
            dbClient.from('orders').select('total_amount').eq('tenant_id', tenantId)
        ]);

        let totalOrders = ordersCountRes?.count;
        if (typeof totalOrders !== 'number') {
            const ordersRowsRes = await dbClient.from('orders').select('id').eq('tenant_id', tenantId);
            totalOrders = Array.isArray(ordersRowsRes?.data) ? ordersRowsRes.data.length : 0;
        }

        let totalProducts = productsCountRes?.count;
        if (typeof totalProducts !== 'number') {
            const productsRowsRes = await dbClient.from('products').select('id').eq('tenant_id', tenantId);
            totalProducts = Array.isArray(productsRowsRes?.data) ? productsRowsRes.data.length : 0;
        }

        // Get conversation IDs for this tenant
        const conversationIds = conversationsData.data?.map(c => c.id) || [];
        const totalConversations = conversationIds.length;

        // Count messages for these conversations
        let totalMessages = 0;
        if (conversationIds.length > 0) {
            const messagesCountRes = await dbClient
                .from('messages')
                .select('id', { count: 'exact', head: true })
                .in('conversation_id', conversationIds);

            let messagesCount = messagesCountRes?.count;
            if (typeof messagesCount !== 'number') {
                const messagesRowsRes = await dbClient
                    .from('messages')
                    .select('id')
                    .in('conversation_id', conversationIds);
                messagesCount = Array.isArray(messagesRowsRes?.data) ? messagesRowsRes.data.length : 0;
            }

            totalMessages = messagesCount || 0;
        }

        // Calculate total revenue from orders (use total_amount, not grand_total)
        const totalRevenue = ordersData.data?.reduce((sum, order) => {
            return sum + (parseFloat(order.total_amount) || 0);
        }, 0) || 0;

        res.json({
            success: true,
            stats: {
                totalOrders: totalOrders || 0,
                totalConversations: totalConversations || 0,
                totalProducts: totalProducts || 0,
                totalMessages: totalMessages || 0,
                totalRevenue: Math.round(totalRevenue),
                businessName: tenant.business_name
            }
        });
    } catch (error) {
        console.error('Dashboard stats error:', error);
        res.status(500).json({ error: 'Failed to load dashboard statistics' });
    }
});

/**
 * READ-ONLY reports snapshot
 * GET /api/dashboard/reports/:tenantId
 * Notes:
 * - Uses safe select + in-memory aggregation for SQLite wrapper compatibility.
 */
router.get('/reports/:tenantId', async (req, res) => {
    try {
        const { tenantId } = req.params;

        const { data: tenant, error: tenantError } = await dbClient
            .from('tenants')
            .select('id')
            .eq('id', tenantId)
            .single();

        if (tenantError || !tenant) {
            return res.status(404).json({ success: false, error: 'Tenant not found' });
        }

        const now = new Date();
        const todayPrefix = now.toISOString().slice(0, 10); // YYYY-MM-DD
        const last24hMs = 24 * 60 * 60 * 1000;
        const last24hCutoff = new Date(Date.now() - last24hMs).toISOString();

        const [triageRes, stagesRes, itemsRes, bulkRes, auditRes] = await Promise.all([
            dbClient.from('triage_queue').select('status, created_at, updated_at, closed_at').eq('tenant_id', tenantId),
            dbClient.from('lead_pipeline_stages').select('id, name, position').eq('tenant_id', tenantId).order('position', { ascending: true }),
            dbClient.from('lead_pipeline_items').select('stage_id, created_at, updated_at').eq('tenant_id', tenantId),
            // Fetch a bounded set of recent bulk rows and filter in JS for "today" because timestamps may vary in format.
            dbClient.from('bulk_schedules').select('status, delivery_status, created_at, delivered_at').eq('tenant_id', tenantId).order('created_at', { ascending: false }).limit(2000),
            dbClient.from('audit_logs').select('created_at, action').eq('tenant_id', tenantId).order('created_at', { ascending: false }).limit(2000)
        ]);

        const triageRows = Array.isArray(triageRes?.data) ? triageRes.data : [];
        const stageRows = Array.isArray(stagesRes?.data) ? stagesRes.data : [];
        const itemRows = Array.isArray(itemsRes?.data) ? itemsRes.data : [];
        const bulkRows = Array.isArray(bulkRes?.data) ? bulkRes.data : [];
        const auditRows = Array.isArray(auditRes?.data) ? auditRes.data : [];

        // --- Triage ---
        const triageByStatus = triageRows.reduce((acc, r) => {
            const key = String(r.status || 'UNKNOWN');
            acc[key] = (acc[key] || 0) + 1;
            return acc;
        }, {});

        // --- Leads Pipeline ---
        const pipelineCountsByStageId = itemRows.reduce((acc, r) => {
            const key = String(r.stage_id || '');
            if (!key) return acc;
            acc[key] = (acc[key] || 0) + 1;
            return acc;
        }, {});
        const pipelineStages = stageRows.map((s) => ({
            id: s.id,
            name: s.name,
            position: s.position,
            count: pipelineCountsByStageId[String(s.id)] || 0
        }));
        const pipelineTotal = itemRows.length;

        // --- Broadcasts (today) ---
        const isSameDay = (ts) => {
            if (!ts) return false;
            const str = String(ts);
            return str.startsWith(todayPrefix);
        };

        const todayBulk = bulkRows.filter((r) => isSameDay(r.delivered_at) || isSameDay(r.created_at));
        const broadcastToday = todayBulk.reduce((acc, r) => {
            const status = String(r.status || r.delivery_status || 'unknown').toLowerCase();
            if (status.includes('sent') || status.includes('delivered')) acc.sent += 1;
            else if (status.includes('fail')) acc.failed += 1;
            else acc.pending += 1;
            return acc;
        }, { sent: 0, failed: 0, pending: 0, total: todayBulk.length });

        // --- Audit (last 24h) ---
        const auditLast24h = auditRows.filter((r) => {
            const createdAt = r.created_at ? String(r.created_at) : '';
            // Prefer ISO comparisons when possible; fall back to day prefix.
            if (createdAt.includes('T')) return createdAt >= last24hCutoff;
            return createdAt.startsWith(todayPrefix);
        });

        return res.json({
            success: true,
            reports: {
                triage: {
                    total: triageRows.length,
                    byStatus: triageByStatus
                },
                leadsPipeline: {
                    total: pipelineTotal,
                    stages: pipelineStages
                },
                broadcasts: {
                    today: broadcastToday
                },
                audit: {
                    total: auditRows.length,
                    last24h: auditLast24h.length
                }
            }
        });
    } catch (error) {
        console.error('[DASHBOARD_REPORTS] Error building reports:', error);
        return res.status(500).json({ success: false, error: error.message || String(error) });
    }
});

/**
 * GET /api/dashboard/orders/:tenantId
 *
 * Returns enriched orders for dashboard listing. Includes customer fallback, GST/shipping fields,
 * and order items (with product.name and product.sku) if order_items/products tables exist.
 */
router.get('/orders/:tenantId', async (req, res) => {
    try {
        const { tenantId } = req.params;
        const limit = Math.max(1, Math.min(100, parseInt(req.query.limit || '10', 10)));
        const offset = Math.max(0, parseInt(req.query.offset || '0', 10));
    const { customer, status, minDate, maxDate, minAmount, maxAmount, product } = req.query;

        // In local SQLite mode, schemas can vary; selecting missing columns (e.g. original_amount)
        // causes a hard failure at prepare-time. Use SELECT * to avoid column drift.
        let query = dbClient.from('orders');
        if (USE_LOCAL_DB) {
            query = query.select('*');
        } else {
            query = query.select(`
                id,
                tenant_id,
                total_amount,
                original_amount,
                discount_amount,
                subtotal_amount,
                gst_amount,
                cgst_amount,
                sgst_amount,
                igst_amount,
                shipping_charges,
                shipping_cartons,
                shipping_rate_per_carton,
                shipping_rate_type,
                free_shipping_applied,
                customer_name,
                customer_email,
                shipping_address,
                zoho_invoice_id,
                created_at,
                conversation_id,
                status,
                order_status
            `);
        }

        query = query.eq('tenant_id', tenantId);

        if (status) query = query.eq('order_status', status);
        if (minDate) query = query.gte('created_at', minDate);
        if (maxDate) query = query.lte('created_at', maxDate);
        if (minAmount) query = query.gte('total_amount', Number(minAmount));
        if (maxAmount) query = query.lte('total_amount', Number(maxAmount));

        // For customer filter, match by customer_name or conversation phone
        let customerFilterPhones = [];
        if (customer) {
            // Try to find conversation ids with matching phone
            const { data: convs, error: convErr } = await dbClient
                .from('conversations')
                .select('id, end_user_phone')
                .ilike('end_user_phone', `%${customer}%`);
            if (!convErr && convs && convs.length) {
                customerFilterPhones = convs.map(c => c.id);
            }
        }

        // Only filter by customer_name or conversation_id if customer filter is present
        if (customer) {
            query = query.or(`customer_name.ilike.%${customer}%,conversation_id.in.(${customerFilterPhones.join(',')})`);
        }


        query = query.order('created_at', { ascending: false }).range(offset, offset + limit - 1);
        let { data: orders, error: ordersError } = await query;
        if (ordersError) {
            console.error('[Orders API] orders fetch error:', ordersError);
            throw ordersError;
        }

        // If product filter is present, filter orders by product name, SKU, or model
        let filteredOrderIds = null;
        if (product && orders && orders.length) {
            // Fetch order_items with matching product fields
            const { data: orderItems, error: itemError } = await dbClient
                .from('order_items')
                .select('order_id, products ( name, sku, model_number )')
                .in('order_id', orders.map(o => o.id));
            if (!itemError && orderItems && orderItems.length) {
                const lower = product.toLowerCase();
                filteredOrderIds = orderItems.filter(it => {
                    const p = it.products || {};
                    return (
                        (p.name && p.name.toLowerCase().includes(lower)) ||
                        (p.sku && p.sku.toLowerCase().includes(lower)) ||
                        (p.model_number && p.model_number.toLowerCase().includes(lower))
                    );
                }).map(it => it.order_id);
            }
        }
        if (filteredOrderIds) {
            orders = orders.filter(o => filteredOrderIds.includes(o.id));
        }

        // Normalize to always provide `order_status` for the frontend (backwards compat)
        const enrichedOrders = (orders || []).map(o => ({
            ...o,
            order_status: o.order_status ?? o.status ?? null
        }));

        // Collect conversation ids to fetch customer phone mapping in batch
        const convIds = Array.from(new Set(enrichedOrders.map(o => o.conversation_id).filter(Boolean)));
        let convMap = {};

        if (convIds.length > 0) {
            const { data: convs, error: convError } = await dbClient
                .from('conversations')
                .select('id, end_user_phone')
                .in('id', convIds);

            if (convError) {
                console.warn('[Orders API] conversations fetch warning:', convError);
                // continue without phone mapping
            } else {
                convMap = (convs || []).reduce((acc, c) => { acc[c.id] = c; return acc; }, {});
            }
        }

        // Attempt to fetch order_items joined with products (if schema exists).
        // This is optional â€“ if tables don't exist, we will degrade gracefully.
        const orderIds = enrichedOrders.map(o => o.id).filter(Boolean);
        let itemsMap = {};

        if (orderIds.length > 0) {
            try {
                // Attempt relational select: order_items with products nested
                // Adjust column names if your schema differs.
                const { data: orderItems, error: itemError } = await dbClient
                    .from('order_items')
                    .select(`
                        order_id,
                        product_id,
                        quantity,
                        price_at_time_of_purchase,
                        products ( id, name, sku, model_number, units_per_carton )
                    `)
                    .in('order_id', orderIds);

                if (itemError) {
                    console.warn('[Orders API] order_items fetch warning:', itemError.message || itemError);
                    itemsMap = {};
                } else if (orderItems && orderItems.length) {
                    itemsMap = orderItems.reduce((acc, it) => {
                        if (!acc[it.order_id]) acc[it.order_id] = [];
                        const unitsPerCarton = it.products?.units_per_carton || 1000;
                        const totalPieces = it.quantity * unitsPerCarton;
                        acc[it.order_id].push({
                            productId: it.product_id,
                            productName: it.products?.name || 'Unknown Product',
                            sku: it.products?.sku || it.products?.model_number || 'N/A',
                            quantity: it.quantity,
                            unitPrice: Number(it.price_at_time_of_purchase || 0),
                            lineTotal: Number((it.price_at_time_of_purchase || 0) * (it.quantity || 0)),
                            unitsPerCarton: unitsPerCarton,
                            totalPieces: totalPieces
                        });
                        return acc;
                    }, {});
                }
            } catch (itmErr) {
                console.warn('[Orders API] exception fetching order_items:', itmErr && itmErr.message ? itmErr.message : itmErr);
                itemsMap = {};
            }
        }


        // Fetch company names for all orders in batch
        // Map: phone or conversation_id -> company
        let companyMap = {};
        if (enrichedOrders.length > 0) {
            // Try to get company by customer phone (from conversation)
            const customerPhones = enrichedOrders.map(o => convMap[o.conversation_id]?.end_user_phone).filter(Boolean);
            if (customerPhones.length > 0) {
                const { data: profiles, error: profileErr } = await dbClient
                    .from('customer_profiles')
                    .select('phone, company')
                    .in('phone', customerPhones);
                if (!profileErr && profiles) {
                    companyMap = profiles.reduce((acc, p) => { acc[p.phone] = p.company; return acc; }, {});
                }
            }
        }

        // Attach conversation info, normalized pricing fields, and items
        const enriched = enrichedOrders.map(o => {
            const phone = convMap[o.conversation_id]?.end_user_phone;
            const company = phone ? companyMap[phone] : null;

            const subtotalAmount = Number(o.subtotal_amount || 0);
            const discountAmount = Number(o.discount_amount || 0);
            const totalAmount = Number(o.total_amount || 0);
            // Some schemas do not have orders.original_amount; derive a best-effort fallback.
            const originalAmountDerived =
                Number(o.original_amount || 0) ||
                (subtotalAmount + discountAmount) ||
                subtotalAmount ||
                totalAmount;

            return {
                id: o.id,
                tenant_id: o.tenant_id,
                created_at: o.created_at,
                status: o.status,
                order_status: o.order_status,
                conversation_id: o.conversation_id,
                // Customer: prefer company name, then orders.customer_name, then conversation phone, else null
                customerName: company || o.customer_name || phone || 'N/A',
                customerEmail: o.customer_email || null,
                shippingAddress: o.shipping_address || null,
                zoho_invoice_id: o.zoho_invoice_id || null,
                // Normalized pricing keys (frontend expects subtotal/shipping/gst)
                subtotal: subtotalAmount || totalAmount,
                discount: discountAmount,
                originalAmount: originalAmountDerived,
                total: totalAmount,
                shipping: Number(o.shipping_charges || 0),
                shippingCartons: o.shipping_cartons || 0,
                shippingRatePerCarton: Number(o.shipping_rate_per_carton || 0),
                shippingRateType: o.shipping_rate_type || null,
                freeShippingApplied: Boolean(o.free_shipping_applied),
                gst: Number(o.gst_amount || 0),
                gstBreakdown: {
                    cgst: Number(o.cgst_amount || 0),
                    sgst: Number(o.sgst_amount || 0),
                    igst: Number(o.igst_amount || 0)
                },
                conversation: convMap[o.conversation_id] || null,
                items: itemsMap[o.id] || []
            };
        });

        res.json({
            success: true,
            orders: enriched,
            pagination: {
                limit,
                offset,
                hasMore: (enrichedOrders.length === limit)
            }
        });

    } catch (error) {
        console.error('Orders API error:', error);
        // Return underlying message where safe Ã¢â‚¬" this helps debug
        res.status(500).json({ error: 'Failed to load orders', details: error?.message || String(error) });
    }
});

/**
 * GET /api/dashboard/order/:orderId
 * Get single order details with items
 */
router.get('/order/:orderId', async (req, res) => {
    try {
        const { orderId } = req.params;
        
        // Get order
        const { data: order, error: orderError } = await dbClient
            .from('orders')
            .select('*')
            .eq('id', orderId)
            .single();
            
        if (orderError || !order) {
            return res.status(404).json({ success: false, error: 'Order not found' });
        }
        
        // Get order items with product details
        const { data: items, error: itemsError } = await dbClient
            .from('order_items')
            .select(`
                *,
                products (
                    name,
                    sku,
                    model_number,
                    units_per_carton
                )
            `)
            .eq('order_id', orderId);
            
        if (itemsError) {
            console.error('[Order Items Error]', itemsError);
        }
        
        // Get conversation for phone
        let customer_phone = order.customer_phone;
        if (order.conversation_id && !customer_phone) {
            const { data: conv } = await dbClient
                .from('conversations')
                .select('end_user_phone')
                .eq('id', order.conversation_id)
                .single();
            if (conv) customer_phone = conv.end_user_phone;
        }
        
        // Format items
        const formattedItems = (items || []).map(item => ({
            productName: item.products?.name || 'Unknown Product',
            sku: item.products?.sku || item.products?.model_number || 'N/A',
            quantity: item.quantity,
            price_per_unit: Number(item.price_at_time_of_purchase || 0),
            price: Number(item.price_at_time_of_purchase || 0),
            total: Number((item.price_at_time_of_purchase || 0) * (item.quantity || 0)),
            unitsPerCarton: item.products?.units_per_carton || 1000
        }));
        
        res.json({
            ...order,
            customer_phone,
            items: formattedItems
        });
        
    } catch (error) {
        console.error('[Order Detail Error]', error);
        res.status(500).json({ success: false, error: 'Failed to load order details' });
    }
});

/**
 * PATCH /api/orders/:orderId/status
 * Safe small route to update order status
 */
router.patch('/orders/:orderId/status', async (req, res) => {
    try {
        const { orderId } = req.params;
        const { status } = req.body;
        if (!orderId || typeof status !== 'string') {
            return res.status(400).json({ success: false, error: 'orderId and status required' });
        }

        // Validate status allowed (optional)
        const allowed = ['new','pending_payment','pending','confirmed','shipped','delivered','cancelled','refunded'];
        if (!allowed.includes(status)) {
            return res.status(400).json({ success: false, error: 'Invalid status' });
        }

        const { data, error } = await dbClient
            .from('orders')
            .update({ status, order_status: status })
            .eq('id', orderId)
            .select('id, status, order_status')
            .single();

        if (error) {
            console.error('Failed to update order status:', error);
            return res.status(500).json({ success: false, error: error.message || String(error) });
        }

        res.json({ success: true, order: data });
    } catch (err) {
        console.error('Error in PATCH /orders/:orderId/status', err);
        res.status(500).json({ success: false, error: String(err?.message || err) });
    }
});

/**
 * Enhanced conversations endpoint with better message handling
 */
router.get('/conversations/:tenantId', async (req, res) => {
    try {
        const { tenantId } = req.params;
        const { limit = 10 } = req.query;

        console.log(`Fetching conversations for tenant: ${tenantId}`);

        let convQuery = dbClient.from('conversations');
        if (USE_LOCAL_DB) {
            // Local SQLite schemas can drift; select('*') avoids hard failures on missing columns.
            convQuery = convQuery.select('*');
        } else {
            convQuery = convQuery.select(`
                id,
                end_user_phone,
                state,
                last_product_discussed,
                updated_at,
                created_at
            `);
        }

        const { data: conversations, error: convError } = await convQuery
            .eq('tenant_id', tenantId)
            .order('updated_at', { ascending: false })
            .limit(parseInt(limit));

        if (convError) {
            console.error('Conversations query error:', convError);
            throw convError;
        }

        console.log('[CONV_RAW_DEBUG] Raw conversations from DB:', conversations);

        if (!conversations || conversations.length === 0) {
            return res.json({
                success: true,
                conversations: []
            });
        }

        const conversationsWithMessages = await Promise.all(
            conversations.map(async (conv) => {
                console.log('[CONV_DEBUG] Processing conversation:', conv.id, 'Phone:', conv.end_user_phone);
                try {
                    const { data: messages, error: msgError } = await dbClient
                        .from('messages')
                        .select('message_body, sender, created_at, message_type')
                        .eq('conversation_id', conv.id)
                        .order('created_at', { ascending: false })
                        .limit(3);

                    if (msgError) {
                        console.warn(`Could not fetch messages for conversation ${conv.id}:`, msgError.message);
                        return {
                            ...conv,
                            messages: [],
                            lastMessage: 'Click to view details',
                            lastMessageSender: null,
                            lastCustomerMessage: null,
                            messageCount: 0,
                            hasMessageError: true,
                            // Format for dashboard-enhanced
                            customerName: conv.end_user_phone || 'Unknown',
                            phone: conv.end_user_phone || '',
                            initials: (conv.end_user_phone || 'U').substring(0, 1).toUpperCase(),
                            lastActivity: getRelativeTime(conv.updated_at)
                        };
                    }

                    const messageList = messages || [];
                    const lastMessage = messageList[0];
                    const lastCustomerMessage = messageList.find(msg => msg.sender === 'user' || msg.sender === 'customer');

                    // Get customer name from customer profile if available
                    let customerName = conv.end_user_phone || 'Unknown';
                    let initials = (conv.end_user_phone || 'U').substring(0, 1).toUpperCase();
                    
                    try {
                        const { data: customerProfile } = await dbClient
                            .from('customer_profiles')
                            .select('id, company, first_name, last_name')
                            .eq('phone', conv.end_user_phone)
                            .eq('tenant_id', tenantId)
                            .maybeSingle();
                        
                        if (customerProfile) {
                            if (customerProfile.company) {
                                customerName = customerProfile.company;
                                initials = customerProfile.company.substring(0, 1).toUpperCase();
                            } else if (customerProfile.first_name) {
                                customerName = `${customerProfile.first_name} ${customerProfile.last_name || ''}`.trim();
                                initials = customerProfile.first_name.substring(0, 1).toUpperCase();
                            }
                            // Store customer_id separately so it doesn't overwrite conversation id
                            const result = {
                                ...conv,
                                messages: messageList,
                                lastMessage: lastMessage ? lastMessage.message_body : 'No messages yet',
                                lastMessageSender: lastMessage ? lastMessage.sender : null,
                                lastCustomerMessage: lastCustomerMessage ? lastCustomerMessage.message_body : null,
                                messageCount: messageList.length,
                                hasMessageError: false,
                                // Format for dashboard-enhanced
                                customerName,
                                customerId: customerProfile.id,
                                phone: conv.end_user_phone || '',
                                initials,
                                lastActivity: getRelativeTime(conv.updated_at)
                            };
                            console.log('[CONV_DEBUG] Conversation ID check - conv.id:', conv.id, 'result.id:', result.id, 'customerId:', result.customerId, 'customerName:', result.customerName);
                            return result;
                        }
                    } catch (err) {
                        console.warn('Could not fetch customer profile:', err.message);
                    }

                    return {
                        ...conv,
                        messages: messageList,
                        lastMessage: lastMessage ? lastMessage.message_body : 'No messages yet',
                        lastMessageSender: lastMessage ? lastMessage.sender : null,
                        lastCustomerMessage: lastCustomerMessage ? lastCustomerMessage.message_body : null,
                        messageCount: messageList.length,
                        hasMessageError: false,
                        // Format for dashboard-enhanced
                        customerName,
                        phone: conv.end_user_phone || '',
                        initials,
                        lastActivity: getRelativeTime(conv.updated_at)
                    };

                } catch (msgError) {
                    console.warn(`Error processing messages for conversation ${conv.id}:`, msgError);
                    return {
                        ...conv,
                        messages: [],
                        lastMessage: 'Click to view details',
                        lastMessageSender: null,
                        lastCustomerMessage: null,
                        messageCount: 0,
                        hasMessageError: true,
                        // Format for dashboard-enhanced
                        customerName: conv.end_user_phone || 'Unknown',
                        phone: conv.end_user_phone || '',
                        initials: (conv.end_user_phone || 'U').substring(0, 1).toUpperCase(),
                        lastActivity: getRelativeTime(conv.updated_at)
                    };
                }
            })
        );
        
        // Helper function to format relative time
        function getRelativeTime(timestamp) {
            const now = new Date();
            const date = new Date(timestamp);
            const diffMs = now - date;
            const diffMins = Math.floor(diffMs / 60000);
            
            if (diffMins < 1) return 'Just now';
            if (diffMins < 60) return `${diffMins} min ago`;
            
            const diffHours = Math.floor(diffMins / 60);
            if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
            
            const diffDays = Math.floor(diffHours / 24);
            return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
        }

        console.log(`Successfully processed ${conversationsWithMessages.length} conversations`);
        
        // Log first conversation for debugging
        if (conversationsWithMessages.length > 0) {
            const firstConv = conversationsWithMessages[0];
            console.log('[CONV_DEBUG] First conversation sample:');
            console.log('[CONV_DEBUG]   - id:', firstConv.id);
            console.log('[CONV_DEBUG]   - customerName:', firstConv.customerName);
            console.log('[CONV_DEBUG]   - customerId:', firstConv.customerId);
            console.log('[CONV_DEBUG]   - phone:', firstConv.phone);
            console.log('[CONV_DEBUG]   - All keys:', Object.keys(firstConv));
        }

        res.json({
            success: true,
            conversations: conversationsWithMessages
        });
        // Log all conversation IDs and tenant IDs for debugging
        const convIdList = conversationsWithMessages.map(c => c.id);
        const tenantIdList = conversationsWithMessages.map(c => c.tenant_id);
        console.log('[CONV_LIST_DEBUG] IDs:', convIdList);
        console.log('[CONV_LIST_DEBUG] tenant_ids:', tenantIdList);

    } catch (error) {
        console.error('Conversations API error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to load conversations',
            details: error.message
        });
    }
});

/**
 * Simple endpoint to inspect messages table structure (debug helper)
 */
router.get('/debug/messages/:tenantId', async (req, res) => {
    try {
        const { tenantId } = req.params;

        const { data: sampleMessages, error } = await dbClient
            .from('messages')
            .select('*')
            .eq('tenant_id', tenantId)
            .limit(1);

        if (error) {
            return res.json({
                success: false,
                error: error.message,
                suggestion: 'Messages table might not exist or have different column names'
            });
        }

        res.json({
            success: true,
            sampleMessage: sampleMessages?.[0] || null,
            messageCount: sampleMessages?.length || 0,
            tableStructure: sampleMessages?.[0] ? Object.keys(sampleMessages[0]) : []
        });

    } catch (error) {
        res.json({
            success: false,
            error: error.message
        });
    }
});

/**
 * Products list for dashboard
 */
router.get('/products/:tenantId', async (req, res) => {
    try {
        const { tenantId } = req.params;
        const limit = Math.max(1, Math.min(200, parseInt(req.query.limit || '50', 10)));
        const offset = Math.max(0, parseInt(req.query.offset || '0', 10));

        if (!tenantId) return res.status(400).json({ error: 'tenantId required' });

        const { data: products, error } = await dbClient
            .from('products')
            .select(`
                id,
                name,
                description,
                price,
                packaging_unit,
                units_per_carton,
                carton_price,
                is_active,
                created_at
            `)
            .eq('tenant_id', tenantId)
            .order('created_at', { ascending: false })
            .range(offset, offset + limit - 1);

        if (error) {
            console.error('[Products API] dbClient error:', error);
            return res.status(500).json({ error: 'Failed to load products', details: error.message || error });
        }

        return res.json({ success: true, products });
    } catch (err) {
        console.error('[Products API] exception', err);
        return res.status(500).json({ error: 'Failed to load products', details: String(err?.message || err) });
    }
});

/**
 * Products performance route (placeholder until order_items aggregates are available)
 */
async function fetchProductsForTenant(tenantId) {
    const { data, error } = await dbClient
        .from('products')
        .select(`
            id,
            name,
            price,
            stock_quantity,
            units_per_carton,
            carton_price,
            packaging_unit,
            sku,
            brand,
            category,
            image_url,
            created_at,
            updated_at
        `)
        .eq('tenant_id', tenantId)
        .order('created_at', { ascending: false });

    if (error) throw error;
    return data || [];
}

router.get('/products/performance/:tenantId', async (req, res) => {
    const tenantId = req.params.tenantId;
    if (!tenantId) return res.status(400).json({ success: false, error: 'Missing tenantId' });

    try {
        // Support search filtering
        const search = (req.query.search || '').trim();
        let query = dbClient
            .from('products')
            .select(`
                id,
                name,
                description,
                price,
                stock_quantity,
                units_per_carton,
                carton_price,
                packaging_unit,
                sku,
                brand,
                category,
                image_url,
                created_at,
                updated_at
            `)
            .eq('tenant_id', tenantId)
            .order('created_at', { ascending: false });

        if (search) {
            // ILIKE for case-insensitive partial match (Postgres)
            query = query.or(`name.ilike.%${search}%,sku.ilike.%${search}%,model_number.ilike.%${search}%`);
        }

        const { data: products, error: productsError } = await query;
        if (productsError) {
            console.error('Products fetch error:', productsError);
            throw productsError;
        }

        // Get sales data (avoid PostgREST join syntax; works in both dbClient and local SQLite)
        let salesData = null;
        let salesError = null;

        const { data: tenantOrders, error: tenantOrdersError } = await dbClient
            .from('orders')
            .select('id')
            .eq('tenant_id', tenantId);

        if (tenantOrdersError) {
            salesError = tenantOrdersError;
        } else {
            const orderIds = (tenantOrders || []).map(o => o.id).filter(Boolean);
            if (orderIds.length === 0) {
                salesData = [];
            } else {
                const resItems = await dbClient
                    .from('order_items')
                    .select('order_id, product_id, quantity, price_at_time_of_purchase')
                    .in('order_id', orderIds);
                salesData = resItems?.data || null;
                salesError = resItems?.error || null;
            }
        }

        if (salesError) {
            console.warn('Sales data fetch error:', salesError);
            // Continue without sales data rather than failing completely
        }

        // Calculate sales statistics per product
        const salesByProduct = {};
        
        if (salesData && salesData.length > 0) {
            salesData.forEach(item => {
                const productId = item.product_id;
                const quantity = Number(item.quantity || 0);
                const unitPrice = Number(item.price_at_time_of_purchase || 0);
                const revenue = quantity * unitPrice;

                if (!salesByProduct[productId]) {
                    salesByProduct[productId] = {
                        totalQuantity: 0,
                        totalRevenue: 0,
                        totalOrders: new Set()
                    };
                }

                salesByProduct[productId].totalQuantity += quantity;
                salesByProduct[productId].totalRevenue += revenue;
                // In local mode we only have order_id; in dbClient join mode we have item.orders.id
                const orderId = item.order_id || item?.orders?.id;
                if (orderId) salesByProduct[productId].totalOrders.add(orderId);
            });

            // Convert Set to count for totalOrders
            Object.keys(salesByProduct).forEach(productId => {
                salesByProduct[productId].totalOrders = salesByProduct[productId].totalOrders.size;
            });
        }

        // Combine products with their sales data
        const payload = (products || []).map(p => {
            const sales = salesByProduct[p.id] || { totalQuantity: 0, totalRevenue: 0, totalOrders: 0 };
            
            return {
                id: p.id,
                name: p.name,
                description: p.description || null,
                price: p.price ? Number(p.price) : 0,
                stockQuantity: p.stock_quantity || 0,
                unitsPerCarton: p.units_per_carton || 1,
                cartonPrice: p.carton_price ? Number(p.carton_price) : 0,
                packagingUnit: p.packaging_unit || 'piece',
                sku: p.sku || null,
                brand: p.brand || null,
                category: p.category || null,
                imageUrl: p.image_url || null,
                createdAt: p.created_at,
                updatedAt: p.updated_at,
                // FIXED: Now shows actual sales data
                revenue: sales.totalRevenue,
                totalQuantity: sales.totalQuantity,
                totalOrders: sales.totalOrders
            };
        });

        res.json({ success: true, products: payload });
    } catch (err) {
        console.error('Error /dashboard/products/performance/:tenantId', err);
        res.status(500).json({ success: false, error: 'Failed to fetch product performance' });
    }
});

/**
 * DELETE /api/dashboard/products/:tenantId/:productId
 * Delete a single product for a tenant
 */
router.delete('/products/:tenantId/:productId', async (req, res) => {
    try {
        const { tenantId, productId } = req.params;
        const { data, error } = await dbClient
            .from('products')
            .delete()
            .eq('tenant_id', tenantId)
            .eq('id', productId)
            .select();

        if (error) {
            return res.status(500).json({ success: false, error: error.message || 'Failed to delete product' });
        }

        return res.json({ success: true, deleted: (data && data[0]) ? data[0] : null });
    } catch (err) {
        console.error('[Product Delete Error]', err);
        return res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

/**
 * DELETE /api/dashboard/products/:tenantId
 * Delete ALL products for a tenant (use with care)
 */
router.delete('/products/:tenantId', async (req, res) => {
    try {
        const { tenantId } = req.params;
        const { data, error } = await dbClient
            .from('products')
            .delete()
            .eq('tenant_id', tenantId)
            .select('id');

        if (error) {
            return res.status(500).json({ success: false, error: error.message || 'Failed to delete products' });
        }

        return res.json({ success: true, deletedCount: Array.isArray(data) ? data.length : 0 });
    } catch (err) {
        console.error('[Products Delete-All Error]', err);
        return res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

router.get('/products/:tenantId/performance', async (req, res) => {
    req.params.tenantId = req.params.tenantId;
    return router.handle(req, res);
});

/**
 * Sales analytics endpoint
 */
router.get('/analytics/:tenantId', async (req, res) => {
    try {
        const { tenantId } = req.params;
        const rawPeriod = (req.query.days ?? req.query.period ?? '30');
        const parsedPeriod = parseInt(String(rawPeriod), 10);
        const period = [7, 30, 90].includes(parsedPeriod) ? parsedPeriod : 30;

        const startDate = new Date();
        startDate.setDate(startDate.getDate() - period);

        const { data: dailySales, error: salesError } = await dbClient
            .from('orders')
            .select('total_amount, subtotal_amount, gst_amount, shipping_charges, created_at, status, order_status, conversation_id')
            .eq('tenant_id', tenantId)
            .gte('created_at', startDate.toISOString())
            .order('created_at');

        if (salesError) throw salesError;

        const salesByDate = {};
        let totalRevenue = 0;
        let productRevenue = 0;
        let shippingRevenue = 0;
        let gstCollected = 0;
        const orderCount = Array.isArray(dailySales) ? dailySales.length : 0;

        dailySales?.forEach(order => {
            const date = new Date(order.created_at).toDateString();
            const total = Number(order.total_amount || 0) || 0;
            const sub = Number(order.subtotal_amount || 0) || 0;
            const ship = Number(order.shipping_charges || 0) || 0;
            const gst = Number(order.gst_amount || 0) || 0;

            salesByDate[date] = (salesByDate[date] || 0) + total;
            totalRevenue += total;
            productRevenue += sub || Math.max(0, total - ship - gst);
            shippingRevenue += ship;
            gstCollected += gst;
        });

        const { data: customerActivity, error: activityError } = await dbClient
            .from('messages')
            .select('created_at, sender')
            .eq('tenant_id', tenantId)
            .gte('created_at', startDate.toISOString())
            .order('created_at');

        if (activityError) throw activityError;

        const activityByDate = {};
        customerActivity?.forEach(msg => {
            const date = new Date(msg.created_at).toDateString();
            if (!activityByDate[date]) {
                activityByDate[date] = { customer: 0, bot: 0 };
            }
            activityByDate[date][msg.sender === 'user' ? 'customer' : 'bot']++;
        });

        // Conversations for conversion rate (period)
        const { data: convsPeriod } = await dbClient
            .from('conversations')
            .select('id, created_at, assigned_to, status, heat')
            .eq('tenant_id', tenantId)
            .gte('created_at', startDate.toISOString());

        const conversationsCount = Array.isArray(convsPeriod) ? convsPeriod.length : 0;
        const conversionRate = conversationsCount > 0 ? Math.round((orderCount / conversationsCount) * 1000) / 10 : 0;
        const avgOrderValue = orderCount > 0 ? Math.round((totalRevenue / orderCount) * 100) / 100 : 0;

        // Unassigned bucket (works in both local + hosted modes)
        const convsArr = Array.isArray(convsPeriod) ? convsPeriod : [];
        const isUnassigned = (v) => {
            if (v === null || v === undefined) return true;
            const s = String(v).trim();
            return s === '' || s === '0' || s.toLowerCase() === 'null' || s.toLowerCase() === 'undefined';
        };

        const unassignedConvs = convsArr.filter(c => isUnassigned(c.assigned_to));
        const unassignedConvIds = new Set(unassignedConvs.map(c => c.id));
        const unassignedLeads = unassignedConvs.length;
        const unassignedOpenLeads = unassignedConvs.reduce((sum, c) => sum + (String(c.status || '').toUpperCase() === 'OPEN' ? 1 : 0), 0);
        const unassignedClosedLeads = unassignedLeads - unassignedOpenLeads;
        const unassignedHeat = unassignedConvs.reduce((acc, c) => {
            const h = String(c.heat || '').toUpperCase();
            if (h && acc[h] !== undefined) acc[h] += 1;
            return acc;
        }, { ON_FIRE: 0, VERY_HOT: 0, HOT: 0, WARM: 0, COLD: 0 });

        let unassignedOrders = 0;
        let unassignedRevenue = 0;
        (dailySales || []).forEach(o => {
            if (!o || !o.conversation_id) return;
            if (!unassignedConvIds.has(o.conversation_id)) return;
            unassignedOrders += 1;
            unassignedRevenue += Number(o.total_amount || 0) || 0;
        });

        const unassignedPerformance = {
            id: 'unassigned',
            name: 'Unassigned',
            phone: null,
            leads: unassignedLeads,
            openLeads: unassignedOpenLeads,
            closedLeads: unassignedClosedLeads,
            orders: unassignedOrders,
            revenue: Math.round(unassignedRevenue * 100) / 100,
            conversionRate: unassignedLeads > 0 ? Math.round((unassignedOrders / unassignedLeads) * 1000) / 10 : 0,
            heat: unassignedHeat
        };

        // Salesmen performance (best-effort; local SQLite only)
        let salesmenPerformance = [];
        if (USE_LOCAL_DB && db) {
            try {
                const startIso = startDate.toISOString();
                const rows = db.prepare(`
                    SELECT
                        s.id AS salesman_id,
                        s.name AS name,
                        s.phone AS phone,
                        COUNT(DISTINCT c.id) AS leads,
                        SUM(CASE WHEN c.status = 'OPEN' THEN 1 ELSE 0 END) AS open_leads,
                        SUM(CASE WHEN c.status IS NOT NULL AND c.status <> 'OPEN' THEN 1 ELSE 0 END) AS closed_leads,
                        SUM(CASE WHEN c.heat = 'ON_FIRE' THEN 1 ELSE 0 END) AS heat_on_fire,
                        SUM(CASE WHEN c.heat = 'VERY_HOT' THEN 1 ELSE 0 END) AS heat_very_hot,
                        SUM(CASE WHEN c.heat = 'HOT' THEN 1 ELSE 0 END) AS heat_hot,
                        SUM(CASE WHEN c.heat = 'WARM' THEN 1 ELSE 0 END) AS heat_warm,
                        SUM(CASE WHEN c.heat = 'COLD' THEN 1 ELSE 0 END) AS heat_cold,
                        COUNT(DISTINCT o.id) AS orders,
                        COALESCE(SUM(COALESCE(o.total_amount, 0)), 0) AS revenue
                    FROM salesman s
                    LEFT JOIN conversations c
                        ON c.tenant_id = s.tenant_id
                        AND CAST(c.assigned_to AS TEXT) = CAST(s.id AS TEXT)
                        AND COALESCE(c.created_at, c.last_activity_at, c.updated_at, '') >= ?
                    LEFT JOIN orders o
                        ON o.tenant_id = s.tenant_id
                        AND o.conversation_id = c.id
                        AND COALESCE(o.created_at, '') >= ?
                    WHERE s.tenant_id = ?
                        AND s.active = 1
                    GROUP BY s.id
                    ORDER BY revenue DESC, leads DESC, name ASC
                `).all(startIso, startIso, tenantId);

                salesmenPerformance = (rows || []).map(r => {
                    const leads = Number(r.leads || 0) || 0;
                    const orders = Number(r.orders || 0) || 0;
                    const revenue = Number(r.revenue || 0) || 0;
                    return {
                        id: r.salesman_id,
                        name: r.name || `Salesman #${r.salesman_id}`,
                        phone: r.phone || null,
                        leads,
                        openLeads: Number(r.open_leads || 0) || 0,
                        closedLeads: Number(r.closed_leads || 0) || 0,
                        orders,
                        revenue,
                        conversionRate: leads > 0 ? Math.round((orders / leads) * 1000) / 10 : 0,
                        heat: {
                            ON_FIRE: Number(r.heat_on_fire || 0) || 0,
                            VERY_HOT: Number(r.heat_very_hot || 0) || 0,
                            HOT: Number(r.heat_hot || 0) || 0,
                            WARM: Number(r.heat_warm || 0) || 0,
                            COLD: Number(r.heat_cold || 0) || 0
                        }
                    };
                });
            } catch (e) {
                salesmenPerformance = [];
            }
        }

        res.json({
            success: true,
            analytics: {
                salesByDate,
                activityByDate,
                period,
                totalRevenue,
                productRevenue: Math.round(productRevenue * 100) / 100,
                shippingRevenue: Math.round(shippingRevenue * 100) / 100,
                gstCollected: Math.round(gstCollected * 100) / 100,
                avgOrderValue,
                conversionRate,
                // Legacy/compat keys
                totalMessages: customerActivity?.length || 0,
                // New
                salesmenPerformance,
                unassignedPerformance
            }
        });
    } catch (error) {
        console.error('Analytics API error:', error);
        res.status(500).json({ error: 'Failed to load analytics data' });
    }
});

/**
 * Customer insights endpoint
 */
router.get('/customers/:tenantId', async (req, res) => {
    try {
        const { tenantId } = req.params;

        const { data: topCustomers, error } = await dbClient
            .from('conversations')
            .select(`
                end_user_phone,
                orders (total_amount, created_at)
            `)
            .eq('tenant_id', tenantId);

        if (error) throw error;

        const customerStats = topCustomers?.map(conv => {
            const totalSpent = conv.orders.reduce((sum, order) => sum + order.total_amount, 0);
            const orderCount = conv.orders.length;
            const lastOrder = conv.orders.length > 0 ?
                new Date(Math.max(...conv.orders.map(o => new Date(o.created_at)))) : null;

            return {
                phone: conv.end_user_phone,
                totalSpent,
                orderCount,
                lastOrder,
                avgOrderValue: orderCount > 0 ? totalSpent / orderCount : 0
            };
        }).filter(c => c.orderCount > 0)
          .sort((a, b) => b.totalSpent - a.totalSpent)
          .slice(0, 10);

        res.json({
            success: true,
            customers: customerStats || []
        });
    } catch (error) {
        console.error('Customers API error:', error);
        res.status(500).json({ error: 'Failed to load customer data' });
    }
});

/**
 * Conversation details endpoint
 */
router.get('/conversation/:tenantId/:conversationId', async (req, res) => {
    try {
        const { tenantId, conversationId } = req.params;
        console.log('[CONV_DETAIL_DEBUG] Querying conversation:', { tenantId, conversationId });
        if (!tenantId || !conversationId) {
            return res.status(400).json({ success: false, error: 'tenantId and conversationId required' });
        }

        const { data: conversation, error: convError } = await dbClient
            .from('conversations')
            .select('*')
            .eq('id', conversationId)
            .eq('tenant_id', tenantId)
            .maybeSingle();

        if (convError) {
            console.error('[conv.lookup.error]', convError);
            return res.status(500).json({ success: false, error: 'DB error on conversation lookup', details: convError.message || convError });
        }
        if (!conversation) {
            console.warn('[CONV_DETAIL_DEBUG] Conversation not found for:', { tenantId, conversationId });
            return res.status(404).json({ success: false, error: 'conversation not found for tenant' });
        } else {
            console.log('[CONV_DETAIL_DEBUG] Conversation found:', conversation.id, conversation.tenant_id);
        }

        const { data: messages, error: msgError } = await dbClient
            .from('messages')
            .select('id, sender, message_body, message_type, created_at')
            .eq('conversation_id', conversationId)
            .order('created_at', { ascending: true });

        if (msgError) {
            console.error('[messages.query.error]', msgError);
            return res.status(500).json({ success: false, error: 'DB error on messages query', details: msgError.message || msgError });
        }

        return res.json({ success: true, conversation: { ...conversation, messages: messages || [] } });
    } catch (err) {
        console.error('[conversation.api.exception]', err && err.stack ? err.stack : err);
        return res.status(500).json({ success: false, error: 'Failed to load conversation details', details: String(err?.message || err) });
    }
});

/**
 * GET /api/dashboard/conversation/:conversationId
 * Simpler single-param conversation endpoint for dashboard
 */
router.get('/conversation/:conversationId', async (req, res) => {
    try {
        const { conversationId } = req.params;
        
        const { data: conversation, error: convError } = await dbClient
            .from('conversations')
            .select('*')
            .eq('id', conversationId)
            .single();

        if (convError || !conversation) {
            return res.status(404).json({ success: false, error: 'Conversation not found' });
        }

        res.json(conversation);
    } catch (err) {
        console.error('[Conversation Detail Error]', err);
        res.status(500).json({ success: false, error: 'Failed to load conversation' });
    }
});

/**
 * GET /api/dashboard/messages/:conversationId
 * Get messages for a conversation
 */
router.get('/messages/:conversationId', async (req, res) => {
    try {
        const { conversationId } = req.params;
        
        const { data: messages, error: msgError } = await dbClient
            .from('messages')
            .select('id, sender, message_body, message_type, created_at')
            .eq('conversation_id', conversationId)
            .order('created_at', { ascending: true });

        if (msgError) {
            return res.status(500).json({ success: false, error: 'Failed to load messages' });
        }

        res.json({ success: true, messages: messages || [] });
    } catch (err) {
        console.error('[Messages Error]', err);
        res.status(500).json({ success: false, error: 'Failed to load messages' });
    }
});

/**
 * POST /api/dashboard/conversation/:tenantId/:conversationId/reply
 * Send a WhatsApp reply from the dashboard and log it.
 */
router.post('/conversation/:tenantId/:conversationId/reply', async (req, res) => {
    try {
        const { tenantId, conversationId } = req.params;
        const text = String(req.body?.text || '').trim();

        if (!tenantId || !conversationId) {
            return res.status(400).json({ success: false, error: 'tenantId and conversationId required' });
        }
        if (!text) {
            return res.status(400).json({ success: false, error: 'text required' });
        }

        const { data: conversation, error: convError } = await dbClient
            .from('conversations')
            .select('*')
            .eq('id', conversationId)
            .eq('tenant_id', tenantId)
            .maybeSingle();

        if (convError) {
            console.error('[dashboard.reply.conv.lookup.error]', convError);
            return res.status(500).json({ success: false, error: 'DB error on conversation lookup' });
        }
        if (!conversation) {
            return res.status(404).json({ success: false, error: 'Conversation not found' });
        }

        const to = conversation.end_user_phone || conversation.phone_number;
        if (!to) {
            return res.status(400).json({ success: false, error: 'Conversation has no phone number' });
        }

        // Premium/Enterprise multi-WhatsApp: try sending from the assigned salesman's WhatsApp Web session.
        let messageId = null;
        let routedSessionName = 'default';
        let routedSalesmanId = null;
        try {
            routedSalesmanId = conversation.assigned_to != null ? String(conversation.assigned_to) : null;
            const { sendWebMessage } = require('../../services/whatsappWebService');

            // Prefer the assigned salesman's connected session.
            if (routedSalesmanId) {
                const { data: rows } = await dbClient
                    .from('whatsapp_connections')
                    .select('session_name, status, provider, updated_at, is_primary')
                    .eq('tenant_id', tenantId)
                    .eq('provider', 'whatsapp_web')
                    .eq('salesman_id', routedSalesmanId)
                    .order('is_primary', { ascending: false })
                    .order('updated_at', { ascending: false })
                    .limit(1);

                const row = Array.isArray(rows) ? rows[0] : null;
                if (row && String(row.status || '').toLowerCase() === 'connected') {
                    routedSessionName = String(row.session_name || 'default');
                    const r = await sendWebMessage(String(tenantId), to, text, routedSessionName);
                    if (r?.success) {
                        messageId = r.messageId || r.message_id || ('waweb_' + Date.now());
                    }
                }
            }

            // Fallback to primary connected session for tenant
            if (!messageId) {
                const { data: rows } = await dbClient
                    .from('whatsapp_connections')
                    .select('session_name, status, provider, updated_at, is_primary')
                    .eq('tenant_id', tenantId)
                    .eq('provider', 'whatsapp_web')
                    .eq('status', 'connected')
                    .order('is_primary', { ascending: false })
                    .order('updated_at', { ascending: false })
                    .limit(1);
                const row = Array.isArray(rows) ? rows[0] : null;
                if (row) {
                    routedSessionName = String(row.session_name || 'default');
                    const r = await sendWebMessage(String(tenantId), to, text, routedSessionName);
                    if (r?.success) {
                        messageId = r.messageId || r.message_id || ('waweb_' + Date.now());
                    }
                }
            }
        } catch (e) {
            // Ignore and fall back to standard provider routing.
        }

        // Default provider routing (Maytapi or tenant default WA Web).
        if (!messageId) {
            messageId = await sendMessage(to, text, tenantId);
        }
        if (!messageId) {
            return res.status(502).json({ success: false, error: 'Failed to send WhatsApp message' });
        }

        const messagePayload = {
            conversation_id: conversationId,
            sender: 'bot',
            message_body: text,
            message_type: 'dashboard_reply',
            // Use an explicit ISO timestamp to avoid timezone/ordering issues (especially in SQLite).
            created_at: new Date().toISOString()
        };
        if (USE_LOCAL_DB) {
            messagePayload.tenant_id = tenantId;
        }

        const { error: insertError } = await dbClient
            .from('messages')
            .insert(messagePayload);

        if (insertError) {
            console.error('[dashboard.reply.message.insert.error]', insertError);
            // Message was sent, so still return success, but warn.
            return res.json({ success: true, messageId, warning: 'Sent but failed to log message' });
        }

        await dbClient
            .from('conversations')
            .update({ updated_at: new Date().toISOString() })
            .eq('id', conversationId)
            .eq('tenant_id', tenantId);

        return res.json({ success: true, messageId, routedSalesmanId, routedSessionName });
    } catch (err) {
        console.error('[dashboard.reply.exception]', err && err.stack ? err.stack : err);
        return res.status(500).json({ success: false, error: 'Failed to send reply' });
    }
});

/**
 * GET /api/dashboard/settings/:tenantId
 * Get tenant settings
 */
router.get('/settings/:tenantId', async (req, res) => {
    try {
        const { tenantId } = req.params;
        
        const { data: tenant, error } = await dbClient
            .from('tenants')
            .select('*')
            .eq('id', tenantId)
            .single();
            
        if (error || !tenant) {
            return res.status(404).json({ success: false, error: 'Tenant not found' });
        }
        
        // Return settings
        res.json({
            success: true,
            settings: {
                business_name: tenant.business_name || '',
                gstin: tenant.gstin || '',
                business_address: tenant.business_address || '',
                business_state: tenant.business_state || 'maharashtra',
                gst_rate: tenant.gst_rate || 18,
                free_shipping_threshold: tenant.free_shipping_threshold || 10000,
                standard_shipping_rate: tenant.standard_shipping_rate || 20,
                bulk_shipping_rate: tenant.bulk_shipping_rate || 15,
                bulk_threshold: tenant.bulk_threshold || 15,

                // AI settings (do not return raw keys)
                openai_model: tenant.openai_model || process.env.AI_MODEL_FAST || 'grok-code-fast-1',
                openai_project: tenant.openai_project || '',
                openai_api_key_set: !!(tenant.openai_api_key || process.env.OPENAI_API_KEY),
                anthropic_api_key_set: !!tenant.anthropic_api_key,
                gemini_api_key_set: !!tenant.gemini_api_key,

                // Maytapi settings (mask key)
                maytapi_product_id: tenant.maytapi_product_id || '',
                maytapi_phone_id: tenant.maytapi_phone_id || '',
                maytapi_api_key_set: !!(tenant.maytapi_api_key || process.env.MAYTAPI_API_KEY)
            }
        });
    } catch (err) {
        console.error('[Settings Error]', err);
        res.status(500).json({ success: false, error: 'Failed to load settings' });
    }
});

/**
 * PUT /api/dashboard/settings/:tenantId
 * Update tenant settings
 */
router.put('/settings/:tenantId', async (req, res) => {
    try {
        const { tenantId } = req.params;
        const settings = req.body || {};

        const allowed = [
            'business_name',
            'gstin',
            'business_address',
            'business_state',
            'gst_rate',
            'free_shipping_threshold',
            'standard_shipping_rate',
            'bulk_shipping_rate',
            'bulk_threshold',
            // AI
            'openai_model',
            'openai_project',
            'openai_api_key',
            'anthropic_api_key',
            'gemini_api_key',
            // Maytapi
            'maytapi_product_id',
            'maytapi_phone_id',
            'maytapi_api_key'
        ];

        const updatePayload = {};
        for (const key of allowed) {
            if (Object.prototype.hasOwnProperty.call(settings, key)) {
                updatePayload[key] = settings[key];
            }
        }

        // Do not overwrite secrets with empty strings
        for (const secretKey of ['openai_api_key', 'anthropic_api_key', 'gemini_api_key', 'maytapi_api_key']) {
            if (Object.prototype.hasOwnProperty.call(updatePayload, secretKey)) {
                const val = String(updatePayload[secretKey] || '').trim();
                if (!val) {
                    delete updatePayload[secretKey];
                }
            }
        }
        
        const { data, error } = await dbClient
            .from('tenants')
            .update(updatePayload)
            .eq('id', tenantId)
            .select()
            .single();
            
        if (error) {
            console.error('[Settings Update Error]', error);
            return res.status(500).json({ success: false, error: error.message });
        }
        
        res.json({ success: true, settings: data });
    } catch (err) {
        console.error('[Settings Update Error]', err);
        res.status(500).json({ success: false, error: 'Failed to update settings' });
    }
});

/**
 * GET /api/dashboard/audit-logs/:tenantId
 * List recent audit logs for a tenant
 * Query params: limit (default 200)
 */
router.get('/audit-logs/:tenantId', async (req, res) => {
    try {
        const { tenantId } = req.params;
        const limitRaw = req.query.limit != null ? Number(req.query.limit) : 200;
        const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 500) : 200;

        let query = dbClient
            .from('audit_logs')
            .select('id, tenant_id, actor_type, actor_id, actor_name, action, entity_type, entity_id, summary, metadata, created_at')
            .eq('tenant_id', tenantId)
            .order('created_at', { ascending: false })
            .limit(limit);

        const { data, error } = await query;

        if (error) {
            // In some environments the table may not exist yet.
            return res.json({ success: true, logs: [], warning: error.message || String(error) });
        }

        return res.json({ success: true, logs: data || [] });
    } catch (error) {
        console.error('[DASHBOARD_API] Error fetching audit logs:', error);
        return res.status(500).json({ success: false, error: error.message || String(error) });
    }
});

/**
 * Manual sync products from Zoho
 * POST /api/dashboard/sync-products/:tenantId
 */
router.post('/sync-products/:tenantId', async (req, res) => {
    try {
        const { tenantId } = req.params;
        
        console.log(`[MANUAL_SYNC] Products sync triggered for tenant: ${tenantId}`);
        
        // Import sync function
        const { syncProductsFromZoho } = require('../../scripts/syncZohoProducts');
        
        // Run sync
        const result = await syncProductsFromZoho();
        
        console.log(`[MANUAL_SYNC] Products sync completed:`, result);
        
        res.json({
            success: true,
            message: 'Product sync completed successfully',
            result: result
        });
        
    } catch (error) {
        console.error('[MANUAL_SYNC] Products sync failed:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to sync products',
            details: error.message
        });
    }
});

/**
 * Manual sync customers from Zoho
 * POST /api/dashboard/sync-customers/:tenantId
 * Note: Customer data is automatically synced during order creation
 */
router.post('/sync-customers/:tenantId', async (req, res) => {
    try {
        const { tenantId } = req.params;
        
        console.log(`[MANUAL_SYNC] Customers sync triggered for tenant: ${tenantId}`);
        
        // Customers are automatically synced from Zoho when orders are created
        // and when customer profiles are accessed
        res.json({
            success: true,
            message: 'Customer data is automatically synced from Zoho during order processing. No manual sync needed.',
            note: 'Customers are created/updated when: 1) Orders are synced, 2) GST details are retrieved, 3) Orders are placed via WhatsApp'
        });
        
    } catch (error) {
        console.error('[MANUAL_SYNC] Customers sync error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to process customer sync request',
            details: error.message
        });
    }
});

/**
 * Manual sync orders from Zoho
 * POST /api/dashboard/sync-orders/:tenantId
 */
router.post('/sync-orders/:tenantId', async (req, res) => {
    try {
        const { tenantId } = req.params;
        
        console.log(`[MANUAL_SYNC] Orders sync triggered for tenant: ${tenantId}`);
        
        // Import sync function
        const { syncZohoOrdersToDatabase } = require('../../services/zohoOrderSyncService');
        
        // Run sync
        const result = await syncZohoOrdersToDatabase(tenantId);
        
        console.log(`[MANUAL_SYNC] Orders sync completed:`, result);
        
        res.json({
            success: true,
            message: result.success ? 
                `Synced ${result.syncedOrders || 0} new orders, updated ${result.updatedPrices || 0} prices` : 
                'Order sync completed with errors',
            result: result
        });
        
    } catch (error) {
        console.error('[MANUAL_SYNC] Orders sync failed:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to sync orders',
            details: error.message
        });
    }
});
/**
 * PUT /api/dashboard/products/:tenantId/:productId
 * Update product details for a tenant
 */
router.put('/products/:tenantId/:productId', async (req, res) => {
    try {
        const { tenantId, productId } = req.params;
        const updateData = req.body;

        // Only allow updates for products belonging to the tenant
        const { data: product, error: fetchError } = await dbClient
            .from('products')
            .select('id')
            .eq('tenant_id', tenantId)
            .eq('id', productId)
            .single();

        if (fetchError || !product) {
            return res.status(404).json({ success: false, error: 'Product not found for tenant' });
        }

        // Update product
        const { data: updated, error: updateError } = await dbClient
            .from('products')
            .update(updateData)
            .eq('tenant_id', tenantId)
            .eq('id', productId)
            .select()
            .single();

        if (updateError) {
            return res.status(500).json({ success: false, error: updateError.message || 'Failed to update product' });
        }

        res.json({ success: true, product: updated });
    } catch (error) {
        console.error('[Product Update Error]', error);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

/**
 * POST /api/dashboard/products/:tenantId
 * Create a new product for a tenant
 */
router.post('/products/:tenantId', async (req, res) => {
    try {
        const { tenantId } = req.params;
        const body = req.body || {};
        const useLocalDb = process.env.USE_LOCAL_DB === 'true';

        const name = String(body.name || '').trim();
        if (!name) {
            return res.status(400).json({ success: false, error: 'Product name is required' });
        }

        // Whitelist fields the UI sends; always enforce tenant_id from path.
        const insertData = {
            tenant_id: tenantId,
            name,
            sku: body.sku ?? null,
            description: body.description ?? null,
            price: body.price ?? null,
            stock_quantity: body.stock_quantity ?? 0,
            brand: body.brand ?? null,
            category: body.category ?? null,
            image_url: body.image_url ?? null,
            packaging_unit: body.packaging_unit ?? null,
            units_per_carton: body.units_per_carton ?? 1
        };

        // In dbClient mode, some schemas use `category_id` as the FK; set it when safe.
        if (!useLocalDb && insertData.category) {
            insertData.category_id = insertData.category;
        }

        const { data: created, error } = await dbClient
            .from('products')
            .insert([insertData])
            .select()
            .single();

        if (error) {
            return res.status(500).json({ success: false, error: error.message || 'Failed to create product' });
        }

        res.json({ success: true, product: created });
    } catch (error) {
        console.error('[Product Create Error]', error);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

/**
 * ========== MANAGER ANALYTICS ROUTES (Phase 2) ==========
 */

const managerDashboardService = require('../../services/managerDashboardService');

/**
 * GET /api/dashboard/manager/overview
 * Get team overview (visits, orders, targets today)
 */
router.get('/manager/overview', requireAuth, async (req, res) => {
  try {
    const { tenantId } = req.user;
    
    // Check authorization
    if (!req.user.roles || (!req.user.roles.includes('manager') && !req.user.roles.includes('admin'))) {
      return res.status(403).json({ error: 'Manager access required' });
    }

    const result = await managerDashboardService.getTeamOverview(tenantId);

    if (!result.ok) {
      return res.status(400).json({ error: result.error });
    }

    res.json({
      ok: true,
      overview: result.overview
    });

  } catch (error) {
    console.error('[DASHBOARD_API] Overview error:', error);
    res.status(500).json({ error: 'Failed to get overview' });
  }
});

/**
 * GET /api/dashboard/manager/analytics
 * Get performance analytics for specified days
 * Query params: days=7 (default)
 */
router.get('/manager/analytics', requireAuth, async (req, res) => {
  try {
    const { tenantId } = req.user;
    
    // Check authorization
    if (!req.user.roles || (!req.user.roles.includes('manager') && !req.user.roles.includes('admin'))) {
      return res.status(403).json({ error: 'Manager access required' });
    }

    const days = parseInt(req.query.days) || 7;

    if (days < 1 || days > 90) {
      return res.status(400).json({ error: 'Days must be between 1 and 90' });
    }

    const result = await managerDashboardService.getPerformanceAnalytics(tenantId, days);

    if (!result.ok) {
      return res.status(400).json({ error: result.error });
    }

    res.json({
      ok: true,
      analytics: result.analytics
    });

  } catch (error) {
    console.error('[DASHBOARD_API] Analytics error:', error);
    res.status(500).json({ error: 'Failed to get analytics' });
  }
});

/**
 * GET /api/dashboard/manager/salesman/:salesman_id
 * Get detailed view for specific salesman
 */
router.get('/manager/salesman/:salesman_id', requireAuth, async (req, res) => {
  try {
    const { tenantId } = req.user;
    
    // Check authorization
    if (!req.user.roles || (!req.user.roles.includes('manager') && !req.user.roles.includes('admin'))) {
      return res.status(403).json({ error: 'Manager access required' });
    }

    const { salesman_id } = req.params;

    const result = await managerDashboardService.getSalesmanDetail(tenantId, salesman_id);

    if (!result.ok) {
      return res.status(400).json({ error: result.error });
    }

    res.json({
      ok: true,
      detail: result.detail
    });

  } catch (error) {
    console.error('[DASHBOARD_API] Salesman detail error:', error);
    res.status(500).json({ error: 'Failed to get salesman details' });
  }
});

/**
 * GET /api/dashboard/manager/alerts
 * Get real-time alerts and warnings
 */
router.get('/manager/alerts', requireAuth, async (req, res) => {
  try {
    const { tenantId } = req.user;
    
    // Check authorization
    if (!req.user.roles || (!req.user.roles.includes('manager') && !req.user.roles.includes('admin'))) {
      return res.status(403).json({ error: 'Manager access required' });
    }

    const result = await managerDashboardService.getAlerts(tenantId);

    if (!result.ok) {
      return res.status(400).json({ error: result.error });
    }

    res.json({
      ok: true,
      alerts: result.alerts,
      critical_count: result.alerts.critical.length,
      warning_count: result.alerts.warning.length,
      info_count: result.alerts.info.length
    });

  } catch (error) {
    console.error('[DASHBOARD_API] Alerts error:', error);
    res.status(500).json({ error: 'Failed to get alerts' });
  }
});

/**
 * GET /api/dashboard/manager/report
 * Get comprehensive dashboard report
 */
router.get('/manager/report', requireAuth, async (req, res) => {
  try {
    const { tenantId } = req.user;
    
    // Check authorization
    if (!req.user.roles || (!req.user.roles.includes('manager') && !req.user.roles.includes('admin'))) {
      return res.status(403).json({ error: 'Manager access required' });
    }

    const result = await managerDashboardService.generateReport(tenantId);

    if (!result.ok) {
      return res.status(400).json({ error: result.error });
    }

    res.json({
      ok: true,
      report: result.report
    });

  } catch (error) {
    console.error('[DASHBOARD_API] Report error:', error);
    res.status(500).json({ error: 'Failed to generate report' });
  }
});

// END OF ROUTES
module.exports = router;
