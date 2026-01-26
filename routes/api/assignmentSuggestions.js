/**
 * AI-Powered Assignment Suggestions API
 * Provides recommendations for lead distribution and salesman performance
 */

const express = require('express');
const router = express.Router();
const { dbClient } = require('../../services/config');
const { requireAuth: authenticateToken } = require('../../middleware/authMiddleware');

/**
 * GET /api/assignment-suggestions
 * Get AI-powered suggestions for optimizing lead distribution
 */
router.get('/', authenticateToken, async (req, res) => {
  try {
    const tenantId = req.user.tenantId;
    const currentMonth = new Date().toISOString().substring(0, 7); // YYYY-MM

    // Get all salesmen with their performance data
    const { data: salesmen, error: salesmenErr } = await dbClient
      .from('salesmen')
      .select('id, name, name_ar, is_active')
      .eq('tenant_id', tenantId)
      .eq('is_admin', false)
      .is('deleted_at', null);

    if (salesmenErr) throw salesmenErr;

    const suggestions = [];

    // Analyze each salesman's performance
    for (const salesman of salesmen) {
      // Get monthly stats
      const { data: leads } = await dbClient
        .from('crm_leads')
        .select('id, status, created_at, heat, score')
        .eq('tenant_id', tenantId)
        .eq('assigned_user_id', salesman.id)
        .gte('created_at', `${currentMonth}-01`)
        .lte('created_at', `${currentMonth}-31T23:59:59`);

      const totalLeads = leads?.length || 0;
      const convertedLeads = leads?.filter(l => l.status === 'CONVERTED')?.length || 0;
      const hotLeads = leads?.filter(l => l.heat === 'HOT' || l.heat === 'ON_FIRE')?.length || 0;
      const avgScore = leads?.length > 0 
        ? leads.reduce((sum, l) => sum + (l.score || 0), 0) / leads.length 
        : 0;

      const conversionRate = totalLeads > 0 ? (convertedLeads / totalLeads) * 100 : 0;

      // Get response time (avg time to first response)
      const { data: responseData } = await dbClient
        .from('crm_lead_events')
        .select('created_at, lead_id')
        .eq('tenant_id', tenantId)
        .eq('event_type', 'FIRST_RESPONSE')
        .in('lead_id', leads?.map(l => l.id) || []);

      let avgResponseMinutes = 0;
      if (responseData && responseData.length > 0) {
        const responseTimes = responseData.map(r => {
          const lead = leads.find(l => l.id === r.lead_id);
          if (lead) {
            const created = new Date(lead.created_at);
            const responded = new Date(r.created_at);
            return (responded - created) / (1000 * 60); // minutes
          }
          return 0;
        }).filter(t => t > 0);

        avgResponseMinutes = responseTimes.length > 0
          ? responseTimes.reduce((sum, t) => sum + t, 0) / responseTimes.length
          : 0;
      }

      // Get target (if exists)
      const { data: target } = await dbClient
        .from('salesman_targets')
        .select('visits_per_month, orders_per_month')
        .eq('tenant_id', tenantId)
        .eq('salesman_id', salesman.id)
        .eq('month', parseInt(currentMonth.split('-')[1]))
        .eq('year', parseInt(currentMonth.split('-')[0]))
        .is('deleted_at', null)
        .maybeSingle();

      const targetLeads = target?.visits_per_month || 0;
      const targetOrders = target?.orders_per_month || 0;
      const utilizationRate = targetLeads > 0 ? (totalLeads / targetLeads) * 100 : 0;

      // GENERATE SUGGESTIONS

      // High performer with low utilization
      if (conversionRate >= 30 && utilizationRate < 70 && salesman.is_active) {
        suggestions.push({
          salesmanId: salesman.id,
          salesmanName: salesman.name,
          type: 'increase_capacity',
          priority: 'high',
          message: `${salesman.name} has excellent conversion rate (${conversionRate.toFixed(1)}%) but is only at ${utilizationRate.toFixed(0)}% capacity. Assign more leads!`,
          metrics: {
            conversionRate: conversionRate.toFixed(1),
            utilizationRate: utilizationRate.toFixed(0),
            currentLeads: totalLeads,
            targetLeads,
            suggestedTarget: Math.ceil(targetLeads * 1.3)
          }
        });
      }

      // Fast responder
      if (avgResponseMinutes > 0 && avgResponseMinutes < 15 && utilizationRate < 80) {
        suggestions.push({
          salesmanId: salesman.id,
          salesmanName: salesman.name,
          type: 'fast_responder',
          priority: 'medium',
          message: `${salesman.name} responds quickly (avg ${avgResponseMinutes.toFixed(0)} min). Ideal for urgent/hot leads.`,
          metrics: {
            avgResponseMinutes: avgResponseMinutes.toFixed(0),
            utilizationRate: utilizationRate.toFixed(0),
            hotLeadsHandled: hotLeads
          }
        });
      }

      // Underutilized
      if (utilizationRate < 40 && salesman.is_active && conversionRate >= 15) {
        suggestions.push({
          salesmanId: salesman.id,
          salesmanName: salesman.name,
          type: 'underutilized',
          priority: 'medium',
          message: `${salesman.name} is underutilized (${utilizationRate.toFixed(0)}% capacity) but maintains ${conversionRate.toFixed(1)}% conversion. Assign more leads!`,
          metrics: {
            currentLeads: totalLeads,
            targetLeads,
            utilizationRate: utilizationRate.toFixed(0),
            conversionRate: conversionRate.toFixed(1)
          }
        });
      }

      // Low conversion - needs training
      if (totalLeads >= 10 && conversionRate < 10) {
        suggestions.push({
          salesmanId: salesman.id,
          salesmanName: salesman.name,
          type: 'needs_training',
          priority: 'high',
          message: `${salesman.name} has low conversion rate (${conversionRate.toFixed(1)}%) with ${totalLeads} leads. Consider training or coaching.`,
          metrics: {
            totalLeads,
            convertedLeads,
            conversionRate: conversionRate.toFixed(1),
            avgLeadScore: avgScore.toFixed(0)
          }
        });
      }

      // Slow responder
      if (avgResponseMinutes > 60 && totalLeads > 5) {
        suggestions.push({
          salesmanId: salesman.id,
          salesmanName: salesman.name,
          type: 'slow_response',
          priority: 'high',
          message: `${salesman.name} takes ${avgResponseMinutes.toFixed(0)} minutes on average to respond. This may hurt conversion.`,
          metrics: {
            avgResponseMinutes: avgResponseMinutes.toFixed(0),
            totalLeads,
            conversionRate: conversionRate.toFixed(1)
          }
        });
      }

      // Exceeding target - star performer
      if (utilizationRate >= 100 && conversionRate >= 25) {
        suggestions.push({
          salesmanId: salesman.id,
          salesmanName: salesman.name,
          type: 'star_performer',
          priority: 'low',
          message: `🌟 ${salesman.name} is a star! ${utilizationRate.toFixed(0)}% of target with ${conversionRate.toFixed(1)}% conversion. Consider rewarding!`,
          metrics: {
            utilizationRate: utilizationRate.toFixed(0),
            conversionRate: conversionRate.toFixed(1),
            totalLeads,
            convertedLeads
          }
        });
      }
    }

    // Sort suggestions by priority
    const priorityOrder = { high: 1, medium: 2, low: 3 };
    suggestions.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);

    return res.json({
      success: true,
      suggestions,
      totalSalesmen: salesmen.length,
      month: currentMonth
    });

  } catch (error) {
    console.error('[ASSIGNMENT_SUGGESTIONS] Error:', error);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/assignment-suggestions/salesman/:salesmanId
 * Get detailed suggestions for a specific salesman
 */
router.get('/salesman/:salesmanId', authenticateToken, async (req, res) => {
  try {
    const { salesmanId } = req.params;
    const tenantId = req.user.tenantId;
    const currentMonth = new Date().toISOString().substring(0, 7);

    // Get salesman leads
    const { data: leads } = await dbClient
      .from('crm_leads')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('assigned_user_id', salesmanId)
      .gte('created_at', `${currentMonth}-01`)
      .order('created_at', { ascending: false });

    const totalLeads = leads?.length || 0;
    const convertedLeads = leads?.filter(l => l.status === 'CONVERTED')?.length || 0;
    const pendingLeads = leads?.filter(l => l.status === 'NEW' || l.status === 'CONTACTED')?.length || 0;
    const hotLeads = leads?.filter(l => l.heat === 'HOT' || l.heat === 'ON_FIRE')?.length || 0;

    const conversionRate = totalLeads > 0 ? (convertedLeads / totalLeads) * 100 : 0;

    const recommendations = [];

    // Prioritize hot leads
    if (hotLeads > 0) {
      recommendations.push({
        type: 'prioritize_hot',
        message: `Focus on ${hotLeads} hot leads first - they have highest conversion potential`,
        actionable: true,
        leadIds: leads.filter(l => l.heat === 'HOT' || l.heat === 'ON_FIRE').slice(0, 10).map(l => l.id)
      });
    }

    // Follow up pending leads
    if (pendingLeads > 0) {
      recommendations.push({
        type: 'follow_up_pending',
        message: `${pendingLeads} leads are pending - schedule follow-ups to improve conversion`,
        actionable: true,
        leadIds: leads.filter(l => l.status === 'NEW' || l.status === 'CONTACTED').slice(0, 10).map(l => l.id)
      });
    }

    // Performance feedback
    if (conversionRate >= 30) {
      recommendations.push({
        type: 'excellent_performance',
        message: `Excellent work! ${conversionRate.toFixed(1)}% conversion rate is above average`,
        actionable: false
      });
    } else if (conversionRate < 15 && totalLeads >= 5) {
      recommendations.push({
        type: 'improve_conversion',
        message: `Conversion rate is ${conversionRate.toFixed(1)}%. Consider improving follow-up speed and quality`,
        actionable: true
      });
    }

    return res.json({
      success: true,
      salesmanId,
      stats: {
        totalLeads,
        convertedLeads,
        pendingLeads,
        hotLeads,
        conversionRate: conversionRate.toFixed(1)
      },
      recommendations
    });

  } catch (error) {
    console.error('[ASSIGNMENT_SUGGESTIONS] Salesman error:', error);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router;
