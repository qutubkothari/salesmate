const express = require('express');
const router = express.Router();
const { dbClient } = require('../../../services/config');
const { requireSalesmanAuth } = require('../../../services/salesmanAuth');

/**
 * Mobile API for Salesman Follow-ups
 * Routes:
 * - GET /api/mobile/followups - Get followups for logged-in salesman
 * - POST /api/mobile/followups - Create new followup
 * - PUT /api/mobile/followups/:id/complete - Mark followup as complete
 * - DELETE /api/mobile/followups/:id - Delete followup
 */

// Get all followups for current salesman
router.get('/followups', requireSalesmanAuth, async (req, res) => {
  try {
    const { tenantId, salesmanId } = req.salesmanAuth;
    const { status = 'pending', limit = 50 } = req.query;

    // Get followups from conversations_new
    let query = dbClient
      .from('conversations_new')
      .select(`
        id,
        end_user_phone,
        end_user_name,
        follow_up_at,
        follow_up_note,
        follow_up_type,
        follow_up_priority,
        follow_up_completed_at,
        last_message_at,
        messages_count,
        status
      `)
      .eq('tenant_id', tenantId)
      .eq('salesman_id', salesmanId)
      .not('follow_up_at', 'is', null)
      .order('follow_up_at', { ascending: true })
      .limit(parseInt(limit));

    // Filter by status
    if (status === 'pending') {
      query = query.is('follow_up_completed_at', null);
    } else if (status === 'completed') {
      query = query.not('follow_up_completed_at', 'is', null);
    }

    const { data: conversations, error } = await query;
    if (error) throw error;

    // Enrich with customer data
    const followups = await Promise.all(
      (conversations || []).map(async (conv) => {
        const { data: customer } = await dbClient
          .from('customer_profiles_new')
          .select('phone, business_name, contact_person, city, customer_type, gst_number')
          .eq('tenant_id', tenantId)
          .eq('phone', conv.end_user_phone)
          .maybeSingle();

        const isOverdue = conv.follow_up_at && !conv.follow_up_completed_at && 
                         new Date(conv.follow_up_at) < new Date();

        return {
          id: conv.id,
          phone: conv.end_user_phone,
          customerName: customer?.business_name || customer?.contact_person || conv.end_user_name || 'Unknown',
          city: customer?.city,
          customerType: customer?.customer_type,
          gstNumber: customer?.gst_number,
          followUpAt: conv.follow_up_at,
          followUpNote: conv.follow_up_note,
          followUpType: conv.follow_up_type || 'call',
          followUpPriority: conv.follow_up_priority || 'medium',
          completedAt: conv.follow_up_completed_at,
          lastMessageAt: conv.last_message_at,
          messagesCount: conv.messages_count || 0,
          conversationStatus: conv.status,
          isOverdue,
          isPending: !conv.follow_up_completed_at
        };
      })
    );

    // Categorize followups
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const categorized = {
      overdue: followups.filter(f => f.isOverdue),
      today: followups.filter(f => 
        f.isPending && 
        new Date(f.followUpAt) >= today && 
        new Date(f.followUpAt) < tomorrow
      ),
      upcoming: followups.filter(f => 
        f.isPending && 
        new Date(f.followUpAt) >= tomorrow
      ),
      completed: followups.filter(f => !f.isPending)
    };

    res.json({
      success: true,
      followups,
      categorized,
      counts: {
        total: followups.length,
        overdue: categorized.overdue.length,
        today: categorized.today.length,
        upcoming: categorized.upcoming.length,
        completed: categorized.completed.length
      }
    });
  } catch (error) {
    console.error('[MOBILE_FOLLOWUPS] Get error:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message || 'Failed to load followups' 
    });
  }
});

// Create new followup
router.post('/followups', requireSalesmanAuth, async (req, res) => {
  try {
    const { tenantId, salesmanId, userId } = req.salesmanAuth;
    const { 
      phone, 
      followUpAt, 
      followUpNote, 
      followUpType = 'call', 
      followUpPriority = 'medium' 
    } = req.body;

    if (!phone || !followUpAt) {
      return res.status(400).json({ 
        success: false, 
        error: 'Phone and followUpAt are required' 
      });
    }

    // Get or create conversation
    let { data: conversation, error: convError } = await dbClient
      .from('conversations_new')
      .select('id, salesman_id')
      .eq('tenant_id', tenantId)
      .eq('end_user_phone', phone)
      .maybeSingle();

    if (convError) throw convError;

    if (!conversation) {
      // Create new conversation
      const { data: newConv, error: createError } = await dbClient
        .from('conversations_new')
        .insert({
          id: `conv_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          tenant_id: tenantId,
          end_user_phone: phone,
          salesman_id: salesmanId,
          status: 'active',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .select('id')
        .single();

      if (createError) throw createError;
      conversation = newConv;
    }

    // Update conversation with followup
    const { error: updateError } = await dbClient
      .from('conversations_new')
      .update({
        follow_up_at: followUpAt,
        follow_up_note: followUpNote,
        follow_up_type: followUpType,
        follow_up_priority: followUpPriority,
        follow_up_created_by: userId,
        salesman_id: salesmanId, // Ensure assigned to current salesman
        updated_at: new Date().toISOString()
      })
      .eq('id', conversation.id);

    if (updateError) throw updateError;

    // Also create entry in scheduled_followups for compatibility
    await dbClient
      .from('scheduled_followups')
      .insert({
        id: `fup_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        tenant_id: tenantId,
        end_user_phone: phone,
        scheduled_time: followUpAt,
        message: followUpNote || `Follow-up: ${followUpType}`,
        status: 'pending',
        created_by: salesmanId,
        created_at: new Date().toISOString()
      });

    res.json({ 
      success: true, 
      message: 'Follow-up created successfully',
      conversationId: conversation.id
    });
  } catch (error) {
    console.error('[MOBILE_FOLLOWUPS] Create error:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message || 'Failed to create followup' 
    });
  }
});

