/**
 * @title Enhanced Cron Job for All Scheduled Tasks
 * @description Updated scheduler with enhanced AI-driven follow-up system,
 * multi-language support, and dynamic lead scoring intervals.
 */

// Import existing services
const { findAndSendScheduledMessages } = require('./services/scheduleService');
const { sendDueManualReminders } = require('./services/reminderService');
const { sendDueOnboardingMessages } = require('./services/onboardingService');
const { processBroadcastQueue } = require('./services/broadcastService');
const { sendDailySummaries } = require('./services/summaryService');
const { processDripCampaigns } = require('./services/dripCampaignService');
const { processAbandonedCarts } = require('./services/abandonedCartService');
const { processSurveyDeployments } = require('./services/surveyService');
const { generateMissingDescriptions } = require('./services/aiDescriptionService');
const { syncProductsFromZoho } = require('./scripts/syncZohoProducts');
const { scheduleZohoOrderSync } = require('./services/zohoOrderSyncService');

// Import enhanced services
const { sendDueFollowUpReminders } = require('./services/enhancedFollowUpService');
const { scoreLead, updateLeadScores } = require('./services/leadScoringService');
const { initializeFollowUpScheduler } = require('./schedulers/followUpCron');
const { enhancedFollowUpScheduler, debugFollowUpProcessing } = require('./services/conversationResetService');
const { scheduleProactiveMessages, sendPendingMessages } = require('./services/automation/proactiveMessagingService');

// Import VRL shipment tracking service
const { checkShipmentsForUpdates } = require('./services/vrlTrackingService');
const { sendMessage } = require('./services/whatsappService');

// Import conversation flag service with fallback handling
let cleanupExpiredFlags;
try {
  const conversationFlagService = require('./services/conversationFlagService');
  cleanupExpiredFlags = conversationFlagService.cleanupExpiredFlags;
} catch (error) {
  console.warn('[SCHEDULER] conversationFlagService not found, using fallback');
  cleanupExpiredFlags = async () => {
    console.log('[SCHEDULER] Fallback: cleanupExpiredFlags - service not available');
    return { cleaned: 0, message: 'Service not available' };
  };
}

// scheduler.js - Updated to include follow-up scheduling
// Initialize follow-up scheduler
console.log('[SCHEDULER] Initializing follow-up scheduler...');
initializeFollowUpScheduler();
console.log('[SCHEDULER] Follow-up scheduler initialized');

// Add any other existing scheduler initialization code here
console.log('[SCHEDULER] All schedulers initialized successfully');

// Lead scoring wrapper function
const processLeadScoreUpdates = async () => {
  try {
    // Process all conversations that need lead score updates
    const { dbClient } = require('./services/config');
    const { data: conversations } = await dbClient
      .from('conversations')
      .select('tenant_id, end_user_phone')
      .is('last_lead_score_update', null)
      .or('last_lead_score_update.lt.' + new Date(Date.now() - 24*60*60*1000).toISOString())
      .limit(50);

    let updated = 0;
    for (const conv of conversations || []) {
      try {
        await scoreLead(conv.tenant_id, conv.end_user_phone);
        updated++;
      } catch (err) {
        console.warn('[LEAD_SCORING] Failed for', conv.end_user_phone, err.message);
      }
    }
    
    console.log(`[LEAD_SCORING] Updated ${updated} lead scores`);
    return { updated };
  } catch (error) {
    console.error('[LEAD_SCORING] Process failed:', error.message);
    throw error;
  }
};

// Proactive messaging wrapper - runs for all tenants
const processProactiveMessages = async () => {
  try {
    const { dbClient } = require('./services/config');
    
    // Get all active tenants
    const { data: tenants, error } = await dbClient
      .from('tenants')
      .select('id, business_name')
      .eq('is_active', true);

    if (error) throw error;

    let totalScheduled = 0;
    for (const tenant of tenants || []) {
      try {
        console.log(`[PROACTIVE] Processing tenant: ${tenant.business_name} (${tenant.id})`);
        const result = await scheduleProactiveMessages(tenant.id);
        totalScheduled += result?.messagesScheduled || 0;
      } catch (err) {
        console.warn(`[PROACTIVE] Failed for tenant ${tenant.id}:`, err.message);
      }
    }
    
    console.log(`[PROACTIVE] Total messages scheduled: ${totalScheduled}`);
    return { totalScheduled };
  } catch (error) {
    console.error('[PROACTIVE] Process failed:', error.message);
    throw error;
  }
};

