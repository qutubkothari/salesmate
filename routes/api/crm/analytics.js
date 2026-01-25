const express = require('express');
const router = express.Router();

const { dbClient: supabase } = require('../../../services/config');
const { requireCrmAuth, requireRole } = require('../../../middleware/crmAuth');
const { requireCrmFeature } = require('../../../middleware/requireCrmFeature');
const { CRM_FEATURES } = require('../../../services/crmFeatureFlags');

/**
 * GET /api/crm/analytics/conversion-funnel
 * Get conversion funnel metrics by channel/source
 */
router.get('/conversion-funnel', requireCrmAuth, requireCrmFeature(CRM_FEATURES.CRM_LEADS), requireRole(['OWNER', 'ADMIN', 'MANAGER']), async (req, res) => {
  try {
    const { startDate, endDate, channel } = req.query;

    let query = supabase
      .from('crm_leads')
      .select('id, channel, status, heat, created_at')
      .eq('tenant_id', req.user.tenantId);

    if (startDate) query = query.gte('created_at', startDate);
    if (endDate) query = query.lte('created_at', endDate);
    if (channel) query = query.eq('channel', channel.toUpperCase());

    const { data: leads, error } = await query;
    if (error) throw error;

    // Calculate funnel metrics
    const funnel = {
      total: leads.length,
      byStatus: {},
      byChannel: {},
      byHeat: {},
      conversionRates: {}
    };

    // Group by status
    leads.forEach(lead => {
      funnel.byStatus[lead.status] = (funnel.byStatus[lead.status] || 0) + 1;
      funnel.byChannel[lead.channel] = (funnel.byChannel[lead.channel] || 0) + 1;
      funnel.byHeat[lead.heat] = (funnel.byHeat[lead.heat] || 0) + 1;
    });

    // Calculate conversion rates
    const statusOrder = ['NEW', 'CONTACTED', 'QUALIFIED', 'PROPOSAL', 'NEGOTIATION', 'WON', 'LOST'];
    statusOrder.forEach((status, index) => {
      if (index === 0) {
        funnel.conversionRates[status] = 100;
      } else {
        const prevCount = funnel.byStatus[statusOrder[index - 1]] || 0;
        const currentCount = funnel.byStatus[status] || 0;
        funnel.conversionRates[status] = prevCount > 0 ? ((currentCount / prevCount) * 100).toFixed(2) : 0;
      }
    });

    // Overall conversion rate (WON / TOTAL)
    funnel.overallConversionRate = funnel.total > 0 
      ? (((funnel.byStatus['WON'] || 0) / funnel.total) * 100).toFixed(2)
      : 0;

    return res.json({ success: true, funnel });
  } catch (e) {
    return res.status(500).json({ success: false, error: 'funnel_failed', details: e?.message || String(e) });
  }
});

/**
 * GET /api/crm/analytics/source-performance
 * Get performance metrics by lead source/channel
 */
router.get('/source-performance', requireCrmAuth, requireCrmFeature(CRM_FEATURES.CRM_LEADS), requireRole(['OWNER', 'ADMIN', 'MANAGER']), async (req, res) => {
  try {
    const { startDate, endDate } = req.query;

    let query = supabase
      .from('crm_leads')
      .select('id, channel, status, score, heat, created_at')
      .eq('tenant_id', req.user.tenantId);

    if (startDate) query = query.gte('created_at', startDate);
    if (endDate) query = query.lte('created_at', endDate);

    const { data: leads, error } = await query;
    if (error) throw error;

    // Group by channel
    const sourceMetrics = {};

    leads.forEach(lead => {
      const channel = lead.channel || 'UNKNOWN';
      
      if (!sourceMetrics[channel]) {
        sourceMetrics[channel] = {
          total: 0,
          won: 0,
          lost: 0,
          active: 0,
          avgScore: 0,
          totalScore: 0,
          hot: 0,
          warm: 0,
          cold: 0
        };
      }

      const metrics = sourceMetrics[channel];
      metrics.total++;
      metrics.totalScore += lead.score || 0;

      if (lead.status === 'WON') metrics.won++;
      else if (lead.status === 'LOST') metrics.lost++;
      else metrics.active++;

      if (lead.heat === 'HOT' || lead.heat === 'ON_FIRE') metrics.hot++;
      else if (lead.heat === 'WARM') metrics.warm++;
      else metrics.cold++;
    });

    // Calculate averages and rates
    Object.keys(sourceMetrics).forEach(channel => {
      const metrics = sourceMetrics[channel];
      metrics.avgScore = metrics.total > 0 ? (metrics.totalScore / metrics.total).toFixed(1) : 0;
      metrics.conversionRate = metrics.total > 0 ? ((metrics.won / metrics.total) * 100).toFixed(2) : 0;
      metrics.lossRate = metrics.total > 0 ? ((metrics.lost / metrics.total) * 100).toFixed(2) : 0;
      metrics.hotRate = metrics.total > 0 ? ((metrics.hot / metrics.total) * 100).toFixed(2) : 0;
      delete metrics.totalScore; // Remove intermediate calculation
    });

    return res.json({ success: true, sources: sourceMetrics });
  } catch (e) {
    return res.status(500).json({ success: false, error: 'source_analytics_failed', details: e?.message || String(e) });
  }
});

