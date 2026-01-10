// services/zohoTenantAuthService.js - Complete Tenant-Based Zoho Authorization
const { dbClient } = require('./config');
const fetch = require('node-fetch');

/**
 * Enhanced Zoho Authorization Service for Multi-Tenant SaaS
 * Handles tenant-specific Zoho credentials and full scope authorization
 */
class ZohoTenantAuthService {
    constructor() {
        this.accountsUrl = 'https://accounts.zoho.in';
        this.apiUrl = 'https://www.zohoapis.in';
        
        // CRITICAL: Full scopes for complete Zoho Books access
        this.requiredScopes = [
            'ZohoBooks.fullaccess.all',          // Full access to everything
            'ZohoBooks.contacts.CREATE',         // Create customers
            'ZohoBooks.contacts.READ',           // Read customers
            'ZohoBooks.contacts.UPDATE',         // Update customers
            'ZohoBooks.items.CREATE',            // Create products
            'ZohoBooks.items.READ',              // Read products
            'ZohoBooks.items.UPDATE',            // Update products
            'ZohoBooks.salesorders.CREATE',      // Create sales orders
            'ZohoBooks.salesorders.READ',        // Read sales orders
            'ZohoBooks.salesorders.UPDATE',      // Update sales orders
            'ZohoBooks.invoices.CREATE',         // Create invoices
            'ZohoBooks.invoices.READ',           // Read invoices
            'ZohoBooks.invoices.UPDATE',         // Update invoices
            'ZohoBooks.settings.READ'            // Read organization settings
        ].join(',');
    }

    /**
     * Generate Zoho authorization URL for a tenant
     */
    generateAuthorizationURL(tenantId, redirectUri) {
        const state = `tenant_${tenantId}_${Date.now()}`;
        const clientId = process.env.ZOHO_CLIENT_ID;
        
        if (!clientId) {
            throw new Error('ZOHO_CLIENT_ID not configured in environment');
        }

        const authUrl = new URL(`${this.accountsUrl}/oauth/v2/auth`);
        authUrl.searchParams.set('scope', this.requiredScopes);
        authUrl.searchParams.set('client_id', clientId);
        authUrl.searchParams.set('state', state);
        authUrl.searchParams.set('response_type', 'code');
        authUrl.searchParams.set('redirect_uri', redirectUri);
        authUrl.searchParams.set('access_type', 'offline');
        authUrl.searchParams.set('prompt', 'consent');

        console.log('[ZOHO_AUTH] Generated authorization URL for tenant:', tenantId);
        console.log('[ZOHO_AUTH] Required scopes:', this.requiredScopes);
        
        return {
            authUrl: authUrl.toString(),
            state: state
        };
    }

    /**
     * Exchange authorization code for tokens and save to tenant
     */
    async exchangeCodeForTokens(tenantId, authorizationCode, redirectUri) {
        try {
            console.log('[ZOHO_AUTH] Exchanging code for tokens, tenant:', tenantId);
            
            const clientId = process.env.ZOHO_CLIENT_ID;
            const clientSecret = process.env.ZOHO_CLIENT_SECRET;
            
            if (!clientId || !clientSecret) {
                throw new Error('Zoho client credentials not configured');
            }

            // Exchange code for tokens
            const tokenResponse = await fetch(`${this.accountsUrl}/oauth/v2/token`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded'
                },
                body: new URLSearchParams({
                    grant_type: 'authorization_code',
                    client_id: clientId,
                    client_secret: clientSecret,
                    redirect_uri: redirectUri,
                    code: authorizationCode
                })
            });

            const tokenData = await tokenResponse.json();
            
            if (!tokenResponse.ok || !tokenData.access_token) {
                console.error('[ZOHO_AUTH] Token exchange failed:', tokenData);
                throw new Error(`Token exchange failed: ${tokenData.error || 'Unknown error'}`);
            }

            console.log('[ZOHO_AUTH] Token exchange successful');
            console.log('[ZOHO_AUTH] Granted scopes:', tokenData.scope);

            // Get organization details
            const orgDetails = await this.getOrganizationDetails(tokenData.access_token);
            
            if (!orgDetails.success) {
                throw new Error('Failed to get organization details');
            }