// Send pending proactive messages - runs hourly
const sendProactiveMessages = async () => {
  try {
    const { dbClient } = require('./services/config');
    
    // Get all active tenants
    const { data: tenants, error } = await dbClient
      .from('tenants')
      .select('id, business_name')
      .eq('is_active', true);

    if (error) throw error;

    let totalSent = 0;
    for (const tenant of tenants || []) {
      try {
        console.log(`[PROACTIVE] Sending pending messages for: ${tenant.business_name} (${tenant.id})`);
        await sendPendingMessages(tenant.id);
        totalSent++;
      } catch (err) {
        console.warn(`[PROACTIVE] Failed sending for tenant ${tenant.id}:`, err.message);
      }
    }
    
    console.log(`[PROACTIVE] Processed ${totalSent} tenants for message delivery`);
    return { totalSent };
  } catch (error) {
    console.error('[PROACTIVE] Send failed:', error.message);
    throw error;
  }
};

// VRL Shipment Tracking - runs daily
const processShipmentTracking = async () => {
  try {
    console.log('[SHIPMENT_TRACKING] Starting daily shipment status check...');
    const startTime = Date.now();

    const summary = await checkShipmentsForUpdates(sendMessage);

    const duration = Math.round((Date.now() - startTime) / 1000);

    console.log(`[SHIPMENT_TRACKING] Completed in ${duration}s:`, {
      total: summary.total,
      updated: summary.updated,
      notified: summary.notified,
      errors: summary.errors
    });

    // Log to admin if there were significant updates
    if (summary.notified > 0) {
      console.log(`[SHIPMENT_TRACKING] ðŸ“¬ Sent ${summary.notified} notifications to customers`);
    }

    return summary;
  } catch (error) {
    console.error('[SHIPMENT_TRACKING] Process failed:', error.message);
    throw error;
  }
};

/**
 * Enhanced task runner with better error handling and metrics
 */