/**
 * GET /api/crm/analytics/time-to-conversion
 * Get time-to-conversion metrics
 */
router.get('/time-to-conversion', requireCrmAuth, requireCrmFeature(CRM_FEATURES.CRM_LEADS), requireRole(['OWNER', 'ADMIN', 'MANAGER']), async (req, res) => {
  try {
    const { startDate, endDate, channel } = req.query;

    let query = supabase
      .from('crm_leads')
      .select('id, channel, status, created_at, updated_at')
      .eq('tenant_id', req.user.tenantId)
      .eq('status', 'WON');

    if (startDate) query = query.gte('created_at', startDate);
    if (endDate) query = query.lte('created_at', endDate);
    if (channel) query = query.eq('channel', channel.toUpperCase());

    const { data: wonLeads, error } = await query;
    if (error) throw error;

    const conversionTimes = [];
    const byChannel = {};

    wonLeads.forEach(lead => {
      const createdAt = new Date(lead.created_at);
      const updatedAt = new Date(lead.updated_at);
      const daysToConvert = Math.ceil((updatedAt - createdAt) / (1000 * 60 * 60 * 24));

      conversionTimes.push(daysToConvert);

      const ch = lead.channel || 'UNKNOWN';
      if (!byChannel[ch]) {
        byChannel[ch] = [];
      }
      byChannel[ch].push(daysToConvert);
    });

    // Calculate overall metrics
    const avgTime = conversionTimes.length > 0
      ? (conversionTimes.reduce((sum, val) => sum + val, 0) / conversionTimes.length).toFixed(1)
      : 0;

    const medianTime = conversionTimes.length > 0
      ? conversionTimes.sort((a, b) => a - b)[Math.floor(conversionTimes.length / 2)]
      : 0;

    const minTime = conversionTimes.length > 0 ? Math.min(...conversionTimes) : 0;
    const maxTime = conversionTimes.length > 0 ? Math.max(...conversionTimes) : 0;

    // Calculate by channel
    const channelMetrics = {};
    Object.keys(byChannel).forEach(ch => {
      const times = byChannel[ch];
      channelMetrics[ch] = {
        count: times.length,
        avgDays: (times.reduce((sum, val) => sum + val, 0) / times.length).toFixed(1),
        minDays: Math.min(...times),
        maxDays: Math.max(...times),
        medianDays: times.sort((a, b) => a - b)[Math.floor(times.length / 2)]
      };
    });

    return res.json({
      success: true,
      overall: {
        totalWon: wonLeads.length,
        avgDays: avgTime,
        medianDays: medianTime,
        minDays: minTime,
        maxDays: maxTime
      },
      byChannel: channelMetrics
    });
  } catch (e) {
    return res.status(500).json({ success: false, error: 'time_conversion_failed', details: e?.message || String(e) });
  }
});

/**
 * GET /api/crm/analytics/trends
 * Get trend data over time (daily/weekly/monthly)
 */
