// Enhanced follow-up scheduling and debugging utilities
const { dbClient } = require('./config');
const { isUnsubscribed } = require('./unsubscribeService');

/**
 * Debug follow-up creation with detailed logging
 */
const debugFollowUpCreation = async (tenantId, endUserPhone, minutes) => {
    try {
        const scheduledTime = new Date(Date.now() + minutes * 60 * 1000);
        
        console.log('[FOLLOWUP_DEBUG] Creating follow-up:', {
            tenantId,
            endUserPhone,
            scheduledTime: scheduledTime.toISOString(),
            minutesFromNow: minutes,
            currentTime: new Date().toISOString()
        });

        const { data: followUp, error } = await dbClient
            .from('follow_ups')
            .insert({
                tenant_id: tenantId,
                end_user_phone: endUserPhone,
                scheduled_time: scheduledTime.toISOString(),
                message: `Follow-up message after ${minutes} minutes - Debug test`,
                status: 'pending'
            })
            .select('*')
            .single();

        if (error) {
            console.error('[FOLLOWUP_DEBUG] Creation failed:', error);
            return { success: false, error };
        }

        console.log('[FOLLOWUP_DEBUG] Follow-up created successfully:', {
            id: followUp.id,
            scheduled_time: followUp.scheduled_time,
            status: followUp.status
        });
        return { success: true, followUp };

    } catch (error) {
        console.error('[FOLLOWUP_DEBUG] Exception:', error.message);
        return { success: false, error: error.message };
    }
};

/**
 * Debug follow-up processing with detailed status
 */
const debugFollowUpProcessing = async () => {
    try {
        const now = new Date();
        console.log('[FOLLOWUP_DEBUG] Current time:', now.toISOString());

        // Check all follow-ups for debugging
        const { data: allFollowUps } = await dbClient
            .from('follow_ups')
            .select('*')
            .order('scheduled_time', { ascending: false })
            .limit(10);

        console.log('[FOLLOWUP_DEBUG] Recent follow-ups (last 10):', allFollowUps?.map(f => ({
            id: f.id,
            phone: f.end_user_phone,
            status: f.status,
            scheduledTime: f.scheduled_time,
            sentAt: f.sent_at,
            minutesFromNow: f.scheduled_time ? ((new Date(f.scheduled_time) - now) / (1000 * 60)).toFixed(1) : null
        })) || []);

        // Check pending follow-ups specifically
        const { data: pending } = await dbClient
            .from('follow_ups')
            .select('*')
            .eq('status', 'pending')
            .lt('scheduled_time', now.toISOString())
            .order('scheduled_time', { ascending: true });

        console.log('[FOLLOWUP_DEBUG] Pending follow-ups due NOW:', pending?.length || 0);
        
        if (pending && pending.length > 0) {
            console.log('[FOLLOWUP_DEBUG] Due follow-ups details:', pending.map(f => ({
                id: f.id,
                phone: f.end_user_phone,
                scheduledTime: f.scheduled_time,
                minutesOverdue: ((now - new Date(f.scheduled_time)) / (1000 * 60)).toFixed(1),
                message: f.message
            })));
        }

        // Check upcoming follow-ups
        const { data: upcoming } = await dbClient
            .from('follow_ups')
            .select('*')
            .eq('status', 'pending')
            .gt('scheduled_time', now.toISOString())
            .order('scheduled_time', { ascending: true })
            .limit(5);

        console.log('[FOLLOWUP_DEBUG] Upcoming follow-ups:', upcoming?.map(f => ({
            id: f.id,
            phone: f.end_user_phone,
            scheduledTime: f.scheduled_time,
            minutesFromNow: ((new Date(f.scheduled_time) - now) / (1000 * 60)).toFixed(1)
        })) || []);

        return { 
            pending: pending || [], 
            upcoming: upcoming || [],
            total: allFollowUps?.length || 0
        };

    } catch (error) {
        console.error('[FOLLOWUP_DEBUG] Processing check failed:', error.message);
        return { pending: [], error: error.message };
    }
};

/**
 * Enhanced follow-up scheduler with comprehensive error handling
 */
