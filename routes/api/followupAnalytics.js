const express = require('express');
const router = express.Router();
const { dbClient } = require('../../services/config');
const { requireTenantAuth } = require('../../services/tenantAuth');

/**
 * Follow-up Analytics Dashboard
 * Metrics: completion rate, overdue count, trends, salesman performance
 */

// Get follow-up analytics summary
router.get('/summary/:tenantId', requireTenantAuth({ requireMatchParamTenantId: false }), async (req, res) => {
  try {
    const { tenantId } = req.params;
    const { startDate, endDate, salesmanId } = req.query;

    const now = new Date().toISOString();
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayISO = today.toISOString();

    // Base query
    let query = dbClient
      .from('conversations_new')
      .select('*')
      .eq('tenant_id', tenantId)
      .not('follow_up_at', 'is', null);

    if (salesmanId) {
      query = query.eq('salesman_id', salesmanId);
    }

    if (startDate) {
      query = query.gte('follow_up_at', startDate);
    }

    if (endDate) {
      query = query.lte('follow_up_at', endDate);
    }

    const { data: followups, error } = await query;
    if (error) throw error;

    // Calculate metrics
    const total = followups.length;
    const completed = followups.filter(f => f.follow_up_completed_at).length;
    const pending = total - completed;
    const overdue = followups.filter(f => 
      !f.follow_up_completed_at && new Date(f.follow_up_at) < new Date()
    ).length;
    const today_count = followups.filter(f => 
      !f.follow_up_completed_at && 
      f.follow_up_at >= todayISO && 
      f.follow_up_at < new Date(today.getTime() + 86400000).toISOString()
    ).length;

    const completionRate = total > 0 ? ((completed / total) * 100).toFixed(1) : 0;
    
    // Average completion time (in hours)
    const completedFollowups = followups.filter(f => f.follow_up_completed_at && f.follow_up_at);
    const avgCompletionTime = completedFollowups.length > 0
      ? completedFollowups.reduce((sum, f) => {
          const scheduled = new Date(f.follow_up_at);
          const completed = new Date(f.follow_up_completed_at);
          return sum + (completed - scheduled) / (1000 * 60 * 60); // hours
        }, 0) / completedFollowups.length
      : 0;

    // By priority
    const byPriority = {
      urgent: followups.filter(f => f.follow_up_priority === 'urgent' && !f.follow_up_completed_at).length,
      high: followups.filter(f => f.follow_up_priority === 'high' && !f.follow_up_completed_at).length,
      medium: followups.filter(f => f.follow_up_priority === 'medium' && !f.follow_up_completed_at).length,
      low: followups.filter(f => f.follow_up_priority === 'low' && !f.follow_up_completed_at).length
    };

    // By type
    const byType = {
      call: followups.filter(f => f.follow_up_type === 'call').length,
      visit: followups.filter(f => f.follow_up_type === 'visit').length,
      message: followups.filter(f => f.follow_up_type === 'message').length,
      email: followups.filter(f => f.follow_up_type === 'email').length
    };

    res.json({
      success: true,
      summary: {
        total,
        completed,
        pending,
        overdue,
        today: today_count,
        completionRate: parseFloat(completionRate),
        avgCompletionTimeHours: avgCompletionTime.toFixed(1)
      },
      byPriority,
      byType
    });
  } catch (error) {
    console.error('[FOLLOWUP_ANALYTICS] Summary error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get salesman performance
router.get('/performance/:tenantId', requireTenantAuth({ requireMatchParamTenantId: false }), async (req, res) => {
  try {
    const { tenantId } = req.params;
    const { startDate, endDate } = req.query;

    // Get all salesmen
    const { data: salesmen, error: salesmenError } = await dbClient
      .from('salesmen')
      .select('id, name, phone, email, user_id')
      .eq('tenant_id', tenantId)
      .eq('is_active', true);

    if (salesmenError) throw salesmenError;

    // Get followups for each salesman
    const performance = await Promise.all(
      salesmen.map(async (salesman) => {
        let query = dbClient
          .from('conversations_new')
          .select('*')
          .eq('tenant_id', tenantId)
          .eq('salesman_id', salesman.id)
          .not('follow_up_at', 'is', null);

        if (startDate) query = query.gte('follow_up_at', startDate);
        if (endDate) query = query.lte('follow_up_at', endDate);

        const { data: followups } = await query;

        const total = followups?.length || 0;
        const completed = followups?.filter(f => f.follow_up_completed_at).length || 0;
        const overdue = followups?.filter(f => 
          !f.follow_up_completed_at && new Date(f.follow_up_at) < new Date()
        ).length || 0;
        const completionRate = total > 0 ? ((completed / total) * 100).toFixed(1) : 0;

        return {
          salesmanId: salesman.id,
          salesmanName: salesman.name,
          phone: salesman.phone,
          email: salesman.email,
          total,
          completed,
          pending: total - completed,
          overdue,
          completionRate: parseFloat(completionRate)
        };
      })
    );

    // Sort by completion rate
    performance.sort((a, b) => b.completionRate - a.completionRate);

    res.json({
      success: true,
      performance
    });
  } catch (error) {
    console.error('[FOLLOWUP_ANALYTICS] Performance error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get daily trend (last 30 days)
router.get('/trend/:tenantId', requireTenantAuth({ requireMatchParamTenantId: false }), async (req, res) => {
  try {
    const { tenantId } = req.params;
    const { salesmanId } = req.query;

    // Get last 30 days of followups
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    let query = dbClient
      .from('conversations_new')
      .select('follow_up_at, follow_up_completed_at, follow_up_created_by')
      .eq('tenant_id', tenantId)
      .not('follow_up_at', 'is', null)
      .gte('follow_up_at', thirtyDaysAgo.toISOString());

    if (salesmanId) {
      query = query.eq('salesman_id', salesmanId);
    }

    const { data: followups, error } = await query;
    if (error) throw error;

    // Group by date
    const dailyData = {};
    for (let i = 0; i < 30; i++) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split('T')[0];
      dailyData[dateStr] = {
        date: dateStr,
        created: 0,
        scheduled: 0,
        completed: 0
      };
    }

    followups.forEach(f => {
      const scheduleDate = f.follow_up_at.split('T')[0];
      if (dailyData[scheduleDate]) {
        dailyData[scheduleDate].scheduled += 1;
      }

      if (f.follow_up_completed_at) {
        const completedDate = f.follow_up_completed_at.split('T')[0];
        if (dailyData[completedDate]) {
          dailyData[completedDate].completed += 1;
        }
      }
    });

    const trend = Object.values(dailyData).reverse();

    res.json({
      success: true,
      trend
    });
  } catch (error) {
    console.error('[FOLLOWUP_ANALYTICS] Trend error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
