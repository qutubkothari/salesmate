/**
 * @title Lead Retrieval Service
 * @description Handles fetching lead data and exporting it in various formats.
 */
const { dbClient, bucket } = require('./config');
const xlsx = require('xlsx');

/**
 * Fetches a text-based summary of leads for a tenant, now grouped by lead score.
 * @param {string} tenantId The ID of the tenant.
 * @returns {string} A formatted string summarizing the leads.
 */
const getLeadSummary = async (tenantId) => {
    try {
        const { data, error } = await dbClient
            .from('conversations_new')
            .select('end_user_category, lead_score')
            .eq('tenant_id', tenantId);

        if (error) throw error;

        if (!data || data.length === 0) {
            return 'You do not have any customer conversations yet.';
        }

        // Group leads by their score (Hot, Warm, Cold)
        const summary = data.reduce((acc, curr) => {
            const score = curr.lead_score || 'Not Scored';
            if (!acc[score]) {
                acc[score] = 0;
            }
            acc[score]++;
            return acc;
        }, {});
        
        // Define the desired order for scores
        const scoreOrder = ['Hot', 'Warm', 'Cold', 'Not Scored'];

        let summaryMessage = '🔥 *Lead Temperature Summary*\n\n';
        for (const score of scoreOrder) {
            if (summary[score]) {
                summaryMessage += `- ${score}: ${summary[score]}\n`;
            }
        }
        
        summaryMessage += '\nUse `/export_leads` to get a detailed list.';

        return summaryMessage;

    } catch (error) {
        console.error('Error getting lead summary:', error.message);
        return 'There was an error fetching your lead summary.';
    }
};

/**
 * Exports a tenant's leads to an Excel file, including the lead score, and returns a download link.
 * @param {string} tenantId The ID of the tenant.
 * @returns {Promise<string>} A promise that resolves to a secure, temporary download URL for the Excel file.
 */
const exportLeadsToExcel = async (tenantId) => {
    try {
        // 1. Fetch lead data from the database, now including lead_score
        const { data: leads, error } = await dbClient
            .from('conversations_new')
            .select('end_user_phone, end_user_category, lead_score, updated_at')
            .eq('tenant_id', tenantId)
            .order('updated_at', { ascending: false });

        if (error) throw error;

        if (!leads || leads.length === 0) {
            return 'No leads to export.';
        }

        // 2. Format data for Excel
        const formattedLeads = leads.map(lead => ({
            'Phone Number': lead.end_user_phone,
            'Lead Score': lead.lead_score, // Add the lead score column
            'Category': lead.end_user_category,
            'Last Interaction': new Date(lead.updated_at).toLocaleString(),
        }));

        // 3. Create Excel workbook and buffer
        const worksheet = xlsx.utils.json_to_sheet(formattedLeads);
        const workbook = xlsx.utils.book_new();
        xlsx.utils.book_append_sheet(workbook, worksheet, 'Leads');
        const buffer = xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' });

        // 4. Upload to Google Cloud Storage
        const fileName = `exports/leads_${tenantId}_${Date.now()}.xlsx`;
        const file = bucket.file(fileName);

        await file.save(buffer, {
            metadata: {
                contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            },
        });

        // 5. Generate a signed URL for temporary access
        const [url] = await file.getSignedUrl({
            action: 'read',
            expires: Date.now() + 15 * 60 * 1000, // 15 minutes
        });

        return `Your lead export is ready! You can download it here:\n${url}\n\nThis link will expire in 15 minutes.`;

    } catch (error) {
        console.error('Error exporting leads to Excel:', error.message);
        return 'An error occurred while exporting your leads. Please try again later.';
    }
};


module.exports = {
    getLeadSummary,
    exportLeadsToExcel,
};