const runScheduledTasks = async () => {
    const startTime = new Date();
    console.log(`[${startTime.toISOString()}] Starting enhanced scheduled tasks...`);

    const taskMetrics = {
        total: 0,
        successful: 0,
        failed: 0,
        errors: []
    };

    // Define all tasks with priority levels
    const tasks = [
        // High Priority - Customer-facing
        { 
            name: 'Enhanced Follow-ups (AI-Driven)', 
            func: sendDueFollowUpReminders,
            priority: 'high',
            description: 'Smart follow-ups with dynamic intervals (24h/48h/72h)'
        },
        { 
            name: 'Enhanced Follow-up Scheduler (Debug)', 
            func: enhancedFollowUpScheduler,
            priority: 'high',
            description: 'Enhanced follow-up processing with comprehensive error handling'
        },
        { 
            name: 'Abandoned Cart Recovery', 
            func: processAbandonedCarts,
            priority: 'high',
            description: 'Recover abandoned carts with personalized messages'
        },
        { 
            name: 'Smart Reorder Reminders', 
            func: processProactiveMessages,
            priority: 'high',
            description: 'Predictive reorder reminders based on purchase patterns'
        },
        { 
            name: 'Send Scheduled Reorder Messages', 
            func: sendProactiveMessages,
            priority: 'high',
            description: 'Send pending proactive messages to customers'
        },
        { 
            name: 'Drip Campaigns', 
            func: processDripCampaigns,
            priority: 'high',
            description: 'Sequential automated marketing campaigns'
        },
        
        // Medium Priority - Admin-facing
        { 
            name: 'Manual Reminders', 
            func: sendDueManualReminders,
            priority: 'medium',
            description: 'Admin-set custom reminders'
        },
        { 
            name: 'Process Broadcast Queue', 
            func: processBroadcastQueue,
            priority: 'medium',
            description: 'Process pending broadcast messages with rate limiting'
        },
        /*
        { 
            name: 'Tenant Bulk Messages', 
            func: findAndSendScheduledMessages,
            priority: 'medium',
            description: 'Legacy scheduled message system'
        },
        */
        
        // Low Priority - Background processing
        { 
            name: 'Lead Score Updates', 
            func: processLeadScoreUpdates,
            priority: 'low',
            description: 'Periodic lead scoring analysis'
        },
        { 
            name: 'Survey Deployments', 
            func: processSurveyDeployments,
            priority: 'low',
            description: 'Automated survey distribution'
        },
        { 
            name: 'AI Product Descriptions', 
            func: generateMissingDescriptions,
            priority: 'low',
            description: 'Generate missing product descriptions'
        },
        { 
            name: 'Tenant Onboarding', 
            func: sendDueOnboardingMessages,
            priority: 'low',
            description: 'New tenant onboarding sequence'
        },
        { 
            name: 'Cleanup Expired Flags', 
            func: cleanupExpiredFlags,
            priority: 'low',
            description: 'Clean up old conversation flags'
        },
        { 
            name: 'Zoho Product Sync',
            func: syncProductsFromZoho,
            priority: 'low',
            description: 'Sync products and inventory from Zoho Books'
        },
        { 
            name: 'Zoho Order Sync',
            func: scheduleZohoOrderSync,
            priority: 'low',
            description: 'Sync invoices/orders from Zoho Books to update customer purchase history'
        },
        
        // Daily tasks (run less frequently)
        {
            name: 'Daily Summaries',
            func: sendDailySummaries,
            priority: 'daily',
            description: 'Send daily performance summaries to admins'
        },
        {
            name: 'VRL Shipment Tracking',
            func: processShipmentTracking,
            priority: 'daily',
            description: 'Check VRL LR status updates and notify customers'
        }
    ];

    // Filter tasks based on time of day
    const currentHour = new Date().getHours();
    const isBusinessHours = currentHour >= 9 && currentHour <= 18;
    const isDailyRun = currentHour === 9; // Run daily tasks at 9 AM (changed from 8 AM for shipment tracking)

    let tasksToRun = tasks.filter(task => {
        if (task.priority === 'daily') {
            return isDailyRun;
        }
        // Run high priority tasks always, others only during business hours
        return task.priority === 'high' || isBusinessHours;
    });

    console.log(`[SCHEDULER] Running ${tasksToRun.length}/${tasks.length} tasks (Business hours: ${isBusinessHours})`);

    // Execute tasks with enhanced error handling
    for (const task of tasksToRun) {
        const taskStart = Date.now();
        taskMetrics.total++;
        
        try {
            // Add function validation
            if (typeof task.func !== 'function') {
                throw new Error(`Task function is not defined: ${typeof task.func}`);
            }
            
            console.log(`--- [${task.priority.toUpperCase()}] Running: ${task.name} ---`);
            console.log(`    Description: ${task.description}`);
            
            await task.func();
            
            const duration = Date.now() - taskStart;
            taskMetrics.successful++;
            
            console.log(`âœ… [${task.name}] completed successfully in ${duration}ms`);
            
            // Log slow tasks
            if (duration > 30000) { // 30 seconds
                console.warn(`âš ï¸ [${task.name}] took ${duration}ms - consider optimization`);
            }
            
        } catch (error) {
            const duration = Date.now() - taskStart;
            taskMetrics.failed++;
            taskMetrics.errors.push({
                task: task.name,
                error: error.message,
                duration
            });
            
            console.error(`âŒ [${task.name}] failed after ${duration}ms:`, error.message);
            
            // For critical tasks, log more details
            if (task.priority === 'high') {
                console.error(`[CRITICAL ERROR] Stack trace for ${task.name}:`, error.stack);
            }
        }
    }

    // Generate execution summary
    const totalDuration = Date.now() - startTime.getTime();
    const summary = {
        timestamp: new Date().toISOString(),
        duration: `${totalDuration}ms`,
        tasks: {
            total: taskMetrics.total,
            successful: taskMetrics.successful,
            failed: taskMetrics.failed,
            successRate: `${Math.round((taskMetrics.successful / taskMetrics.total) * 100)}%`
        },
        errors: taskMetrics.errors
    };

    console.log(`[${new Date().toISOString()}] Scheduled tasks completed:`, JSON.stringify(summary, null, 2));

    // Alert on high failure rate
    if (taskMetrics.failed > 0 && (taskMetrics.failed / taskMetrics.total) > 0.3) {
        console.error(`ðŸš¨ HIGH FAILURE RATE: ${taskMetrics.failed}/${taskMetrics.total} tasks failed`);
    }

    return summary;
};