// Mark followup as complete
router.put('/followups/:conversationId/complete', requireSalesmanAuth, async (req, res) => {
  try {
    const { tenantId, salesmanId } = req.salesmanAuth;
    const { conversationId } = req.params;
    const { completionNote } = req.body;

    // Get current note first
    const { data: current } = await dbClient
      .from('conversations_new')
      .select('follow_up_note')
      .eq('id', conversationId)
      .single();

    const updatedNote = completionNote && current?.follow_up_note
      ? `${completionNote} (Original: ${current.follow_up_note})`
      : current?.follow_up_note || completionNote;

    // Update conversation
    const { error } = await dbClient
      .from('conversations_new')
      .update({
        follow_up_completed_at: new Date().toISOString(),
        follow_up_note: updatedNote,
        updated_at: new Date().toISOString()
      })
      .eq('id', conversationId)
      .eq('tenant_id', tenantId)
      .eq('salesman_id', salesmanId);

    if (error) throw error;

    // Also update scheduled_followups
    const { data: conv } = await dbClient
      .from('conversations_new')
      .select('end_user_phone')
      .eq('id', conversationId)
      .single();

    if (conv?.end_user_phone) {
      await dbClient
        .from('scheduled_followups')
        .update({
          status: 'completed',
          executed_at: new Date().toISOString()
        })
        .eq('tenant_id', tenantId)
        .eq('end_user_phone', conv.end_user_phone)
        .eq('status', 'pending');
    }

    res.json({ 
      success: true, 
      message: 'Follow-up marked as complete' 
    });
  } catch (error) {
    console.error('[MOBILE_FOLLOWUPS] Complete error:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message || 'Failed to complete followup' 
    });
  }
});

// Delete/Cancel followup
router.delete('/followups/:conversationId', requireSalesmanAuth, async (req, res) => {
  try {
    const { tenantId, salesmanId } = req.salesmanAuth;
    const { conversationId } = req.params;

    // Clear followup fields
    const { error } = await dbClient
      .from('conversations_new')
      .update({
        follow_up_at: null,
        follow_up_note: null,
        follow_up_type: null,
        follow_up_priority: null,
        updated_at: new Date().toISOString()
      })
      .eq('id', conversationId)
      .eq('tenant_id', tenantId)
      .eq('salesman_id', salesmanId);

    if (error) throw error;

    res.json({ 
      success: true, 
      message: 'Follow-up cancelled' 
    });
  } catch (error) {
    console.error('[MOBILE_FOLLOWUPS] Delete error:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message || 'Failed to delete followup' 
    });
  }
});

// Get auto-followups (from autonomous system)
router.get('/followups/auto', requireSalesmanAuth, async (req, res) => {
  try {
    const { tenantId, salesmanId } = req.salesmanAuth;

    // Get active enrollments from autonomous followup system
    const { data: enrollments, error } = await dbClient
      .from('sequence_enrollments')
      .select(`
        id,
        contact_phone,
        sequence_id,
        current_step,
        next_send_at,
        status,
        started_at
      `)
      .eq('tenant_id', tenantId)
      .eq('status', 'active')
      .order('next_send_at', { ascending: true })
      .limit(50);

    if (error) throw error;

    // Enrich with customer and sequence data
    const autoFollowups = await Promise.all(
      (enrollments || []).map(async (enrollment) => {
        const { data: customer } = await dbClient
          .from('customer_profiles_new')
          .select('business_name, contact_person, city')
          .eq('tenant_id', tenantId)
          .eq('phone', enrollment.contact_phone)
          .maybeSingle();

        const { data: sequence } = await dbClient
          .from('followup_sequences')
          .select('sequence_name, sequence_type, description')
          .eq('id', enrollment.sequence_id)
          .maybeSingle();

        return {
          id: enrollment.id,
          phone: enrollment.contact_phone,
          customerName: customer?.business_name || customer?.contact_person || 'Unknown',
          city: customer?.city,
          sequenceName: sequence?.sequence_name || 'Auto Follow-up',
          sequenceType: sequence?.sequence_type,
          currentStep: enrollment.current_step,
          nextSendAt: enrollment.next_send_at,
          status: enrollment.status,
          startedAt: enrollment.started_at
        };
      })
    );

    res.json({ 
      success: true, 
      autoFollowups,
      count: autoFollowups.length
    });
  } catch (error) {
    console.error('[MOBILE_FOLLOWUPS] Auto followups error:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message || 'Failed to load auto followups' 
    });
  }
});

module.exports = router;