router.get('/trends', requireCrmAuth, requireCrmFeature(CRM_FEATURES.CRM_LEADS), requireRole(['OWNER', 'ADMIN', 'MANAGER']), async (req, res) => {
  try {
    const { startDate, endDate, groupBy = 'day' } = req.query;

    let query = supabase
      .from('crm_leads')
      .select('id, channel, status, created_at')
      .eq('tenant_id', req.user.tenantId);

    if (startDate) query = query.gte('created_at', startDate);
    if (endDate) query = query.lte('created_at', endDate);

    const { data: leads, error } = await query;
    if (error) throw error;

    const trends = {};

    leads.forEach(lead => {
      const date = new Date(lead.created_at);
      let key;

      if (groupBy === 'week') {
        const weekStart = new Date(date.setDate(date.getDate() - date.getDay()));
        key = weekStart.toISOString().split('T')[0];
      } else if (groupBy === 'month') {
        key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      } else {
        key = date.toISOString().split('T')[0];
      }

      if (!trends[key]) {
        trends[key] = { total: 0, won: 0, lost: 0, active: 0, byChannel: {} };
      }

      trends[key].total++;
      if (lead.status === 'WON') trends[key].won++;
      else if (lead.status === 'LOST') trends[key].lost++;
      else trends[key].active++;

      const ch = lead.channel || 'UNKNOWN';
      trends[key].byChannel[ch] = (trends[key].byChannel[ch] || 0) + 1;
    });

    // Convert to sorted array
    const trendArray = Object.keys(trends)
      .sort()
      .map(key => ({
        date: key,
        ...trends[key]
      }));

    return res.json({ success: true, trends: trendArray });
  } catch (e) {
    return res.status(500).json({ success: false, error: 'trends_failed', details: e?.message || String(e) });
  }
});

/**
 * GET /api/crm/analytics/team-performance
 * Get performance metrics by assigned user/salesman
 */
router.get('/team-performance', requireCrmAuth, requireCrmFeature(CRM_FEATURES.CRM_LEADS), requireRole(['OWNER', 'ADMIN', 'MANAGER']), async (req, res) => {
  try {
    const { startDate, endDate } = req.query;

    let query = supabase
      .from('crm_leads')
      .select('id, assigned_user_id, status, score, created_at')
      .eq('tenant_id', req.user.tenantId);

    if (startDate) query = query.gte('created_at', startDate);
    if (endDate) query = query.lte('created_at', endDate);

    const { data: leads, error } = await query;
    if (error) throw error;

    // Get user details
    const { data: users } = await supabase
      .from('crm_users')
      .select('id, name, email')
      .eq('tenant_id', req.user.tenantId);

    const userMap = {};
    (users || []).forEach(user => {
      userMap[user.id] = user;
    });

    // Group by assigned user
    const teamMetrics = {};

    leads.forEach(lead => {
      const userId = lead.assigned_user_id || 'UNASSIGNED';
      
      if (!teamMetrics[userId]) {
        teamMetrics[userId] = {
          userId,
          name: userMap[userId]?.name || 'Unassigned',
          email: userMap[userId]?.email || null,
          total: 0,
          won: 0,
          lost: 0,
          active: 0,
          avgScore: 0,
          totalScore: 0
        };
      }

      const metrics = teamMetrics[userId];
      metrics.total++;
      metrics.totalScore += lead.score || 0;

      if (lead.status === 'WON') metrics.won++;
      else if (lead.status === 'LOST') metrics.lost++;
      else metrics.active++;
    });

    // Calculate rates
    Object.keys(teamMetrics).forEach(userId => {
      const metrics = teamMetrics[userId];
      metrics.avgScore = metrics.total > 0 ? (metrics.totalScore / metrics.total).toFixed(1) : 0;
      metrics.conversionRate = metrics.total > 0 ? ((metrics.won / metrics.total) * 100).toFixed(2) : 0;
      metrics.lossRate = metrics.total > 0 ? ((metrics.lost / metrics.total) * 100).toFixed(2) : 0;
      delete metrics.totalScore;
    });

    // Convert to array and sort by conversion rate
    const teamArray = Object.values(teamMetrics).sort((a, b) => 
      parseFloat(b.conversionRate) - parseFloat(a.conversionRate)
    );

    return res.json({ success: true, team: teamArray });
  } catch (e) {
    return res.status(500).json({ success: false, error: 'team_performance_failed', details: e?.message || String(e) });
  }
});

module.exports = router;
