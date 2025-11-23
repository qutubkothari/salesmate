/**
 * @title Simplified Broadcast Service with Enforced Rate Limiting
 * @description Uses direct SQL for lock management, compatible with all PostgreSQL versions
 */
const { supabase, openai } = require('./config');
const { sendMessage, sendMessageWithImage } = require('./whatsappService');
const { sendWebMessage, sendWebMessageWithMedia, getClientStatus } = require('./whatsappWebService');
const { parseContactSheet } = require('./scheduleService');
const chrono = require('chrono-node');
const crypto = require('crypto');

// Configuration
const BATCH_SIZE = 5;                         // Exactly 5 messages per batch
const BASE_MESSAGE_DELAY = 10000;             // Base 10 seconds between messages
const MAX_RANDOM_DELAY = 8000;                // Add up to 8 seconds random delay (10-18 sec total)
const BATCH_COOLDOWN = 1 * 60 * 1000;        // 1 minute between batches
const MAX_RETRIES = 3;
const LOCK_TIMEOUT = 1 * 60 * 1000;          // 1 minute lock timeout

// Helper function for human-like random delays
const getHumanDelay = () => {
    return BASE_MESSAGE_DELAY + Math.floor(Math.random() * MAX_RANDOM_DELAY);
};

// Enhanced logging
const BroadcastLogger = {
    info: (message, data = {}) => {
        console.log(`[BROADCAST][INFO] ${message}`, JSON.stringify(data));
    },
    error: (message, error, data = {}) => {
        console.error(`[BROADCAST][ERROR] ${message}`, {
            error: error?.message || error,
            stack: error?.stack,
            ...data
        });
    },
    warn: (message, data = {}) => {
        console.warn(`[BROADCAST][WARN] ${message}`, JSON.stringify(data));
    },
    debug: (message, data = {}) => {
        if (process.env.DEBUG_BROADCAST === '1') {
            console.log(`[BROADCAST][DEBUG] ${message}`, JSON.stringify(data));
        }
    }
};

/**
 * Smart message sender - tries WhatsApp Web first, falls back to Maytapi
 */
const sendMessageSmart = async (tenantId, phoneNumber, messageText, mediaUrl = null) => {
    try {
        // Check if WhatsApp Web is available for this tenant
        const waWebStatus = getClientStatus(tenantId);
        
        if (waWebStatus.status === 'ready' && waWebStatus.hasClient) {
            BroadcastLogger.info('Using WhatsApp Web for message', { tenantId, phoneNumber });
            try {
                if (mediaUrl) {
                    await sendWebMessageWithMedia(tenantId, phoneNumber, messageText, mediaUrl);
                } else {
                    await sendWebMessage(tenantId, phoneNumber, messageText);
                }
                return { success: true, method: 'whatsapp-web' };
            } catch (waWebError) {
                BroadcastLogger.warn('WhatsApp Web failed, falling back to Maytapi', { 
                    tenantId, 
                    error: waWebError.message 
                });
            }
        }
        
        // Fallback to Maytapi
        BroadcastLogger.info('Using Maytapi for message', { tenantId, phoneNumber });
        if (mediaUrl) {
            await sendMessageWithImage(phoneNumber, messageText, mediaUrl);
        } else {
            await sendMessage(phoneNumber, messageText);
        }
        return { success: true, method: 'maytapi' };
        
    } catch (error) {
        BroadcastLogger.error('All message sending methods failed', error, { tenantId, phoneNumber });
        throw error;
    }
};

/**
 * Personalize message with contact and tenant data
 */
const personalizeMessage = async (messageTemplate, phoneNumber, tenantId) => {
    try {
        let personalizedMessage = messageTemplate;
        
        // Get tenant business name
        let businessName = 'Our Business';
        try {
            const { data: tenant } = await supabase
                .from('tenants')
                .select('business_name')
                .eq('id', tenantId)
                .single();
            if (tenant?.business_name) {
                businessName = tenant.business_name;
            }
        } catch (err) {
            BroadcastLogger.warn('Could not fetch tenant name', { tenantId });
        }
        
        // Try to get contact name from conversations or customers
        let contactName = null;
        try {
            const { data: conversation } = await supabase
                .from('conversations')
                .select('end_user_name')
                .eq('tenant_id', tenantId)
                .eq('end_user_phone', phoneNumber)
                .single();
            
            if (conversation?.end_user_name) {
                contactName = conversation.end_user_name;
            }
        } catch (err) {
            // Try customers table
            try {
                const { data: customer } = await supabase
                    .from('customers')
                    .select('name')
                    .eq('tenant_id', tenantId)
                    .eq('phone', phoneNumber)
                    .single();
                
                if (customer?.name) {
                    contactName = customer.name;
                }
            } catch (err2) {
                BroadcastLogger.debug('No name found for contact', { phoneNumber });
            }
        }
        
        // Replace variables
        personalizedMessage = personalizedMessage
            .replace(/\{name\}/gi, contactName || 'there')
            .replace(/\{phone\}/gi, phoneNumber)
            .replace(/\{business\}/gi, businessName);
        
        return personalizedMessage;
    } catch (error) {
        BroadcastLogger.error('Message personalization failed', error);
        return messageTemplate; // Return original if personalization fails
    }
};

