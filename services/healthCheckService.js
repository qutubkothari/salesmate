/**
 * @title System Health Check Service
 * @description Manages diagnostic checks for the platform's external dependencies.
 */
const { dbClient, openai } = require('./config');

/**
 * Runs a series of checks to verify the status of external services.
 * @returns {Promise<string>} A formatted string reporting the status of all checks.
 */
const runHealthChecks = async () => {
    console.log('Running system health checks...');
    let report = 'ðŸ©º *System Health Check Report*\n\n';
    let allSystemsOperational = true;

    // 1. Check dbClient Connection
    try {
        const { error } = await dbClient.from('tenants').select('id').limit(1);
        if (error) throw error;
        report += '- dbClient DB Connection: âœ… Operational\n';
    } catch (error) {
        report += `- dbClient DB Connection: âŒ FAILED\n  - Error: ${error.message}\n`;
        allSystemsOperational = false;
    }

    // 2. Check OpenAI API Connection
    try {
        // A lightweight call to list models to verify the API key and connectivity.
        await openai.models.list({ limit: 1 });
        report += '- OpenAI API Connection: âœ… Operational\n';
    } catch (error) {
        report += `- OpenAI API Connection: âŒ FAILED\n  - Error: ${error.message}\n`;
        allSystemsOperational = false;
    }

    // Add checks for other services like Maytapi if they have a status endpoint.

    report += '\n';
    if (allSystemsOperational) {
        report += 'All systems are operational.';
    } else {
        report += 'One or more systems are experiencing issues. Please check the logs.';
    }

    return report;
};

module.exports = {
    runHealthChecks,
};