const enhancedFollowUpScheduler = async () => {
    try {
        console.log('[FOLLOWUP_CRON] ===== Starting enhanced follow-up check =====');
        
        const now = new Date();
        console.log('[FOLLOWUP_CRON] Current time:', now.toISOString());
        
        const { data: followUps, error } = await dbClient
            .from('follow_ups')
            .select('*')
            .eq('status', 'pending')
            .lt('scheduled_time', now.toISOString())
            .order('scheduled_time', { ascending: true })
            .limit(10);

        if (error) {
            console.error('[FOLLOWUP_CRON] Database error:', error.message);
            return { success: false, error: error.message };
        }

        console.log('[FOLLOWUP_CRON] Found', followUps?.length || 0, 'follow-ups to process');

        let processed = 0;
        let successful = 0;
        let failed = 0;

        for (const followUp of followUps || []) {
            try {
                processed++;
                console.log(`[FOLLOWUP_CRON] Processing follow-up ${processed}/${followUps.length}:`, {
                    id: followUp.id,
                    phone: followUp.end_user_phone,
                    scheduledTime: followUp.scheduled_time,
                    minutesOverdue: ((now - new Date(followUp.scheduled_time)) / (1000 * 60)).toFixed(1)
                });

                // Import WhatsApp service
                const { sendMessage } = require('./whatsappService');

                // Enforce opt-out list
                if (await isUnsubscribed(followUp.end_user_phone)) {
                    await dbClient
                        .from('follow_ups')
                        .update({
                            status: 'skipped',
                            error_message: 'User unsubscribed',
                            failed_at: now.toISOString()
                        })
                        .eq('id', followUp.id);

                    console.log('[FOLLOWUP_CRON] Skipped follow-up (unsubscribed):', followUp.id);
                    continue;
                }
                
                // Send WhatsApp message
                const sendResult = await sendMessage(followUp.end_user_phone, followUp.message);
                console.log('[FOLLOWUP_CRON] WhatsApp send result:', sendResult);

                // Mark as sent
                const { error: updateError } = await dbClient
                    .from('follow_ups')
                    .update({ 
                        status: 'sent', 
                        sent_at: now.toISOString(),
                        response_data: JSON.stringify(sendResult)
                    })
                    .eq('id', followUp.id);

                if (updateError) {
                    console.error('[FOLLOWUP_CRON] Failed to update follow-up status:', updateError.message);
                } else {
                    successful++;
                    console.log('[FOLLOWUP_CRON] Follow-up sent and marked as sent:', followUp.id);
                }

            } catch (sendError) {
                failed++;
                console.error('[FOLLOWUP_CRON] Failed to send follow-up:', followUp.id, sendError.message);

                // Mark as failed
                try {
                    await dbClient
                        .from('follow_ups')
                        .update({ 
                            status: 'failed', 
                            error_message: sendError.message,
                            failed_at: now.toISOString()
                        })
                        .eq('id', followUp.id);
                } catch (markError) {
                    console.error('[FOLLOWUP_CRON] Failed to mark follow-up as failed:', markError.message);
                }
            }
        }

        const summary = {
            success: true,
            processed,
            successful,
            failed,
            timestamp: now.toISOString()
        };

        console.log('[FOLLOWUP_CRON] ===== Enhanced follow-up check completed =====', summary);
        return summary;

    } catch (error) {
        console.error('[FOLLOWUP_CRON] Enhanced scheduler error:', error.message);
        return { success: false, error: error.message };
    }
};

/**
 * Test follow-up system with immediate trigger
 */
const testFollowUpSystem = async (tenantId, endUserPhone, testMessage = "Test follow-up message") => {
    try {
        console.log('[FOLLOWUP_TEST] Starting follow-up system test');
        
        // Create a follow-up 1 minute in the future
        const createResult = await debugFollowUpCreation(tenantId, endUserPhone, 1);
        if (!createResult.success) {
            return { success: false, step: 'creation', error: createResult.error };
        }

        console.log('[FOLLOWUP_TEST] Created test follow-up:', createResult.followUp.id);
        
        // Wait a moment and check processing
        setTimeout(async () => {
            console.log('[FOLLOWUP_TEST] Checking processing after 1 minute...');
            await debugFollowUpProcessing();
            await enhancedFollowUpScheduler();
        }, 65000); // 65 seconds to ensure it's past the 1-minute mark

        return { 
            success: true, 
            followUpId: createResult.followUp.id,
            message: 'Test follow-up created, check logs in 1 minute'
        };

    } catch (error) {
        console.error('[FOLLOWUP_TEST] Test failed:', error.message);
        return { success: false, error: error.message };
    }
};

module.exports = {
    debugFollowUpCreation,
    debugFollowUpProcessing,
    enhancedFollowUpScheduler,
    testFollowUpSystem
};

