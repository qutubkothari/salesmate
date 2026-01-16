// services/zohoAuthService.js - Zoho Authorization Handler

/**
 * Generate Zoho authorization URL with required scopes
 */
const generateZohoAuthURL = (tenantId) => {
    const clientId = process.env.ZOHO_CLIENT_ID;
    const redirectUri = process.env.ZOHO_REDIRECT_URI || 'https://your-domain.com/zoho/callback';
    const scopes = 'ZohoBooks.salesorders.READ,ZohoBooks.invoices.CREATE,ZohoBooks.customers.READ,ZohoBooks.items.READ';
    const state = tenantId; // Pass tenant ID as state parameter
    
    const authURL = `https://accounts.zoho.com/oauth/v2/auth?` +
        `response_type=code&` +
        `client_id=${clientId}&` +
        `scope=${encodeURIComponent(scopes)}&` +
        `redirect_uri=${encodeURIComponent(redirectUri)}&` +
        `state=${state}&` +
        `access_type=offline`;
    
    return authURL;
};

/**
 * Exchange authorization code for access token
 */
const exchangeCodeForToken = async (code, tenantId) => {
    try {
        const response = await fetch('https://accounts.zoho.com/oauth/v2/token', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: new URLSearchParams({
                grant_type: 'authorization_code',
                client_id: process.env.ZOHO_CLIENT_ID,
                client_secret: process.env.ZOHO_CLIENT_SECRET,
                redirect_uri: process.env.ZOHO_REDIRECT_URI,
                code: code
            })
        });

        const tokenData = await response.json();
        
        if (!response.ok) {
            throw new Error(`Token exchange failed: ${JSON.stringify(tokenData)}`);
        }

        // Store tokens in database
        await dbClient
            .from('tenants')
            .update({
                zoho_access_token: tokenData.access_token,
                zoho_refresh_token: tokenData.refresh_token,
                zoho_token_expires_at: new Date(Date.now() + (tokenData.expires_in * 1000))
            })
            .eq('id', tenantId);

        // Get organization details
        const orgResponse = await fetch('https://www.zohoapis.com/books/v3/organizations', {
            headers: {
                'Authorization': `Zoho-oauthtoken ${tokenData.access_token}`
            }
        });

        const orgData = await orgResponse.json();
        
        if (orgData.organizations && orgData.organizations.length > 0) {
            const orgId = orgData.organizations[0].organization_id;
            
            // Update organization ID
            await dbClient
                .from('tenants')
                .update({ zoho_organization_id: orgId })
                .eq('id', tenantId);
        }

        return {
            success: true,
            accessToken: tokenData.access_token,
            refreshToken: tokenData.refresh_token
        };

    } catch (error) {
        console.error('[ZOHO_AUTH] Token exchange error:', error);
        return {
            success: false,
            error: error.message
        };
    }
};

/**
 * Admin command to initiate Zoho authorization
 */
const initiateZohoAuth = async (tenantId) => {
    const authURL = generateZohoAuthURL(tenantId);
    
    return `To authorize Zoho Books integration:

1. Click this link: ${authURL}

2. Login to your Zoho account
3. Grant permissions for:
   - Read Sales Orders
   - Create Invoices
   - Read Customers
   - Read Items

4. You'll be redirected back and the integration will be complete.

This authorization is required for invoice generation features.`;
};

module.exports = {
    generateZohoAuthURL,
    exchangeCodeForToken,
    initiateZohoAuth
};