/**
 * Get random greeting template
 */
const getRandomGreeting = async (tenantId) => {
    try {
        // Get active templates for tenant
        const { data: templates, error } = await supabase
            .from('greeting_templates')
            .select('id, template_text')
            .eq('is_active', true)
            .or(`tenant_id.eq.${tenantId},tenant_id.is.null`); // Get tenant-specific or default
        
        if (error || !templates || templates.length === 0) {
            // Fallback greetings if database query fails
            const fallbackGreetings = [
                'Hi {name}! 👋',
                'Hello {name}! 😊',
                'Hey {name}!',
                'Good day {name}!',
                'Hi there {name}!',
                'Hello {name}, hope you\'re doing well!',
                'Hey {name}, how are you?',
                'Hi {name}, hope this message finds you well!',
                'Hello dear {name}!',
                'Hi {name}! 🌟'
            ];
            return fallbackGreetings[Math.floor(Math.random() * fallbackGreetings.length)];
        }
        
        // Select random template
        const randomTemplate = templates[Math.floor(Math.random() * templates.length)];
        
        // Update usage count
        await supabase
            .from('greeting_templates')
            .update({ usage_count: supabase.raw('usage_count + 1') })
            .eq('id', randomTemplate.id);
        
        return randomTemplate.template_text;
    } catch (error) {
        BroadcastLogger.error('Failed to get random greeting', error);
        return 'Hi {name}!'; // Safe fallback
    }
};

/**
 * Add human-like variations to message timing and content
 */
const humanizeMessage = async (messageTemplate, phoneNumber, tenantId) => {
    try {
        // Get random greeting
        const greeting = await getRandomGreeting(tenantId);
        
        // Check if message already has a greeting
        const hasGreeting = /^(hi|hello|hey|good day|greetings)/i.test(messageTemplate.trim());
        
        let humanizedMessage = messageTemplate;
        
        if (!hasGreeting) {
            // Add random greeting at the start
            humanizedMessage = `${greeting}\n\n${messageTemplate}`;
        }
        
        // Apply personalization
        humanizedMessage = await personalizeMessage(humanizedMessage, phoneNumber, tenantId);
        
        // Add random variations
        const variations = [
            '', // No variation
            ' 😊',
            ' 🙂',
            '!',
            '.',
        ];
        
        // 30% chance to add variation at the end
        if (Math.random() > 0.7) {
            const randomVariation = variations[Math.floor(Math.random() * variations.length)];
            humanizedMessage += randomVariation;
        }
        
        return {
            message: humanizedMessage,
            greeting: greeting,
            delay: Math.floor(Math.random() * 3000) + 1000 // Random delay 1-4 seconds
        };
    } catch (error) {
        BroadcastLogger.error('Message humanization failed', error);
        const basicMessage = await personalizeMessage(messageTemplate, phoneNumber, tenantId);
        return {
            message: basicMessage,
            greeting: 'Hi {name}!',
            delay: 2000
        };
    }
};

/**
 * Normalize phone number for Maytapi (digits only)
 */
const normalizePhoneNumber = (phone) => {
    if (!phone) return null;
    
    const digits = String(phone).replace(/\D/g, '');
    
    if (digits.length < 10) return null;
    
    let normalized = digits;
    if (!normalized.startsWith('91') && normalized.length === 10) {
        normalized = '91' + normalized;
    }
    
    if (normalized.length < 10 || normalized.length > 15) {
        return null;
    }
    
    return normalized;
};

/**
 * Check if user is unsubscribed
 */
const isUnsubscribed = async (phoneNumber) => {
    try {
        const { data, error } = await supabase
            .from('unsubscribed_users')
            .select('phone_number')
            .eq('phone_number', phoneNumber)
            .single();
            
        if (error && error.code !== 'PGRST116') {
            BroadcastLogger.warn('Unsubscribe check failed, assuming subscribed', { 
                phoneNumber, 
                error: error.message 
            });
            return false;
        }
        
        return !!data;
    } catch (error) {
        BroadcastLogger.warn('Unsubscribe check error, assuming subscribed', { 
            phoneNumber, 
            error: error.message 
        });
        return false;
    }
};

/**
 * Simple lock acquisition using direct database operations
 */