            // Save credentials to tenant record
            const { error: updateError } = await dbClient
                .from('tenants')
                .update({
                    zoho_access_token: tokenData.access_token,
                    zoho_refresh_token: tokenData.refresh_token,
                    zoho_organization_id: orgDetails.organizationId,
                    zoho_client_id: clientId,
                    zoho_client_secret: clientSecret,
                    zoho_token_expires_at: new Date(Date.now() + (tokenData.expires_in * 1000)).toISOString(),
                    zoho_scopes: tokenData.scope,
                    zoho_authorized_at: new Date().toISOString(),
                    zoho_organization_name: orgDetails.organizationName
                })
                .eq('id', tenantId);

            if (updateError) {
                console.error('[ZOHO_AUTH] Failed to save credentials:', updateError);
                throw new Error('Failed to save Zoho credentials');
            }

            console.log('[ZOHO_AUTH] Credentials saved successfully for tenant:', tenantId);
            console.log('[ZOHO_AUTH] Organization:', orgDetails.organizationName);

            return {
                success: true,
                organizationId: orgDetails.organizationId,
                organizationName: orgDetails.organizationName,
                scopes: tokenData.scope,
                message: 'Zoho authorization completed successfully'
            };

        } catch (error) {
            console.error('[ZOHO_AUTH] Error exchanging code:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Get organization details using access token
     */
    async getOrganizationDetails(accessToken) {
        try {
            const response = await fetch(`${this.apiUrl}/books/v3/organizations`, {
                headers: {
                    'Authorization': `Zoho-oauthtoken ${accessToken}`,
                    'Content-Type': 'application/json'
                }
            });

            const data = await response.json();
            
            if (response.ok && data.organizations && data.organizations.length > 0) {
                const org = data.organizations[0];
                return {
                    success: true,
                    organizationId: org.organization_id,
                    organizationName: org.name
                };
            } else {
                console.error('[ZOHO_AUTH] Failed to get organizations:', data);
                return {
                    success: false,
                    error: 'No organizations found'
                };
            }
        } catch (error) {
            console.error('[ZOHO_AUTH] Error getting organization details:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Refresh access token for a tenant
     */
    async refreshAccessToken(tenantId) {
        try {
            console.log('[ZOHO_AUTH] Refreshing access token for tenant:', tenantId);
            
            // Get tenant credentials
            const { data: tenant, error } = await dbClient
                .from('tenants')
                .select('zoho_refresh_token, zoho_client_id, zoho_client_secret')
                .eq('id', tenantId)
                .single();

            if (error || !tenant || !tenant.zoho_refresh_token) {
                throw new Error('Tenant Zoho credentials not found');
            }

            // Refresh token
            const response = await fetch(`${this.accountsUrl}/oauth/v2/token`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded'
                },
                body: new URLSearchParams({
                    refresh_token: tenant.zoho_refresh_token,
                    client_id: tenant.zoho_client_id,
                    client_secret: tenant.zoho_client_secret,
                    grant_type: 'refresh_token'
                })
            });

            const data = await response.json();

            if (!response.ok || !data.access_token) {
                console.error('[ZOHO_AUTH] Token refresh failed:', data);
                throw new Error(`Token refresh failed: ${data.error || 'Unknown error'}`);
            }

            // Update tenant record
            const { error: updateError } = await dbClient
                .from('tenants')
                .update({
                    zoho_access_token: data.access_token,
                    zoho_token_expires_at: new Date(Date.now() + (data.expires_in * 1000)).toISOString()
                })
                .eq('id', tenantId);

            if (updateError) {
                console.error('[ZOHO_AUTH] Failed to update token:', updateError);
                throw new Error('Failed to update access token');
            }

            console.log('[ZOHO_AUTH] Token refreshed successfully for tenant:', tenantId);
            return data.access_token;

        } catch (error) {
            console.error('[ZOHO_AUTH] Error refreshing token:', error);
            throw error;
        }
    }

    /**
     * Get valid access token for a tenant (refresh if needed)
     */
    async getValidAccessToken(tenantId) {
        try {
            const { data: tenant, error } = await dbClient
                .from('tenants')
                .select('zoho_access_token, zoho_token_expires_at, zoho_organization_id')
                .eq('id', tenantId)
                .single();

            if (error || !tenant) {
                throw new Error('Tenant not found');
            }

            if (!tenant.zoho_access_token) {
                throw new Error('Tenant not authorized with Zoho. Please complete authorization first.');
            }

            // Check if token is expired (refresh 5 minutes early)
            const expiresAt = new Date(tenant.zoho_token_expires_at);
            const now = new Date();
            const refreshThreshold = new Date(now.getTime() + (5 * 60 * 1000)); // 5 minutes

            if (expiresAt <= refreshThreshold) {
                console.log('[ZOHO_AUTH] Token expired, refreshing...');
                const newToken = await this.refreshAccessToken(tenantId);
                return {
                    accessToken: newToken,
                    organizationId: tenant.zoho_organization_id
                };
            }

            return {
                accessToken: tenant.zoho_access_token,
                organizationId: tenant.zoho_organization_id
            };

        } catch (error) {
            console.error('[ZOHO_AUTH] Error getting valid token:', error);
            throw error;
        }
    }

    /**
     * Test Zoho connection for a tenant
     */
    async testConnection(tenantId) {
        try {
            console.log('[ZOHO_AUTH] Testing connection for tenant:', tenantId);
            
            const { accessToken, organizationId } = await this.getValidAccessToken(tenantId);
            
            // Test API call - get organization details
            const response = await fetch(
                `${this.apiUrl}/books/v3/organizations/${organizationId}`,
                {
                    headers: {
                        'Authorization': `Zoho-oauthtoken ${accessToken}`,
                        'Content-Type': 'application/json'
                    }
                }
            );

            const data = await response.json();

            if (response.ok && data.organization) {
                console.log('[ZOHO_AUTH] Connection test successful');
                return {
                    success: true,
                    organizationName: data.organization.name,
                    message: 'Zoho connection is working properly'
                };
            } else {
                console.error('[ZOHO_AUTH] Connection test failed:', data);
                return {
                    success: false,
                    error: data.message || 'Connection test failed'
                };
            }

        } catch (error) {
            console.error('[ZOHO_AUTH] Connection test error:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Get authorization status for a tenant
     */
    async getAuthorizationStatus(tenantId) {
        try {
            const { data: tenant, error } = await dbClient
                .from('tenants')
                .select(`
                    zoho_access_token,
                    zoho_organization_id,
                    zoho_organization_name,
                    zoho_authorized_at,
                    zoho_token_expires_at,
                    zoho_scopes
                `)
                .eq('id', tenantId)
                .single();

            if (error || !tenant) {
                return {
                    authorized: false,
                    message: 'Tenant not found'
                };
            }

            if (!tenant.zoho_access_token) {
                return {
                    authorized: false,
                    message: 'Not authorized with Zoho',
                    authorizationRequired: true
                };
            }

            const expiresAt = new Date(tenant.zoho_token_expires_at);
            const isExpired = expiresAt <= new Date();

            return {
                authorized: true,
                organizationId: tenant.zoho_organization_id,
                organizationName: tenant.zoho_organization_name,
                authorizedAt: tenant.zoho_authorized_at,
                tokenExpires: tenant.zoho_token_expires_at,
                tokenExpired: isExpired,
                scopes: tenant.zoho_scopes,
                message: isExpired ? 'Token expired, will auto-refresh' : 'Authorization active'
            };

        } catch (error) {
            console.error('[ZOHO_AUTH] Error checking status:', error);
            return {
                authorized: false,
                error: error.message
            };
        }
    }

    /**
     * Revoke Zoho authorization for a tenant
     */
    async revokeAuthorization(tenantId) {
        try {
            console.log('[ZOHO_AUTH] Revoking authorization for tenant:', tenantId);
            
            // Clear Zoho credentials from tenant record
            const { error } = await dbClient
                .from('tenants')
                .update({
                    zoho_access_token: null,
                    zoho_refresh_token: null,
                    zoho_organization_id: null,
                    zoho_client_id: null,
                    zoho_client_secret: null,
                    zoho_token_expires_at: null,
                    zoho_scopes: null,
                    zoho_authorized_at: null,
                    zoho_organization_name: null
                })
                .eq('id', tenantId);

            if (error) {
                throw new Error('Failed to revoke authorization');
            }

            console.log('[ZOHO_AUTH] Authorization revoked successfully');
            return {
                success: true,
                message: 'Zoho authorization has been revoked'
            };

        } catch (error) {
            console.error('[ZOHO_AUTH] Error revoking authorization:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }
}

module.exports = new ZohoTenantAuthService();
