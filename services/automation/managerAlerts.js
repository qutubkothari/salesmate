// services/automation/managerAlerts.js
const { dbClient } = require('../config');
const { sendMessage } = require('../whatsappService');

/**
 * Alert sales manager about important customer events
 */
class ManagerAlerts {
    
    /**
     * Send alert to manager
     */
    async sendAlert(tenantId, alertData) {
        try {
            // Get manager phone from tenant
            const { data: tenant } = await dbClient
                .from('tenants')
                .select('admin_phone, business_name')
                .eq('id', tenantId)
                .single();
            
            if (!tenant || !tenant.admin_phone) {
                console.log('[MANAGER_ALERT] No admin phone configured');
                return { success: false, reason: 'no_admin_phone' };
            }
            
            // Format message
            let message = `ðŸ”” *Sales Alert*\n\n`;
            message += `*${alertData.title}*\n\n`;
            message += alertData.message;
            
            if (alertData.action) {
                message += `\n\nðŸ“‹ *Action:* ${alertData.action}`;
            }
            
            await sendMessage(tenant.admin_phone, message);
            
            // Log alert
            await dbClient
                .from('manager_alerts')
                .insert({
                    tenant_id: tenantId,
                    alert_type: alertData.type,
                    priority: alertData.priority,
                    customer_profile_id: alertData.customerProfileId,
                    customer_name: alertData.customerName,
                    customer_phone: alertData.customerPhone,
                    title: alertData.title,
                    message: alertData.message,
                    details: alertData.details,
                    action_taken: alertData.action
                });
            
            return { success: true };
            
        } catch (error) {
            console.error('[MANAGER_ALERT] Error sending alert:', error);
            return { success: false, error: error.message };
        }
    }
    
    /**
     * Alert about high-value overdue customer
     */
    async alertOverdueHighValue(tenantId, customerData, patternData) {
        try {
            const alertData = {
                type: 'customer_overdue',
                priority: customerData.churnRisk > 0.7 ? 'high' : 'medium',
                customerProfileId: customerData.id,
                customerName: customerData.name,
                customerPhone: customerData.phone,
                title: `${customerData.name} Overdue`,
                message: `Customer hasn't ordered in ${patternData.daysOverdue} days\n` +
                    `â€¢ Usual interval: ${Math.round(patternData.avgInterval)} days\n` +
                    `â€¢ Last order: ${new Date(patternData.lastOrderDate).toLocaleDateString()}\n` +
                    `â€¢ Churn risk: ${Math.round(customerData.churnRisk * 100)}%`,
                action: 'Auto-message sent. Consider personal follow-up.',
                details: patternData
            };
            
            return await this.sendAlert(tenantId, alertData);
            
        } catch (error) {
            console.error('[MANAGER_ALERT] Error alerting overdue:', error);
            return { success: false, error: error.message };
        }
    }
    
    /**
     * Alert about unusual order pattern
     */
    async alertUnusualOrder(tenantId, customerData, anomalies) {
        try {
            let message = `Unusual order from ${customerData.name}\n\n`;
            
            if (anomalies.missingProducts?.length > 0) {
                message += `*Missing usual items:*\n`;
                anomalies.missingProducts.forEach(p => {
                    message += `â€¢ ${p.productName}\n`;
                });
            }
            
            if (anomalies.lowQuantities?.length > 0) {
                message += `\n*Lower quantities:*\n`;
                anomalies.lowQuantities.forEach(a => {
                    message += `â€¢ ${a.reduction}% less than usual\n`;
                });
            }
            
            const alertData = {
                type: 'unusual_order',
                priority: 'medium',
                customerProfileId: customerData.id,
                customerName: customerData.name,
                customerPhone: customerData.phone,
                title: 'Unusual Order Pattern',
                message: message,
                action: 'System suggested missing items',
                details: anomalies
            };
            
            return await this.sendAlert(tenantId, alertData);
            
        } catch (error) {
            console.error('[MANAGER_ALERT] Error alerting unusual order:', error);
            return { success: false, error: error.message };
        }
    }
}

module.exports = new ManagerAlerts();