const acquireProcessingLock = async (processId) => {
    try {
        // First, check current lock status
        const { data: lockData, error: lockError } = await supabase
            .from('broadcast_processing_lock')
            .select('*')
            .eq('id', 1)
            .single();
            
        if (lockError) {
            BroadcastLogger.warn('Lock table not found, assuming no lock', { processId });
            return true;
        }
        
        const now = new Date();
        const isStale = lockData.last_heartbeat && 
                       (now.getTime() - new Date(lockData.last_heartbeat).getTime()) > LOCK_TIMEOUT;
        
        // If not processing or lock is stale, try to acquire
        if (!lockData.is_processing || isStale) {
            const { error: updateError } = await supabase
                .from('broadcast_processing_lock')
                .update({
                    is_processing: true,
                    process_id: processId,
                    started_at: now.toISOString(),
                    last_heartbeat: now.toISOString()
                })
                .eq('id', 1);
                
            if (updateError) {
                BroadcastLogger.warn('Failed to acquire lock', { processId, error: updateError.message });
                return false;
            }
            
            BroadcastLogger.info('Lock acquired successfully', { processId });
            return true;
        }
        
        BroadcastLogger.info('Lock is already held by another process', { 
            processId, 
            currentOwner: lockData.process_id,
            since: lockData.started_at
        });
        return false;
        
    } catch (error) {
        BroadcastLogger.warn('Lock acquisition failed, proceeding anyway', { processId, error: error.message });
        return true;
    }
};

/**
 * Release processing lock
 */
const releaseProcessingLock = async (processId) => {
    try {
        const { error } = await supabase
            .from('broadcast_processing_lock')
            .update({
                is_processing: false,
                process_id: null,
                started_at: null,
                last_heartbeat: null
            })
            .eq('id', 1)
            .eq('process_id', processId);
            
        if (error) {
            BroadcastLogger.warn('Failed to release lock', { processId, error: error.message });
        } else {
            BroadcastLogger.info('Lock released successfully', { processId });
        }
    } catch (error) {
        BroadcastLogger.warn('Lock release failed', { processId, error: error.message });
    }
};

/**
 * Check batch cooldown period
 */
const checkBatchCooldown = async () => {
    try {
        const { data: lastBatch, error } = await supabase
            .from('broadcast_batch_log')
            .select('completed_at')
            .not('completed_at', 'is', null)
            .order('completed_at', { ascending: false })
            .limit(1);
            
        if (error) {
            BroadcastLogger.warn('Batch log table not found, allowing processing', { error: error.message });
            return { canProcess: true, reason: 'no_table' };
        }
        
        if (!lastBatch || lastBatch.length === 0) {
            return { canProcess: true, reason: 'no_previous_batch' };
        }
        
        const lastBatchTime = new Date(lastBatch[0].completed_at);
        const timeSinceLastBatch = Date.now() - lastBatchTime.getTime();
        
        if (timeSinceLastBatch >= BATCH_COOLDOWN) {
            return { 
                canProcess: true, 
                reason: 'cooldown_expired',
                timeSinceLastBatch: Math.round(timeSinceLastBatch / 1000)
            };
        }
        
        const remainingMs = BATCH_COOLDOWN - timeSinceLastBatch;
        return { 
            canProcess: false, 
            reason: 'cooldown_active',
            remainingMs,
            remainingMinutes: Math.ceil(remainingMs / 60000),
            lastBatchTime: lastBatchTime.toISOString()
        };
        
    } catch (error) {
        BroadcastLogger.warn('Cooldown check failed, allowing processing', { error: error.message });
        return { canProcess: true, reason: 'check_failed' };
    }
};

/**
 * Enhanced queue processing with proper rate limiting
 */
