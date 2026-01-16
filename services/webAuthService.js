/**
 * @title Web Authentication Service
 * @description Manages the logic for generating and validating "magic link" tokens for web dashboard login.
 */
const { dbClient } = require('./config');
const crypto = require('crypto');

const WEB_DASHBOARD_URL = process.env.WEB_DASHBOARD_URL || 'http://13.62.57.240:8080/dashboard.html'; // EC2 deployment

/**
 * Generates a secure, random token for web authentication.
 * @returns {string} A 64-character hex token.
 */
const generateSecureToken = () => {
    return crypto.randomBytes(32).toString('hex');
};

/**
 * Generates a magic login link for a tenant.
 * @param {string} tenantId The ID of the tenant requesting the link.
 * @returns {Promise<string>} A confirmation message containing the magic link.
 */
const generateLoginLink = async (tenantId) => {
    try {
        const token = generateSecureToken();
        const expiresAt = new Date(new Date().getTime() + 15 * 60 * 1000); // Token is valid for 15 minutes

        // Save the token and its expiration date to the tenant's record.
        const { error } = await dbClient
            .from('tenants')
            .update({
                web_auth_token: token,
                web_auth_token_expires_at: expiresAt.toISOString(),
            })
            .eq('id', tenantId);

        if (error) throw error;

        // Use /dashboard.html for the magic link
        let baseUrl = WEB_DASHBOARD_URL;
        // Replace any existing path with /dashboard.html
        baseUrl = baseUrl.replace(/\/dashboard(-enhanced|-v2)?\.html($|\?)/, '');
        baseUrl = baseUrl.replace(/\/login($|\?)/, '');
        baseUrl = baseUrl.replace(/\/?$/, '');
        const magicLink = `${baseUrl}/dashboard.html?token=${token}`;

        // Styled WhatsApp message with emoji and instructions
        let responseMessage =
            '🛡️ *Admin Dashboard Access*\n' +
            '\n' +
            'Your secure login link:\n' +
            `${magicLink}\n` +
            '\n' +
            '⏰ *Expires in 30 minutes*\n' +
            '🔒 *For security, this link can only be used once*\n' +
            '\n' +
            'Click the link to access your admin dashboard.';

        return responseMessage;
    } catch (error) {
        console.error('Error generating login link:', error.message);
        return 'An error occurred while generating your login link. Please try again.';
    }
};

module.exports = {
    generateLoginLink,
};


