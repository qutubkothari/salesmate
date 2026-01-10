// commands/syncInvoice.js
const { dbClient } = require('../config/database');
const zohoInvoiceSync = require('../services/zohoInvoiceSyncService');
const { sendMessage } = require('../services/whatsappService');

/**
 * Admin command to sync invoice from Zoho
 * Usage: /sync-invoice <invoice_id>
 * or: /sync-all-invoices
 */
async function handleSyncInvoiceCommand(req, res, tenant, from, messageText) {
    try {
        const parts = messageText.trim().split(/\s+/);
        const command = parts[0].toLowerCase();

        // /sync-all-invoices
        if (command === '/sync-all-invoices' || command === '/sync-invoices') {
            await sendMessage(from, 'ðŸ”„ Syncing all invoices from Zoho... This may take a moment.');
            
            const result = await zohoInvoiceSync.syncAllInvoicesFromZoho(tenant.id, 30);
            
            if (result.success) {
                const message = `âœ… *Invoice Sync Complete*\n\n` +
                    `ðŸ“Š Total Invoices: ${result.totalInvoices}\n` +
                    `âœ… Successfully Synced: ${result.synced}\n` +
                    `âŒ Errors: ${result.errors}\n\n` +
                    `All invoice data has been updated in your database.`;
                await sendMessage(from, message);
            } else {
                await sendMessage(from, `âŒ Sync failed: ${result.error}`);
            }
            
            return res.status(200).json({ ok: true, type: 'sync_all_invoices' });
        }

        // /sync-invoice <invoice_id>
        if (command === '/sync-invoice' && parts.length > 1) {
            const invoiceId = parts[1];
            
            await sendMessage(from, `ðŸ”„ Syncing invoice ${invoiceId} from Zoho...`);
            
            const result = await zohoInvoiceSync.syncInvoiceFromZoho(tenant.id, invoiceId);
            
            if (result.success) {
                const inv = result.invoice;
                const message = `âœ… *Invoice Synced Successfully*\n\n` +
                    `ðŸ“„ Invoice: ${inv.invoiceNumber}\n` +
                    `ðŸ’° Total: â‚¹${inv.total}\n` +
                    `ðŸ“Š Status: ${inv.status}\n` +
                    `ðŸ”¢ Items Updated: ${inv.updatedItems}\n\n` +
                    `All changes from Zoho have been saved to your database.`;
                await sendMessage(from, message);
            } else {
                await sendMessage(from, `âŒ Sync failed: ${result.error}`);
            }
            
            return res.status(200).json({ ok: true, type: 'sync_invoice' });
        }

        // Invalid command format
        const helpMessage = `ðŸ“‹ *Invoice Sync Commands*\n\n` +
            `*Sync Single Invoice:*\n` +
            `/sync-invoice <invoice_id>\n\n` +
            `*Sync All Invoices (last 30 days):*\n` +
            `/sync-all-invoices\n\n` +
            `*Example:*\n` +
            `/sync-invoice 1234567890`;
        
        await sendMessage(from, helpMessage);
        return res.status(200).json({ ok: true, type: 'sync_help' });

    } catch (error) {
        console.error('[SYNC_INVOICE_CMD] Error:', error);
        await sendMessage(from, `âŒ Error: ${error.message}`);
        return res.status(500).json({ ok: false, error: error.message });
    }
}

module.exports = { handleSyncInvoiceCommand };