const processBroadcastQueue = async () => {
    const processId = crypto.randomUUID().slice(0, 8);
    const startTime = Date.now();
    
    BroadcastLogger.info('Attempting to start queue processing', { 
        processId,
        batchSize: BATCH_SIZE,
        cooldownMinutes: BATCH_COOLDOWN / 60000
    });
    
    try {
        // Step 1: Try to acquire global processing lock
        const lockAcquired = await acquireProcessingLock(processId);
        if (!lockAcquired) {
            BroadcastLogger.info('Another process is already handling broadcasts', { processId });
            return { processed: 0, succeeded: 0, failed: 0, skipped: 'locked' };
        }
        
        // Step 2: Check batch cooldown
        const cooldownCheck = await checkBatchCooldown();
        if (!cooldownCheck.canProcess) {
            BroadcastLogger.info('Batch cooldown active, waiting for next window', {
                processId,
                remainingMinutes: cooldownCheck.remainingMinutes,
                lastBatchTime: cooldownCheck.lastBatchTime
            });
            
            await releaseProcessingLock(processId);
            return { 
                processed: 0, 
                succeeded: 0, 
                failed: 0, 
                skipped: 'cooldown',
                nextBatchIn: cooldownCheck.remainingMinutes + ' minutes'
            };
        }
        
        BroadcastLogger.info('Cooldown check passed, starting batch processing', { 
            processId, 
            reason: cooldownCheck.reason
        });
        
        // Step 3: Get pending messages
        const { data: pending, error } = await supabase
            .from('bulk_schedules')
            .select('*')
            .eq('status', 'pending')
            .lte('scheduled_at', new Date().toISOString())  // ✅ Correct
            .lt('retry_count', MAX_RETRIES)
            .order('scheduled_at')  // ✅ Correct
            .order('sequence_number')
            .limit(BATCH_SIZE);
            
        if (error) {
            BroadcastLogger.error('Failed to fetch pending messages', error, { processId });
            await releaseProcessingLock(processId);
            throw error;
        }
        
        if (!pending || pending.length === 0) {
            BroadcastLogger.info('No pending messages to process', { processId });
            await releaseProcessingLock(processId);
            return { processed: 0, succeeded: 0, failed: 0 };
        }
        
        // Step 4: Record batch start
        const { data: batchLog, error: batchError } = await supabase
            .from('broadcast_batch_log')
            .insert({
                process_id: processId,
                started_at: new Date().toISOString(),
                status: 'processing',
                batch_size: pending.length
            })
            .select('id')
            .single();
            
        const batchLogId = batchLog?.id || null;
        if (batchError) {
            BroadcastLogger.warn('Failed to record batch start', { processId, error: batchError.message });
        }
        
        BroadcastLogger.info('STARTING BATCH WITH ENFORCED 5-MINUTE COOLDOWN', {
            processId,
            count: pending.length,
            campaigns: [...new Set(pending.map(m => m.campaign_name))],
            batchLogId,
            estimatedDuration: Math.round((pending.length * (BASE_MESSAGE_DELAY + MAX_RANDOM_DELAY/2)) / 1000) + ' seconds',
            nextBatchAllowedAt: new Date(Date.now() + BATCH_COOLDOWN).toISOString()
        });
        
        let succeeded = 0;
        let failed = 0;
        
        // Step 5: Process messages with proper delays
        for (let i = 0; i < pending.length; i++) {
            const message = pending[i];
            const messageStartTime = Date.now();
            
            try {
                // Mark as processing
                await supabase
                    .from('bulk_schedules')
                    .update({ 
                        status: 'processing',
                        processed_at: new Date().toISOString(),
                        updated_at: new Date().toISOString()
                    })
                    .eq('id', message.id);
                
                const phoneNumber = message.to_phone_number;
                if (!phoneNumber) {
                    throw new Error('Phone number missing from record');
                }
                
                // Check unsubscribe status
                if (await isUnsubscribed(phoneNumber)) {
                    await supabase
                        .from('bulk_schedules')
                        .update({ 
                            status: 'skipped',
                            error_message: 'User unsubscribed',
                            updated_at: new Date().toISOString()
                        })
                        .eq('id', message.id);
                    
                    BroadcastLogger.info('Message skipped - user unsubscribed', {
                        processId,
                        messageId: message.id,
                        messageNumber: i + 1,
                        totalMessages: pending.length
                    });
                    continue;
                }
                
                const messageText = message.message_body || message.message_text;
                const mediaUrl = message.media_url || message.image_url;
                
                if (!messageText) {
                    throw new Error('Message text missing from record');
                }
                
                // Humanize and personalize message
                const humanized = await humanizeMessage(
                    messageText,
                    phoneNumber,
                    message.tenant_id
                );
                
                // Apply random human-like delay (1-4 seconds)
                await new Promise(resolve => setTimeout(resolve, humanized.delay));
                
                // Send message
                BroadcastLogger.info(`Sending message ${i + 1}/${pending.length}`, {
                    processId,
                    messageId: message.id,
                    campaign: message.campaign_name,
                    hasMedia: !!mediaUrl,
                    humanized: true,
                    greeting: humanized.greeting,
                    randomDelay: humanized.delay
                });
                
                // Use smart sender with tenant ID
                const sendResult = await sendMessageSmart(
                    message.tenant_id, 
                    phoneNumber, 
                    humanized.message, 
                    mediaUrl
                );
                
                BroadcastLogger.info('Message sent via ' + sendResult.method, {
                    processId,
                    messageId: message.id,
                    method: sendResult.method
                });
                
                // Mark as sent in bulk_schedules
                await supabase
                    .from('bulk_schedules')
                    .update({ 
                        status: 'sent',
                        delivered_at: new Date().toISOString(),
                        updated_at: new Date().toISOString(),
                        delivery_status: 'delivered'
                    })
                    .eq('id', message.id);
                
                // Update recipient status in broadcast_recipients
                await supabase
                    .from('broadcast_recipients')
                    .update({
                        status: 'sent',
                        sent_at: new Date().toISOString()
                    })
                    .eq('campaign_id', message.campaign_id)
                    .eq('phone', phoneNumber);
                
                // Increment daily message count
                await supabase.rpc('increment_daily_message_count', { 
                    p_tenant_id: message.tenant_id 
                });
                
                succeeded++;
                
                BroadcastLogger.info('Message sent successfully', {
                    processId,
                    messageId: message.id,
                    campaign: message.campaign_name,
                    duration: Date.now() - messageStartTime,
                    messageNumber: i + 1,
                    totalMessages: pending.length
                });
                
            } catch (error) {
                failed++;
                const newRetryCount = (message.retry_count || 0) + 1;
                
                const updateData = {
                    retry_count: newRetryCount,
                    error_message: error.message,
                    updated_at: new Date().toISOString()
                };
                
                if (newRetryCount >= MAX_RETRIES) {
                    updateData.status = 'failed';
                    updateData.delivery_status = 'failed';
                    
                    // Mark recipient as failed in broadcast_recipients
                    await supabase
                        .from('broadcast_recipients')
                        .update({
                            status: 'failed',
                            error_message: error.message
                        })
                        .eq('campaign_id', message.campaign_id)
                        .eq('phone', message.to_phone_number);
                } else {
                    updateData.status = 'pending';
                    // Schedule retry after next batch cooldown
                    const nextRetryAt = new Date(Date.now() + BATCH_COOLDOWN + (30000 * Math.pow(2, newRetryCount - 1)));
                    updateData.scheduled_at = nextRetryAt.toISOString();
                }
                
                await supabase
                    .from('bulk_schedules')
                    .update(updateData)
                    .eq('id', message.id);
                
                BroadcastLogger.error('Message sending failed', error, {
                    processId,
                    messageId: message.id,
                    retryCount: newRetryCount,
                    willRetry: newRetryCount < MAX_RETRIES,
                    messageNumber: i + 1
                });
            }
            
            // Apply random human-like delay between messages (except after the last message)
            if (i < pending.length - 1) {
                const messageDelay = getHumanDelay();
                BroadcastLogger.debug(`Waiting ${Math.round(messageDelay/1000)} seconds before next message`, {
                    processId,
                    currentMessage: i + 1,
                    remainingMessages: pending.length - i - 1,
                    randomDelay: messageDelay
                });
                await new Promise(resolve => setTimeout(resolve, messageDelay));
            }
        }        
        // Step 6: Record batch completion and enforce cooldown
        if (batchLogId) {
            await supabase
                .from('broadcast_batch_log')
                .update({
                    completed_at: new Date().toISOString(),
                    status: 'completed',
                    messages_sent: succeeded,
                    messages_failed: failed
                })
                .eq('id', batchLogId);
        }
        
        await releaseProcessingLock(processId);
        
        const totalDuration = Date.now() - startTime;
        const nextBatchTime = new Date(Date.now() + BATCH_COOLDOWN);
        
        BroadcastLogger.info('BATCH COMPLETED - 5-MINUTE COOLDOWN NOW ENFORCED', {
            processId,
            duration: totalDuration,
            processed: pending.length,
            succeeded,
            failed,
            nextBatchAllowedAt: nextBatchTime.toISOString(),
            cooldownDurationMinutes: BATCH_COOLDOWN / 60000
        });
        
        // Check remaining messages
        const { data: remainingMessages } = await supabase
            .from('bulk_schedules')
            .select('count(*)')
            .eq('status', 'pending')
            .lte('scheduled_at', new Date().toISOString())
            .lt('retry_count', MAX_RETRIES);
            
        if (remainingMessages && remainingMessages[0]?.count > 0) {
            BroadcastLogger.info(`${remainingMessages[0].count} messages waiting for next batch window`, {
                processId,
                nextProcessingTime: nextBatchTime.toISOString(),
                remainingMessages: remainingMessages[0].count
            });
        }
        
        return { 
            processed: pending.length, 
            succeeded, 
            failed,
            nextBatchAt: nextBatchTime.toISOString(),
            cooldownEnforced: true
        };
        
    } catch (error) {
        const duration = Date.now() - startTime;
        BroadcastLogger.error('Queue processing failed', error, { processId, duration });
        await releaseProcessingLock(processId);
        throw error;
    }
};