/**
 * Health check function for scheduler
 */
const getSchedulerHealth = () => {
    return {
        status: 'healthy',
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        lastRun: new Date().toISOString(),
        pid: process.pid
    };
};

/**
 * Emergency task runner (high priority only)
 */
const runEmergencyTasks = async () => {
    console.log('[EMERGENCY] Running critical tasks only...');
    
    const criticalTasks = [
        { name: 'Enhanced Follow-ups', func: sendDueFollowUpReminders },
        { name: 'Abandoned Cart Recovery', func: processAbandonedCarts }
    ];

    for (const task of criticalTasks) {
        try {
            await task.func();
            console.log(`âœ… Emergency task [${task.name}] completed`);
        } catch (error) {
            console.error(`âŒ Emergency task [${task.name}] failed:`, error.message);
        }
    }
};

// Schedule product sync from Zoho every 4 hours
const cron = require('node-cron');

// ========== PHASE 2: FSM INTEGRATION SCHEDULER JOBS ==========

// Import Phase 2 services
const dailySummaryService = require('./services/dailySummaryService');
const targetSyncService = require('./services/targetSyncService');
const targetService = require('./services/targetService');

/**
 * Daily Summary Job - Runs at 6 PM IST
 * Generates and sends daily team performance summary to managers
 */
cron.schedule('0 18 * * *', async () => {
    console.log('[SCHEDULER] [Phase 2] Running daily summary generation at 6 PM...');
    try {
        const { dbClient } = require('./services/config');
        
        // Get all active tenants
        const { data: tenants } = await dbClient
            .from('tenants')
            .select('id, business_name')
            .eq('is_active', true);

        let summariesGenerated = 0;
        
        for (const tenant of tenants || []) {
            try {
                console.log(`[SCHEDULER] Generating summary for ${tenant.business_name}...`);
                
                // Generate daily summary
                const summaryResult = await dailySummaryService.generateDailySummary(
                    tenant.id,
                    new Date().toISOString().split('T')[0]
                );

                if (summaryResult.ok) {
                    // Format for WhatsApp
                    const formattedResult = await dailySummaryService.formatSummaryForWhatsApp(summaryResult.summary);
                    
                    if (formattedResult.ok) {
                        // Send to management
                        const sendResult = await dailySummaryService.sendSummaryToManagement(
                            tenant.id,
                            formattedResult.message
                        );
                        
                        if (sendResult.ok) {
                            console.log(`✅ Daily summary sent for ${tenant.business_name}`);
                            summariesGenerated++;
                        }
                    }
                }
            } catch (error) {
                console.error(`[SCHEDULER] Summary generation failed for ${tenant.id}:`, error.message);
            }
        }
        
        console.log(`[SCHEDULER] Daily summary job completed - ${summariesGenerated} summaries sent`);
    } catch (error) {
        console.error('[SCHEDULER] Daily summary job failed:', error.message);
    }
}, {
    timezone: "Asia/Kolkata"
});
console.log('[Scheduler] Daily summary job scheduled for 6 PM IST');

/**
 * Daily Target Sync Job - Runs at 9 AM IST
 * Syncs target status to broadcast messaging and AI context
 */
cron.schedule('0 9 * * *', async () => {
    console.log('[SCHEDULER] [Phase 2] Running daily target sync at 9 AM...');
    try {
        // Sync targets for all tenants
        const syncResult = await targetSyncService.syncAllTenantsTargets();
        
        if (syncResult.ok) {
            console.log(`✅ Target sync completed for ${syncResult.synced_tenants} tenants`);
        } else {
            console.error('[SCHEDULER] Target sync failed:', syncResult.error);
        }
    } catch (error) {
        console.error('[SCHEDULER] Target sync job failed:', error.message);
    }
}, {
    timezone: "Asia/Kolkata"
});
console.log('[Scheduler] Daily target sync job scheduled for 9 AM IST');

/**
 * Month-End Target Rollover Job - Runs at 11:59 PM on last day of month
 * Automatically rolls over targets to new month
 */
