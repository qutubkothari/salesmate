/**
 * @title Support Ticket Service
 * @description Manages the logic for creating and viewing tenant support tickets.
 */
const { dbClient } = require('./config');

/**
 * Creates a new support ticket for a tenant.
 * @param {string} tenantId The ID of the tenant submitting the ticket.
 * @param {string} subject The subject of the ticket.
 * @param {string} description The full description of the issue.
 * @returns {Promise<string>} A confirmation message for the tenant.
 */
const createSupportTicket = async (tenantId, subject, description) => {
    try {
        const { data, error } = await dbClient
            .from('support_tickets')
            .insert({
                tenant_id: tenantId,
                subject: subject,
                description: description,
            })
            .select('id')
            .single();

        if (error) throw error;

        // Take the first 8 characters of the UUID for a user-friendly ticket ID
        const ticketId = data.id.substring(0, 8);
        return `Thank you for your submission. Your support ticket ID is #${ticketId}. A member of our team will get back to you shortly.`;

    } catch (error) {
        console.error('Error creating support ticket:', error.message);
        return 'We\'re sorry, but there was an error submitting your support ticket. Please try again later.';
    }
};

/**
 * Lists all open support tickets (for the admin).
 * @returns {Promise<string>} A formatted list of all open support tickets.
 */
const listOpenTickets = async () => {
    try {
        const { data, error } = await dbClient
            .from('support_tickets')
            .select('id, tenant_id, subject, created_at')
            .eq('status', 'open')
            .order('created_at', { ascending: true });

        if (error) throw error;

        if (!data || data.length === 0) {
            return 'There are no open support tickets at the moment. Great job!';
        }

        let report = '🎫 *Open Support Tickets*\n\n';
        data.forEach(ticket => {
            const ticketId = ticket.id.substring(0, 8);
            const date = new Date(ticket.created_at).toLocaleString();
            report += `*ID:* #${ticketId}\n`;
            report += `*From:* ${ticket.tenant.phone_number}\n`;
            report += `*Subject:* ${ticket.subject}\n`;
            report += `*Received:* ${date}\n---\n`;
        });

        return report;

    } catch (error) {
        console.error('Error listing open tickets:', error.message);
        return 'An error occurred while fetching open support tickets.';
    }
};

/**
 * Gets the full details of a specific support ticket.
 * @param {string} ticketId The short ID of the ticket.
 * @returns {Promise<string>} A formatted string with the ticket details.
 */
const getTicketDetails = async (ticketId) => {
    try {
        const { data, error } = await dbClient
            .from('support_tickets')
            .select('id, tenant_id, subject, description, status, created_at')
            .ilike('id', `${ticketId}%`)
            .single();

        if (error) throw error;

        const fullId = data.id.substring(0, 8);
        const date = new Date(data.created_at).toLocaleString();
        let details = `🎫 *Ticket Details for #${fullId}*\n\n`;
        details += `*From:* ${data.tenant.phone_number}\n`;
        details += `*Status:* ${data.status}\n`;
        details += `*Received:* ${date}\n`;
        details += `*Subject:* ${data.subject}\n`;
        details += `*Description:* ${data.description}\n`;

        return details;

    } catch (error) {
        console.error('Error getting ticket details:', error.message);
        if (error.code === 'PGRST116') return `No ticket found with ID starting with #${ticketId}.`;
        return 'An error occurred while fetching ticket details.';
    }
};

/**
 * Closes a support ticket.
 * @param {string} ticketId The short ID of the ticket.
 * @returns {Promise<string>} A confirmation message.
 */
const closeTicket = async (ticketId) => {
    try {
        const { data, error } = await dbClient
            .from('support_tickets')
            .update({ status: 'closed', updated_at: new Date().toISOString() })
            .ilike('id', `${ticketId}%`)
            .select('id');

        if (error) throw error;
        if (!data || data.length === 0) {
            return `No open ticket found with ID starting with #${ticketId}.`;
        }

        const fullId = data[0].id.substring(0, 8);
        return `Ticket #${fullId} has been closed successfully.`;

    } catch (error) {
        console.error('Error closing ticket:', error.message);
        return 'An error occurred while closing the ticket.';
    }
};

module.exports = {
    createSupportTicket,
    listOpenTickets,
    getTicketDetails,
    closeTicket,
};