/**
 * Schedule multi-day broadcast campaign
 */
const scheduleMultiDayBroadcast = async (tenantId, campaignName, message, startAt, phoneNumbers, imageUrl, dailyLimit, currentCount) => {
    const operationId = crypto.randomUUID().slice(0, 8);
    const parentCampaignId = crypto.randomUUID();
    
    BroadcastLogger.info('Scheduling multi-day broadcast', {
        operationId,
        tenantId,
        totalRecipients: phoneNumbers.length,
        dailyLimit,
        currentCount
    });
    
    try {
        // Validate and normalize phone numbers
        const validatedNumbers = phoneNumbers
            .map(normalizePhoneNumber)
            .filter(phone => phone !== null);
        
        if (validatedNumbers.length === 0) {
            return 'No valid phone numbers found. Please check the format and try again.';
        }
        
        // Filter out unsubscribed users
        const validRecipients = [];
        for (const phone of validatedNumbers) {
            if (!(await isUnsubscribed(phone))) {
                validRecipients.push(phone);
            }
        }
        
        if (validRecipients.length === 0) {
            return 'All recipients have unsubscribed or have invalid phone numbers. No messages were scheduled.';
        }
        
        // Calculate how many days needed
        const remainingToday = Math.max(0, dailyLimit - currentCount);
        const recipientsAfterToday = validRecipients.length - remainingToday;
        const additionalDays = Math.ceil(recipientsAfterToday / dailyLimit);
        const totalDays = (remainingToday > 0 ? 1 : 0) + additionalDays;
        
        BroadcastLogger.info('Multi-day schedule calculated', {
            operationId,
            totalRecipients: validRecipients.length,
            remainingToday,
            totalDays,
            dailyLimit
        });
        
        // Split recipients into daily batches
        const dailyBatches = [];
        let offset = 0;
        
        // Day 1 - use remaining capacity
        if (remainingToday > 0) {
            dailyBatches.push({
                recipients: validRecipients.slice(0, remainingToday),
                sendAt: new Date(startAt),
                dayNumber: 1
            });
            offset = remainingToday;
        }
        
        // Subsequent days - full daily limit
        let dayNumber = remainingToday > 0 ? 2 : 1;
        while (offset < validRecipients.length) {
            const batch = validRecipients.slice(offset, offset + dailyLimit);
            const sendDate = new Date(startAt);
            sendDate.setDate(sendDate.getDate() + (remainingToday > 0 ? dayNumber - 1 : dayNumber));
            sendDate.setHours(9, 0, 0, 0); // 9 AM each day
            
            dailyBatches.push({
                recipients: batch,
                sendAt: sendDate,
                dayNumber
            });
            
            offset += dailyLimit;
            dayNumber++;
        }
        
        // Insert all daily campaigns
        const INSERT_BATCH_SIZE = 500;
        const campaignIds = [];
        
        for (let i = 0; i < dailyBatches.length; i++) {
            const batch = dailyBatches[i];
            const campaignId = crypto.randomUUID();
            campaignIds.push(campaignId);
            
            const dayLabel = batch.dayNumber === 1 ? '' : ` (Day ${batch.dayNumber}/${totalDays})`;
            const campaignData = {
                id: campaignId,
                tenant_id: tenantId,
                campaign_name: `${campaignName}${dayLabel}`,
                message_text: message,
                message_type: imageUrl ? 'image' : 'text',
                image_url: imageUrl,
                recipient_count: batch.recipients.length,
                scheduled_at: batch.sendAt.toISOString(),
                status: 'scheduled',
                parent_campaign_id: parentCampaignId,
                day_number: batch.dayNumber,
                total_days: totalDays,
                auto_scheduled: true
            };
            
            const { error: campaignError } = await supabase
                .from('bulk_schedules')
                .insert(campaignData);
            
            if (campaignError) {
                BroadcastLogger.error('Failed to create daily campaign', campaignError, {
                    operationId,
                    dayNumber: batch.dayNumber
                });
                throw new Error(`Failed to schedule day ${batch.dayNumber}: ${campaignError.message}`);
            }
            
            // Insert recipients for this day
            const recipients = batch.recipients.map(phone => ({
                campaign_id: campaignId,
                phone: phone,
                status: 'pending'
            }));
            
            for (let j = 0; j < recipients.length; j += INSERT_BATCH_SIZE) {
                const recipientBatch = recipients.slice(j, j + INSERT_BATCH_SIZE);
                const { error: recipientError } = await supabase
                    .from('broadcast_recipients')
                    .insert(recipientBatch);
                
                if (recipientError) {
                    BroadcastLogger.warn('Failed to insert recipient tracking', recipientError, {
                        operationId,
                        dayNumber: batch.dayNumber
                    });
                }
            }
            
            BroadcastLogger.info('Daily campaign scheduled', {
                operationId,
                campaignId: campaignId.slice(0, 8),
                dayNumber: batch.dayNumber,
                recipients: batch.recipients.length,
                scheduledFor: batch.sendAt.toISOString()
            });
        }
        
        // Generate summary message
        const schedule = dailyBatches.map((batch, index) => {
            const date = batch.sendAt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
            const time = batch.sendAt.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
            return `  📅 Day ${batch.dayNumber}: ${batch.recipients.length} contacts on ${date} at ${time}`;
        }).join('\n');
        
        return `✅ Multi-Day Broadcast Scheduled Successfully!\n\n` +
               `📊 Campaign: ${campaignName}\n` +
               `👥 Total Recipients: ${validRecipients.length}\n` +
               `📈 Daily Limit: ${dailyLimit} messages/day\n` +
               `📆 Schedule: ${totalDays} days\n\n` +
               `${schedule}\n\n` +
               `ℹ️ The system will automatically send each batch on its scheduled day. You don't need to do anything else!`;
        
    } catch (error) {
        BroadcastLogger.error('Multi-day scheduling failed', error, { operationId });
        throw error;
    }
};

