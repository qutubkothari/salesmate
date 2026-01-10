// scripts/setupZohoOAuth.js - Zoho OAuth Setup for Tenant
const { dbClient } = require('../services/config');

/**
 * Step 1: Get Zoho OAuth URL for Authorization
 * Run this first to get the authorization URL
 */
const getZohoAuthURL = (clientId, redirectUri = 'http://localhost:3000/zoho/callback') => {
    const scopes = [
        'ZohoBooks.fullaccess.all',
        'ZohoBooks.salesorders.READ',
        'ZohoBooks.salesorders.CREATE',
        'ZohoBooks.invoices.READ',
        'ZohoBooks.invoices.CREATE',
        'ZohoBooks.customers.READ',
        'ZohoBooks.customers.CREATE'
    ].join(',');

    const authUrl = `https://accounts.zoho.com/oauth/v2/auth?scope=${encodeURIComponent(scopes)}&client_id=${clientId}&response_type=code&redirect_uri=${encodeURIComponent(redirectUri)}&access_type=offline`;
    
    console.log('ðŸ”— Visit this URL to authorize your Zoho Books access:');
    console.log(authUrl);
    console.log('\nðŸ“ After authorization, you will get a code. Use that code in Step 2.');
    
    return authUrl;
};

/**
 * Step 2: Exchange authorization code for access token
 */
const exchangeCodeForTokens = async (clientId, clientSecret, authCode, redirectUri = 'http://localhost:3000/zoho/callback') => {
    try {
        const response = await fetch('https://accounts.zoho.com/oauth/v2/token', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: new URLSearchParams({
                grant_type: 'authorization_code',
                client_id: clientId,
                client_secret: clientSecret,
                redirect_uri: redirectUri,
                code: authCode
            })
        });

        const data = await response.json();
        
        if (!response.ok) {
            throw new Error(`Token exchange failed: ${JSON.stringify(data)}`);
        }

        console.log('âœ… Token exchange successful!');
        console.log('Access Token:', data.access_token);
        console.log('Refresh Token:', data.refresh_token);
        console.log('Expires in:', data.expires_in, 'seconds');
        
        return {
            accessToken: data.access_token,
            refreshToken: data.refresh_token,
            expiresIn: data.expires_in
        };
    } catch (error) {
        console.error('âŒ Error exchanging code for tokens:', error);
        throw error;
    }
};

/**
 * Step 3: Get Zoho Organization ID
 */
const getZohoOrganizationId = async (accessToken) => {
    try {
        const response = await fetch('https://www.zohoapis.com/books/v3/organizations', {
            headers: {
                'Authorization': `Zoho-oauthtoken ${accessToken}`
            }
        });

        const data = await response.json();
        
        if (!response.ok) {
            throw new Error(`Failed to get organizations: ${JSON.stringify(data)}`);
        }

        if (data.organizations && data.organizations.length > 0) {
            const org = data.organizations[0];
            console.log('ðŸ¢ Found organization:', org.name);
            console.log('ðŸ“‹ Organization ID:', org.organization_id);
            return org.organization_id;
        } else {
            throw new Error('No organizations found');
        }
    } catch (error) {
        console.error('âŒ Error getting organization ID:', error);
        throw error;
    }
};

/**
 * Step 4: Save tokens to database
 */
const saveZohoTokensToDatabase = async (tenantId, accessToken, refreshToken, organizationId, clientId, clientSecret) => {
    try {
        const expiresAt = new Date(Date.now() + 3600 * 1000); // 1 hour from now
        
        const { error } = await dbClient
            .from('tenants')
            .update({
                zoho_access_token: accessToken,
                zoho_refresh_token: refreshToken,
                zoho_organization_id: organizationId,
                zoho_client_id: clientId,
                zoho_client_secret: clientSecret,
                zoho_token_expires_at: expiresAt.toISOString(),
                updated_at: new Date().toISOString()
            })
            .eq('id', tenantId);

        if (error) {
            throw new Error(`Database update failed: ${error.message}`);
        }

        console.log('âœ… Zoho tokens saved to database successfully!');
        console.log('ðŸŽ‰ Zoho integration is now ready!');
    } catch (error) {
        console.error('âŒ Error saving tokens to database:', error);
        throw error;
    }
};

/**
 * Complete setup function - run this with your details
 */
const setupZohoIntegration = async (config) => {
    const { tenantId, clientId, clientSecret, authCode, redirectUri } = config;
    
    try {
        console.log('ðŸš€ Starting Zoho integration setup...');
        
        // Step 1: Exchange code for tokens
        const tokens = await exchangeCodeForTokens(clientId, clientSecret, authCode, redirectUri);
        
        // Step 2: Get organization ID
        const organizationId = await getZohoOrganizationId(tokens.accessToken);
        
        // Step 3: Save to database
        await saveZohoTokensToDatabase(
            tenantId,
            tokens.accessToken,
            tokens.refreshToken,
            organizationId,
            clientId,
            clientSecret
        );
        
        console.log('ðŸŽ‰ Zoho integration setup complete!');
        return {
            success: true,
            organizationId,
            message: 'Zoho integration configured successfully'
        };
        
    } catch (error) {
        console.error('âŒ Setup failed:', error);
        return {
            success: false,
            error: error.message
        };
    }
};

// Example usage:
// 1. First get the auth URL:
// getZohoAuthURL('your_client_id');

// 2. Then run the complete setup:
// setupZohoIntegration({
//     tenantId: 'your_tenant_id',
//     clientId: 'your_zoho_client_id',
//     clientSecret: 'your_zoho_client_secret',
//     authCode: 'code_from_step_1',
//     redirectUri: 'http://localhost:3000/zoho/callback'
// });

module.exports = {
    getZohoAuthURL,
    exchangeCodeForTokens,
    getZohoOrganizationId,
    saveZohoTokensToDatabase,
    setupZohoIntegration
};