cron.schedule('59 23 28-31 * *', async () => {
    console.log('[SCHEDULER] [Phase 2] Running month-end target rollover...');
    try {
        const { dbClient } = require('./services/config');
        
        // Check if it's actually the last day of month
        const now = new Date();
        const nextDay = new Date(now.getFullYear(), now.getMonth() + 1, 1);
        const isLastDay = (nextDay - now) <= 24*60*60*1000;
        
        if (!isLastDay) {
            console.log('[SCHEDULER] Not the last day of month, skipping rollover');
            return;
        }

        // Get all active tenants
        const { data: tenants } = await dbClient
            .from('tenants')
            .select('id, business_name')
            .eq('is_active', true);

        let rolloversCompleted = 0;
        
        for (const tenant of tenants || []) {
            try {
                console.log(`[SCHEDULER] Rolling over targets for ${tenant.business_name}...`);
                
                // Get current targets
                const currentTargets = await targetService.getSalesmanTargets(
                    tenant.id,
                    null,
                    null
                );
                
                if (currentTargets.ok && currentTargets.targets) {
                    // Rollover to next month
                    const rolloverResult = await targetService.rolloverTargets(
                        tenant.id,
                        currentTargets.targets
                    );
                    
                    if (rolloverResult.ok) {
                        console.log(`✅ Targets rolled over for ${tenant.business_name}`);
                        rolloversCompleted++;
                    }
                }
            } catch (error) {
                console.error(`[SCHEDULER] Target rollover failed for ${tenant.id}:`, error.message);
            }
        }
        
        console.log(`[SCHEDULER] Month-end rollover completed - ${rolloversCompleted} tenants updated`);
    } catch (error) {
        console.error('[SCHEDULER] Month-end rollover job failed:', error.message);
    }
}, {
    timezone: "Asia/Kolkata"
});
console.log('[Scheduler] Month-end target rollover job scheduled for 11:59 PM on 28-31 of each month');

// ========== END PHASE 2 SCHEDULER JOBS ==========

// Runs every 4 hours (6 times per day: 12 AM, 4 AM, 8 AM, 12 PM, 4 PM, 8 PM)
cron.schedule('0 */4 * * *', async () => {
    console.log('[Scheduler] Running 4-hourly Zoho product sync...');
    try {
        await syncProductsFromZoho();
        console.log('[Scheduler] Product sync completed successfully');
    } catch (error) {
        console.error('[Scheduler] Product sync failed:', error);
    }
}, {
    timezone: "Asia/Kolkata"
});
console.log('[Scheduler] Zoho product sync scheduled to run every 4 hours (6 times daily)');

// Schedule Zoho order sync every hour
cron.schedule('0 * * * *', async () => {
    console.log('[Scheduler] Running hourly Zoho order sync...');
    try {
        await scheduleZohoOrderSync();
        console.log('[Scheduler] Zoho order sync completed successfully');
    } catch (error) {
        console.error('[Scheduler] Zoho order sync failed:', error);
    }
}, {
    timezone: "Asia/Kolkata"
});
console.log('[Scheduler] Zoho order sync scheduled to run every hour');

// Schedule autonomous follow-up sequence processing every 15 minutes
cron.schedule('*/15 * * * *', async () => {
    console.log('[Scheduler] Running autonomous follow-up sequences...');
    try {
        const AutonomousFollowupService = require('./services/autonomous-followup-service');
        const results = await AutonomousFollowupService.processSequences();
        console.log(`[Scheduler] Follow-up processing complete:`, {
            processed: results.processed,
            sent: results.sent,
            failed: results.failed,
            completed: results.completed
        });
    } catch (error) {
        console.error('[Scheduler] Follow-up processing failed:', error);
    }
}, {
    timezone: "Asia/Kolkata"
});
console.log('[Scheduler] Autonomous follow-up sequences scheduled to run every 15 minutes');

// Main execution when run as standalone script
if (require.main === module) {
    (async () => {
        try {
            const isEmergency = process.argv.includes('--emergency');
            
            if (isEmergency) {
                await runEmergencyTasks();
            } else {
                await runScheduledTasks();
            }
        } catch (error) {
            console.error('[SCHEDULER] Critical error during execution:', error);
            process.exit(1);
        }
    })();
}

module.exports = {
    // Export any existing scheduler functions
    runScheduledTasks,
    runEmergencyTasks,
    getSchedulerHealth
};