/**
 * Enhanced broadcast scheduling with multi-day support
 */
const scheduleBroadcast = async (tenantId, campaignName, message, sendAt, phoneNumbers, imageUrl = null) => {
    const startTime = Date.now();
    const operationId = crypto.randomUUID().slice(0, 8);
    
    BroadcastLogger.info('Starting broadcast scheduling', {
        operationId,
        tenantId,
        campaignName,
        phoneCount: phoneNumbers.length,
        hasImage: !!imageUrl,
        scheduledFor: sendAt
    });
    
    try {
        // Input validation
        if (!tenantId || !campaignName || !message || !sendAt) {
            throw new Error('Missing required parameters');
        }
        
        if (!Array.isArray(phoneNumbers) || phoneNumbers.length === 0) {
            return 'No phone numbers provided to schedule this broadcast.';
        }
        
        if (phoneNumbers.length > 10000) {
            return 'Cannot schedule broadcast to more than 10,000 contacts at once. Please split into smaller batches.';
        }
        
        // Get tenant's daily limit
        const { data: tenantData, error: tenantError } = await supabase
            .from('tenants')
            .select('daily_message_limit')
            .eq('id', tenantId)
            .single();
        
        if (tenantError) {
            BroadcastLogger.error('Failed to fetch tenant limit', tenantError, { tenantId });
            throw new Error('Failed to fetch tenant settings');
        }
        
        const dailyLimit = tenantData?.daily_message_limit || 1000;
        
        // Check today's usage
        const { data: todayStats, error: statsError } = await supabase
            .rpc('get_daily_message_count', { p_tenant_id: tenantId });
        
        const currentCount = todayStats || 0;
        const remainingToday = dailyLimit - currentCount;
        
        // Multi-day scheduling logic
        if (phoneNumbers.length > remainingToday && remainingToday > 0) {
            // Split into multiple days
            return await scheduleMultiDayBroadcast(
                tenantId, 
                campaignName, 
                message, 
                sendAt, 
                phoneNumbers, 
                imageUrl, 
                dailyLimit, 
                currentCount
            );
        } else if (remainingToday <= 0) {
            // No capacity today - schedule for tomorrow
            const tomorrow = new Date(sendAt);
            tomorrow.setDate(tomorrow.getDate() + 1);
            tomorrow.setHours(9, 0, 0, 0); // 9 AM tomorrow
            
            return await scheduleMultiDayBroadcast(
                tenantId,
                campaignName,
                message,
                tomorrow.toISOString(),
                phoneNumbers,
                imageUrl,
                dailyLimit,
                0 // Start fresh tomorrow
            );
        }
        
        // Can send today within limit
        // Warn if approaching limit
        if ((currentCount + phoneNumbers.length) > dailyLimit * 0.8) {
            BroadcastLogger.warn('Approaching daily limit', {
                operationId,
                tenantId,
                currentCount,
                newTotal: currentCount + phoneNumbers.length,
                limit: dailyLimit,
                percentUsed: Math.round(((currentCount + phoneNumbers.length) / dailyLimit) * 100)
            });
        }
        
        // Validate and normalize phone numbers
        const validatedNumbers = phoneNumbers
            .map(normalizePhoneNumber)
            .filter(phone => phone !== null);
            
        if (validatedNumbers.length === 0) {
            return 'No valid phone numbers found. Please check the format and try again.';
        }
        
        // Filter out unsubscribed users
        const validRecipients = [];
        for (const phone of validatedNumbers) {
            if (!(await isUnsubscribed(phone))) {
                validRecipients.push(phone);
            }
        }
        
        if (validRecipients.length === 0) {
            return 'All recipients have unsubscribed or have invalid phone numbers. No messages were scheduled.';
        }
        
        BroadcastLogger.info('Recipients filtered', {
            operationId,
            total: phoneNumbers.length,
            valid: validRecipients.length,
            filtered: phoneNumbers.length - validRecipients.length
        });
        
        // Create broadcast records
        const campaignId = crypto.randomUUID();
        const currentTime = new Date().toISOString();
        
        const schedules = validRecipients.map((phone, index) => ({
            tenant_id: tenantId,
            to_phone_number: phone,
            message_text: message.slice(0, 4096),
            message_body: message.slice(0, 4096),
            image_url: imageUrl,
            media_url: imageUrl,
            scheduled_at: sendAt,
            campaign_id: campaignId,
            campaign_name: campaignName.slice(0, 255),
            status: 'pending',
            created_at: currentTime,
            updated_at: currentTime,
            retry_count: 0,
            sequence_number: index + 1,
            delivery_status: 'pending'
        }));
        
        // Insert in batches
        const INSERT_BATCH_SIZE = 1000;
        let insertedCount = 0;
        
        for (let i = 0; i < schedules.length; i += INSERT_BATCH_SIZE) {
            const batch = schedules.slice(i, i + INSERT_BATCH_SIZE);
            const { error } = await supabase.from('bulk_schedules').insert(batch);
            
            if (error) {
                BroadcastLogger.error('Database insert failed', error, {
                    operationId,
                    batchStart: i,
                    batchSize: batch.length
                });
                throw new Error(`Database insertion failed: ${error.message}`);
            }
            
            insertedCount += batch.length;
        }
        
        // Insert recipients into broadcast_recipients table for per-contact tracking
        const recipients = validRecipients.map(phone => ({
            campaign_id: campaignId,
            phone: phone,
            status: 'pending'
        }));
        
        for (let i = 0; i < recipients.length; i += INSERT_BATCH_SIZE) {
            const batch = recipients.slice(i, i + INSERT_BATCH_SIZE);
            const { error: recipientError } = await supabase
                .from('broadcast_recipients')
                .insert(batch);
            
            if (recipientError) {
                BroadcastLogger.warn('Failed to insert recipient tracking', recipientError, {
                    operationId,
                    batchStart: i
                });
                // Don't fail the whole operation if recipient tracking fails
            }
            
            insertedCount += batch.length;
        }
        
        const duration = Date.now() - startTime;
        const formattedDate = new Date(sendAt).toLocaleString();
        
        BroadcastLogger.info('Broadcast scheduled successfully', {
            operationId,
            campaignId,
            duration,
            recipientCount: validRecipients.length,
            scheduledFor: formattedDate
        });
        
        return `Successfully scheduled the "${campaignName}" broadcast for ${formattedDate} to ${validRecipients.length} contacts. Campaign ID: ${campaignId.slice(0, 8)}`;
        
    } catch (error) {
        const duration = Date.now() - startTime;
        BroadcastLogger.error('Broadcast scheduling failed', error, {
            operationId,
            tenantId,
            campaignName,
            duration
        });
        
        return `An error occurred while scheduling the broadcast: ${error.message}. Please try again or contact support.`;
    }
};

