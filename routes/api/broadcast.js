const express = require('express');
const router = express.Router();
const { supabase } = require('../../services/config');
const { sendMessage, sendMessageWithImage } = require('../../services/whatsappService');
const { sendViaDesktopAgent, isDesktopAgentOnline } = require('../../services/desktopAgentBridge');
const { sendBroadcastViaWaha } = require('../../index');

/**
 * POST /api/broadcast/send
 * Send or schedule a broadcast message to multiple recipients
 * 
 * PRIORITY: User Preference (Waha/Desktop) → Desktop Agent (FREE) → Maytapi (PAID FALLBACK)
 */
router.post('/send', async (req, res) => {
    try {
        const { 
            tenantId, 
            campaignName, 
            message, 
            recipients, 
            messageType, 
            scheduleType, 
            scheduleTime,
            imageBase64,
            batchSize = 10,
            messageDelay = 500,
            batchDelay = 2000,
            forceMethod, // 'desktop_agent', 'waha', or 'maytapi' - for testing
            botDeliveryMethod // From frontend: 'desktop' or 'cloud' (Waha)
        } = req.body;

        console.log('[BROADCAST_API] Request:', { 
            tenantId, 
            campaignName, 
            recipientCount: recipients?.length, 
            messageType, 
            scheduleType,
            batchSize,
            messageDelay,
            batchDelay,
            forceMethod,
            botDeliveryMethod
        });

        // Validate required fields
        if (!tenantId || !campaignName || !message || !recipients || recipients.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'Missing required fields: tenantId, campaignName, message, recipients'
            });
        }

        // Get tenant info
        const { data: tenant, error: tenantError } = await supabase
            .from('tenants')
            .select('id, business_name, phone_number')
            .eq('id', tenantId)
            .single();

        if (tenantError || !tenant) {
            console.error('[BROADCAST_API] Tenant not found:', tenantError);
            return res.status(404).json({
                success: false,
                error: 'Tenant not found',
                details: tenantError?.message
            });
        }

        // Priority 0: Check user preference for cloud bot (Waha 24/7)
        if (botDeliveryMethod === 'cloud' && forceMethod !== 'desktop_agent' && forceMethod !== 'maytapi') {
            console.log('[BROADCAST_API] ☁️ User selected Cloud Bot (Waha 24/7) - Using Waha!');
            
            try {
                const result = await sendBroadcastViaWaha(
                    'default', // Session name
                    recipients,
                    message,
                    imageBase64,
                    { batchSize, messageDelay, batchDelay }
                );
                
                if (result.success) {
                    return res.json({
                        success: true,
                        message: `Broadcast sent via Waha Cloud Bot (24/7)! ${result.totalSent} sent, ${result.totalFailed} failed.`,
                        method: 'waha',
                        details: {
                            total: recipients.length,
                            sent: result.totalSent,
                            failed: result.totalFailed,
                            successRate: result.summary?.successRate,
                            status: 'completed'
                        }
                    });
                }
            } catch (wahaError) {
                console.log('[BROADCAST_API] ⚠️ Waha failed:', wahaError.message);
                // Fall through to desktop agent or Maytapi
            }
        }

        // Priority 1: Try Desktop Agent (FREE!)
        if (forceMethod !== 'maytapi' && forceMethod !== 'waha') {
            console.log('[BROADCAST_API] 🔍 Checking desktop agent availability...');
            
            const agentOnline = await isDesktopAgentOnline(tenantId);
            
            if (agentOnline) {
                console.log('[BROADCAST_API] ✅ Desktop Agent ONLINE - Using FREE local WhatsApp!');
                
                const broadcastData = {
                    recipients,
                    message,
                    messageType: messageType || 'text',
                    imageBase64,
                    batchSize,
                    messageDelay,
                    batchDelay
                };
                
                const result = await sendViaDesktopAgent(tenantId, broadcastData);
                
                if (result.success) {
                    // Save broadcast record to database for history
                    const campaignId = `campaign_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
                    
                    console.log('[BROADCAST_API] Saving broadcast to database for history...');
                    
                    // Save each recipient to bulk_schedules table
                    const scheduleRecords = recipients.map(phoneNumber => ({
                        tenant_id: tenantId,
                        phone_number: phoneNumber,
                        campaign_id: campaignId,
                        campaign_name: campaignName,
                        message_text: message,
                        image_url: imageBase64 ? 'data:image/png;base64,...' : null,
                        scheduled_at: new Date().toISOString(),
                        status: 'sent',
                        created_at: new Date().toISOString()
                    }));
                    
                    const { error: insertError } = await supabase
                        .from('bulk_schedules')
                        .insert(scheduleRecords);
                    
                    if (insertError) {
                        console.error('[BROADCAST_API] Warning: Failed to save broadcast history:', insertError);
                    } else {
                        console.log('[BROADCAST_API] ✅ Broadcast history saved successfully');
                    }
                    
                    return res.json({
                        success: true,
                        message: `Broadcast sent via Desktop Agent (FREE)! ${result.totalSent} sent, ${result.totalFailed} failed.`,
                        method: 'desktop_agent',
                        details: {
                            total: recipients.length,
                            sent: result.totalSent,
                            failed: result.totalFailed,
                            successRate: result.summary?.successRate,
                            status: 'completed'
                        }
                    });
                } else {
                    console.log('[BROADCAST_API] ⚠️ Desktop Agent failed, falling back to Maytapi...');
                }
            } else {
                console.log('[BROADCAST_API] ⚠️ Desktop Agent OFFLINE - Falling back to Maytapi (PAID)');
            }
        }

        // Priority 2: Fallback to Maytapi (PAID)
        console.log('[BROADCAST_API] 💰 Using Maytapi (PAID service)');
        
        const phoneNumberId = tenant.phone_number;

        if (scheduleType === 'now') {
            // Use the broadcastService to schedule the messages
            const { scheduleBroadcast } = require('../../services/broadcastService');
            
            console.log('[BROADCAST_API] Scheduling broadcast via broadcastService (Maytapi)');
            
            try {
                const result = await scheduleBroadcast(
                    tenantId,
                    campaignName,
                    message,
                    new Date().toISOString(), // Send now
                    recipients,
                    imageBase64 // Image URL/base64
                );
                
                // scheduleBroadcast returns a string message
                console.log('[BROADCAST_API] Broadcast scheduled:', result);
                
                // Check if it's an error message
                if (result.includes('error') || result.includes('failed') || result.includes('No valid')) {
                    return res.status(400).json({
                        success: false,
                        error: result
                    });
                }
                
                return res.json({
                    success: true,
                    message: `Broadcast queued via Maytapi! Processing ${recipients.length} recipients in background.`,
                    method: 'maytapi',
                    details: {
                        total: recipients.length,
                        status: 'queued',
                        result: result
                    }
                });
            } catch (err) {
                console.error('[BROADCAST_API] Failed to schedule broadcast:', err);
                return res.status(500).json({
                    success: false,
                    error: 'Failed to queue broadcast: ' + err.message
                });
            }
        } else {
            // Schedule for later (existing code)
            const scheduledTime = new Date(scheduleTime);


            
            if (isNaN(scheduledTime.getTime())) {
                return res.status(400).json({
                    success: false,
                    error: 'Invalid schedule time format'
                });
            }

            // Store in broadcast_queue table for processing by scheduler
            const { error: insertError } = await supabase
                .from('broadcast_queue')
                .insert({
                    tenant_id: tenantId,
                    campaign_name: campaignName,
                    message_type: messageType,
                    message_content: message,
                    image_url: messageType === 'image' && imageBase64 ? imageBase64 : null,
                    recipients: recipients,
                    scheduled_at: scheduledTime.toISOString(),
                    status: 'scheduled',
                    created_at: new Date().toISOString()
                });

            if (insertError) {
                console.error('[BROADCAST_API] Failed to schedule broadcast:', insertError);
                return res.status(500).json({
                    success: false,
                    error: 'Failed to schedule broadcast'
                });
            }

            console.log('[BROADCAST_API] Broadcast scheduled:', { campaignName, scheduledTime });

            return res.json({
                success: true,
                message: `Broadcast scheduled for ${scheduledTime.toLocaleString()}`,
                details: {
                    campaignName,
                    scheduledTime: scheduledTime.toISOString(),
                    recipientCount: recipients.length
                }
            });
        }

    } catch (error) {
        console.error('[BROADCAST_API] Error:', error);
        return res.status(500).json({
            success: false,
            error: 'Internal server error',
            details: error.message
        });
    }
});

/**
 * GET /api/broadcast/history/:tenantId
 * Get broadcast history for a tenant with optional filtering
 * Query params: search (campaign name), status, dateFrom, dateTo
 */
router.get('/history/:tenantId', async (req, res) => {
    try {
        const { tenantId } = req.params;
        const { search, status, dateFrom, dateTo } = req.query;

        // Build query with filters
        let query = supabase
            .from('bulk_schedules')
            .select('campaign_id, campaign_name, message_text, image_url, scheduled_at, status, created_at')
            .eq('tenant_id', tenantId);

        // Apply campaign name search
        if (search) {
            query = query.ilike('campaign_name', `%${search}%`);
        }

        // Apply status filter
        if (status) {
            query = query.eq('status', status);
        }

        // Apply date range filter
        if (dateFrom) {
            query = query.gte('created_at', dateFrom);
        }
        if (dateTo) {
            query = query.lte('created_at', dateTo);
        }

        const { data: campaigns, error } = await query.order('created_at', { ascending: false });

        if (error) {
            console.error('[BROADCAST_API] Error fetching history:', error);
            return res.status(500).json({
                success: false,
                error: 'Failed to fetch broadcast history'
            });
        }

        if (!campaigns || campaigns.length === 0) {
            return res.json({
                success: true,
                broadcasts: []
            });
        }

        // Group by campaign and aggregate stats
        const campaignMap = new Map();
        
        campaigns.forEach(item => {
            const key = item.campaign_id || `${item.campaign_name}_${item.created_at}`;
            
            if (!campaignMap.has(key)) {
                campaignMap.set(key, {
                    campaign_id: item.campaign_id,
                    campaign_name: item.campaign_name,
                    message_content: item.message_text,
                    image_url: item.image_url,
                    scheduled_at: item.scheduled_at,
                    created_at: item.created_at,
                    sent_at: item.created_at,
                    recipient_count: 0,
                    success_count: 0,
                    fail_count: 0,
                    status: 'pending'
                });
            }
            
            const campaign = campaignMap.get(key);
            campaign.recipient_count++;
            
            if (item.status === 'sent' || item.status === 'delivered') {
                campaign.success_count++;
            } else if (item.status === 'failed') {
                campaign.fail_count++;
            }
            
            // Determine overall status
            if (campaign.success_count + campaign.fail_count >= campaign.recipient_count) {
                campaign.status = 'completed';
            } else if (campaign.success_count > 0 || campaign.fail_count > 0) {
                campaign.status = 'processing';
            } else {
                campaign.status = 'pending';
            }
        });

        const broadcasts = Array.from(campaignMap.values())
            .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
            .slice(0, 20);

        return res.json({
            success: true,
            broadcasts
        });

    } catch (error) {
        console.error('[BROADCAST_API] Error:', error);
        return res.status(500).json({
            success: false,
            error: 'Internal server error'
        });
    }
});

/**
 * POST /api/broadcast/groups/save
 * Save a contact group for reuse
 */
router.post('/groups/save', async (req, res) => {
    try {
        const { tenantId, groupName, contacts } = req.body;

        if (!tenantId || !groupName || !contacts || contacts.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'Missing required fields: tenantId, groupName, contacts'
            });
        }

        // Check if group name already exists for this tenant
        const { data: existing } = await supabase
            .from('contact_groups')
            .select('id')
            .eq('tenant_id', tenantId)
            .eq('group_name', groupName)
            .single();

        if (existing) {
            return res.status(400).json({
                success: false,
                error: 'A group with this name already exists. Please choose a different name.'
            });
        }

        // Save the group
        const { data: group, error } = await supabase
            .from('contact_groups')
            .insert({
                tenant_id: tenantId,
                group_name: groupName,
                contacts: contacts,
                contact_count: contacts.length
            })
            .select()
            .single();

        if (error) throw error;

        res.json({
            success: true,
            group: group
        });
    } catch (error) {
        console.error('[BROADCAST_API] Error saving contact group:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to save contact group'
        });
    }
});

/**
 * GET /api/broadcast/groups/:tenantId
 * Get all contact groups for a tenant
 */
router.get('/groups/:tenantId', async (req, res) => {
    try {
        const { tenantId } = req.params;

        const { data: groups, error } = await supabase
            .from('contact_groups')
            .select('*')
            .eq('tenant_id', tenantId)
            .order('created_at', { ascending: false });

        if (error) throw error;

        res.json({
            success: true,
            groups: groups || []
        });
    } catch (error) {
        console.error('[BROADCAST_API] Error fetching contact groups:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to fetch contact groups'
        });
    }
});

/**
 * DELETE /api/broadcast/groups/:groupId
 * Delete a contact group
 */
router.delete('/groups/:groupId', async (req, res) => {
    try {
        const { groupId } = req.params;

        const { error } = await supabase
            .from('contact_groups')
            .delete()
            .eq('id', groupId);

        if (error) throw error;

        res.json({
            success: true,
            message: 'Group deleted successfully'
        });
    } catch (error) {
        console.error('[BROADCAST_API] Error deleting contact group:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to delete contact group'
        });
    }
});

/**
 * GET /api/broadcast/campaign-report/:campaignId
 * Get per-contact delivery report for a campaign
 */
router.get('/campaign-report/:campaignId', async (req, res) => {
    try {
        const { campaignId } = req.params;

        const { data: recipients, error } = await supabase
            .from('broadcast_recipients')
            .select('phone, status, sent_at, error_message')
            .eq('campaign_id', campaignId)
            .order('phone', { ascending: true });

        if (error) throw error;

        // Get campaign summary
        const { data: campaign, error: campaignError } = await supabase
            .from('bulk_schedules')
            .select('campaign_name, message_text, created_at')
            .eq('campaign_id', campaignId)
            .limit(1)
            .single();

        res.json({
            success: true,
            campaign: {
                id: campaignId,
                name: campaign?.campaign_name || 'Unknown',
                message: campaign?.message_text || '',
                created_at: campaign?.created_at
            },
            recipients: recipients || [],
            stats: {
                total: recipients?.length || 0,
                sent: recipients?.filter(r => r.status === 'sent').length || 0,
                failed: recipients?.filter(r => r.status === 'failed').length || 0,
                pending: recipients?.filter(r => r.status === 'pending').length || 0
            }
        });
    } catch (error) {
        console.error('[BROADCAST_API] Error fetching campaign report:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to fetch campaign report'
        });
    }
});

/**
 * GET /api/broadcast/campaign-report/:campaignId/export
 * Export campaign report as CSV
 */
router.get('/campaign-report/:campaignId/export', async (req, res) => {
    try {
        const { campaignId } = req.params;

        const { data: recipients, error } = await supabase
            .from('broadcast_recipients')
            .select('phone, status, sent_at, error_message')
            .eq('campaign_id', campaignId)
            .order('phone', { ascending: true });

        if (error) throw error;

        // Get campaign summary
        const { data: campaign } = await supabase
            .from('bulk_schedules')
            .select('campaign_name, message_text, created_at')
            .eq('campaign_id', campaignId)
            .limit(1)
            .single();

        // Generate CSV
        const csvHeader = 'Phone Number,Status,Sent At,Error Message\n';
        const csvRows = recipients.map(r => {
            const sentAt = r.sent_at ? new Date(r.sent_at).toLocaleString() : '';
            const errorMsg = (r.error_message || '').replace(/,/g, ';').replace(/\n/g, ' ');
            return `${r.phone},${r.status},${sentAt},"${errorMsg}"`;
        }).join('\n');

        const csv = csvHeader + csvRows;

        // Set headers for download
        const filename = `campaign-${campaign?.campaign_name || campaignId}-${Date.now()}.csv`;
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send(csv);
    } catch (error) {
        console.error('[BROADCAST_API] Error exporting campaign report:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to export campaign report'
        });
    }
});

/**
 * POST /api/broadcast/templates
 * Save a new message template
 */
router.post('/templates', async (req, res) => {
    try {
        const { tenantId, templateName, messageText, messageType, imageUrl } = req.body;

        if (!tenantId || !templateName || !messageText) {
            return res.status(400).json({
                success: false,
                error: 'Missing required fields: tenantId, templateName, messageText'
            });
        }

        const { data, error } = await supabase
            .from('message_templates')
            .insert({
                tenant_id: tenantId,
                template_name: templateName,
                message_text: messageText,
                message_type: messageType || 'text',
                image_url: imageUrl
            })
            .select()
            .single();

        if (error) throw error;

        res.json({
            success: true,
            template: data
        });
    } catch (error) {
        console.error('[BROADCAST_API] Error saving template:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to save template'
        });
    }
});

/**
 * GET /api/broadcast/templates/:tenantId
 * Get all message templates for a tenant
 */
router.get('/templates/:tenantId', async (req, res) => {
    try {
        const { tenantId } = req.params;

        const { data: templates, error } = await supabase
            .from('message_templates')
            .select('*')
            .eq('tenant_id', tenantId)
            .order('created_at', { ascending: false });

        if (error) throw error;

        res.json({
            success: true,
            templates: templates || []
        });
    } catch (error) {
        console.error('[BROADCAST_API] Error fetching templates:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to fetch templates'
        });
    }
});

/**
 * DELETE /api/broadcast/templates/:templateId
 * Delete a message template
 */
router.delete('/templates/:templateId', async (req, res) => {
    try {
        const { templateId } = req.params;

        const { error } = await supabase
            .from('message_templates')
            .delete()
            .eq('id', templateId);

        if (error) throw error;

        res.json({
            success: true,
            message: 'Template deleted successfully'
        });
    } catch (error) {
        console.error('[BROADCAST_API] Error deleting template:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to delete template'
        });
    }
});

/**
 * PUT /api/broadcast/templates/:templateId/use
 * Increment template usage count
 */
router.put('/templates/:templateId/use', async (req, res) => {
    try {
        const { templateId } = req.params;

        const { data, error } = await supabase
            .rpc('increment_template_usage', { template_id: templateId });

        if (error) {
            // Fallback if RPC doesn't exist
            const { data: template } = await supabase
                .from('message_templates')
                .select('usage_count')
                .eq('id', templateId)
                .single();

            await supabase
                .from('message_templates')
                .update({ usage_count: (template?.usage_count || 0) + 1 })
                .eq('id', templateId);
        }

        res.json({ success: true });
    } catch (error) {
        console.error('[BROADCAST_API] Error updating template usage:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * GET /api/broadcast/daily-stats/:tenantId
 * Get daily message usage statistics
 */
router.get('/daily-stats/:tenantId', async (req, res) => {
    try {
        const { tenantId } = req.params;
        
        // Get tenant's configured daily limit
        const { data: tenant, error: tenantError } = await supabase
            .from('tenants')
            .select('daily_message_limit')
            .eq('id', tenantId)
            .single();
        
        const dailyLimit = tenant?.daily_message_limit || 1000;

        const { data: count, error } = await supabase
            .rpc('get_daily_message_count', { p_tenant_id: tenantId });

        if (error) {
            // Fallback: count today's sent messages from bulk_schedules
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            
            const { data: messages, error: countError } = await supabase
                .from('bulk_schedules')
                .select('id', { count: 'exact' })
                .eq('tenant_id', tenantId)
                .eq('status', 'sent')
                .gte('delivered_at', today.toISOString());

            const fallbackCount = messages?.length || 0;
            
            res.json({
                success: true,
                stats: {
                    sent_today: fallbackCount,
                    daily_limit: dailyLimit,
                    remaining: Math.max(0, dailyLimit - fallbackCount),
                    percentage_used: Math.round((fallbackCount / dailyLimit) * 100),
                    status: fallbackCount >= dailyLimit ? 'limit_reached' : 
                           fallbackCount > dailyLimit * 0.8 ? 'warning' : 'safe'
                }
            });
        } else {
            const currentCount = count || 0;
            res.json({
                success: true,
                stats: {
                    sent_today: currentCount,
                    daily_limit: dailyLimit,
                    remaining: Math.max(0, dailyLimit - currentCount),
                    percentage_used: Math.round((currentCount / dailyLimit) * 100),
                    status: currentCount >= dailyLimit ? 'limit_reached' : 
                           currentCount > dailyLimit * 0.8 ? 'warning' : 'safe'
                }
            });
        }
    } catch (error) {
        console.error('[BROADCAST_API] Error fetching daily stats:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to fetch daily stats'
        });
    }
});

// Update tenant daily message limit
router.put('/daily-limit/:tenantId', async (req, res) => {
    try {
        const { tenantId } = req.params;
        const { dailyLimit } = req.body;
        
        if (!dailyLimit || dailyLimit < 100 || dailyLimit > 10000) {
            return res.status(400).json({
                success: false,
                error: 'Daily limit must be between 100 and 10,000'
            });
        }
        
        // Check if column exists first
        const { error: checkError } = await supabase
            .from('tenants')
            .select('daily_message_limit')
            .eq('id', tenantId)
            .single();
        
        if (checkError && checkError.message.includes('column')) {
            return res.status(400).json({
                success: false,
                error: 'Please run the database migration first. See MULTIDAY_BROADCAST_GUIDE.md'
            });
        }
        
        const { error } = await supabase
            .from('tenants')
            .update({ daily_message_limit: dailyLimit })
            .eq('id', tenantId);
        
        if (error) throw error;
        
        res.json({
            success: true,
            message: `Daily limit updated to ${dailyLimit} messages`,
            dailyLimit
        });
    } catch (error) {
        console.error('[BROADCAST_API] Error updating daily limit:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to update daily limit'
        });
    }
});

// Get tenant daily limit
router.get('/daily-limit/:tenantId', async (req, res) => {
    try {
        const { tenantId } = req.params;
        
        const { data: tenant, error } = await supabase
            .from('tenants')
            .select('daily_message_limit')
            .eq('id', tenantId)
            .single();
        
        if (error) throw error;
        
        res.json({
            success: true,
            dailyLimit: tenant?.daily_message_limit || 1000
        });
    } catch (error) {
        console.error('[BROADCAST_API] Error fetching daily limit:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to fetch daily limit'
        });
    }
});

module.exports = router;

