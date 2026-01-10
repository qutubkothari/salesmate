// schedulers/intelligenceRunner.js
const cron = require('node-cron');
const { dbClient } = require('../services/config');
const analytics = require('../services/analytics');

/**
 * Run intelligence analysis nightly for all tenants
 */
async function runIntelligenceAnalysis() {
    try {
        console.log('[INTELLIGENCE] Starting nightly analysis');
        
        // Get all active tenants
        const { data: tenants, error } = await dbClient
            .from('tenants')
            .select('id, business_name')
            .eq('is_active', true);
        
        if (error) throw error;
        
        for (const tenant of tenants) {
            console.log(`[INTELLIGENCE] Analyzing tenant: ${tenant.business_name}`);
            
            // Log job start
            const { data: jobRun } = await dbClient
                .from('intelligence_job_runs')
                .insert({
                    tenant_id: tenant.id,
                    job_type: 'full_analysis',
                    status: 'running'
                })
                .select('id')
                .single();
            
            try {
                // Run purchase frequency and product affinity analysis per customer
                const purchaseFrequency = require('../services/analytics/purchaseFrequency');
                const productAffinity = require('../services/analytics/productAffinity');

                // Fetch customers for this tenant
                const { data: customersForTenant, error: custErr } = await dbClient
                    .from('customer_profiles')
                    .select('id')
                    .eq('tenant_id', tenant.id);

                if (custErr) throw custErr;

                let freqResult = { customersProcessed: 0, durationSeconds: 0 };
                let affinityResult = { customersProcessed: 0, durationSeconds: 0 };

                if (customersForTenant && customersForTenant.length > 0) {
                    for (const c of customersForTenant) {
                        const start = Date.now();
                        try {
                            const res = await purchaseFrequency.analyzePurchaseFrequency(c.id);
                            freqResult.customersProcessed += res ? 1 : 0;
                        } catch (e) {
                            console.warn('[INTELLIGENCE] Error analyzing frequency for customer', c.id, e?.message);
                        }
                        freqResult.durationSeconds += Math.max(0, Math.round((Date.now() - start) / 1000));

                        const startA = Date.now();
                        try {
                            const resA = await productAffinity.analyzeProductAffinity(c.id);
                            affinityResult.customersProcessed += resA ? 1 : 0;
                        } catch (e) {
                            console.warn('[INTELLIGENCE] Error analyzing affinity for customer', c.id, e?.message);
                        }
                        affinityResult.durationSeconds += Math.max(0, Math.round((Date.now() - startA) / 1000));
                    }
                }

                // After analytics complete, run proactive messaging
                const automation = require('../services/automation');

                // Check for overdue customers and send reminders
                const messagingResult = await automation.proactiveMessaging.runDailyOverdueCheck(tenant.id);
                console.log(`[INTELLIGENCE] Proactive messages sent: ${messagingResult.messagesSent || 0}`);

                // Send manager alerts for high-risk customers
                const { data: highRisk } = await dbClient
                    .from('customer_purchase_patterns')
                    .select(`
                        *,
                        customer_profile:customer_profiles(id, phone, company, first_name)
                    `)
                    .eq('tenant_id', tenant.id)
                    .gte('churn_risk_score', 0.7);

                if (highRisk && highRisk.length > 0) {
                    for (const customer of highRisk) {
                        await automation.managerAlerts.alertOverdueHighValue(
                            tenant.id,
                            {
                                id: customer.customer_profile.id,
                                name: customer.customer_profile.company || customer.customer_profile.first_name,
                                phone: customer.customer_profile.phone,
                                churnRisk: customer.churn_risk_score
                            },
                            {
                                daysOverdue: customer.days_overdue,
                                avgInterval: customer.avg_days_between_orders,
                                lastOrderDate: customer.last_order_date
                            }
                        );
                    }
                }

                // Update job as completed
                await dbClient
                    .from('intelligence_job_runs')
                    .update({
                        status: 'completed',
                        customers_processed: freqResult.customersProcessed,
                        completed_at: new Date().toISOString(),
                        duration_seconds: freqResult.durationSeconds + affinityResult.durationSeconds
                    })
                    .eq('id', jobRun.id);

                console.log(`[INTELLIGENCE] Tenant ${tenant.business_name} complete`);
                
            } catch (tenantError) {
                console.error(`[INTELLIGENCE] Error for tenant ${tenant.id}:`, tenantError);
                
                // Mark job as failed
                await dbClient
                    .from('intelligence_job_runs')
                    .update({
                        status: 'failed',
                        error_message: tenantError.message,
                        completed_at: new Date().toISOString()
                    })
                    .eq('id', jobRun.id);
            }
        }
        
        console.log('[INTELLIGENCE] Nightly analysis complete');
        
    } catch (error) {
        console.error('[INTELLIGENCE] Fatal error:', error);
    }
}

// Schedule to run at 2 AM daily
cron.schedule('0 2 * * *', runIntelligenceAnalysis);

console.log('[INTELLIGENCE] Scheduler initialized - runs daily at 2 AM');

module.exports = { runIntelligenceAnalysis };