/**
 * Generate AI content for broadcasts
 */
const generateBroadcastContent = async (topic) => {
    try {
        const model = process.env.AI_MODEL_SMART || 'gpt-4o';
        
        const response = await openai.chat.completions.create({
            model,
            messages: [{
                role: "system",
                content: "You are a marketing copywriter. Write a short, engaging, and friendly WhatsApp broadcast message based on the following topic. Include a clear call to action. Keep it under 160 characters for better engagement. Do not include placeholders like '[Your Business Name]'."
            }, {
                role: "user",
                content: topic
            }],
            temperature: 0.7,
            max_tokens: 150
        });
        
        const content = response.choices[0].message.content.trim();
        BroadcastLogger.info('Content generated successfully', { 
            topic, 
            contentLength: content.length 
        });
        
        return content;
    } catch (error) {
        BroadcastLogger.error('Failed to generate broadcast content', error, { topic });
        return 'There was an error generating content. Please try again or create your own message.';
    }
};

/**
 * Schedule broadcast to segment
 */
const scheduleBroadcastToSegment = async (tenantId, segmentName, campaignName, message, timeString, imageUrl = null) => {
    try {
        const { data: segment, error: segError } = await supabase
            .from('customer_segments')
            .select('id')
            .eq('tenant_id', tenantId)
            .eq('segment_name', segmentName)
            .single();
            
        if (segError || !segment) {
            return `Could not find a customer segment named "${segmentName}".`;
        }
        
        const { data: conversations, error: convError } = await supabase
            .from('conversation_segments')
            .select('conversation:conversations (end_user_phone)')
            .eq('segment_id', segment.id);
            
        if (convError) throw convError;
        
        const phoneNumbers = conversations
            .map(c => c.conversation?.end_user_phone)
            .filter(Boolean);
            
        if (phoneNumbers.length === 0) {
            return `The segment "${segmentName}" is currently empty. No messages were scheduled.`;
        }
        
        const sendAt = chrono.parseDate(timeString, new Date(), { forwardDate: true });
        if (!sendAt) {
            return "I couldn't understand that time. Please try again (e.g., 'tomorrow at 10am').";
        }
        
        return await scheduleBroadcast(tenantId, campaignName, message, sendAt.toISOString(), phoneNumbers, imageUrl);
        
    } catch (error) {
        BroadcastLogger.error('Segment broadcast failed', error);
        return 'An error occurred while scheduling the broadcast to the segment.';
    }
};

module.exports = {
    generateBroadcastContent,
    scheduleBroadcast,
    scheduleBroadcastToSegment,
    parseContactSheet,
    processBroadcastQueue,
    BroadcastLogger
};