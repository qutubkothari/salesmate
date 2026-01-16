/**
 * Manager Dashboard Service
 * Real-time team performance, targets, and daily summaries
 */

const { dbClient } = require('./config');

class ManagerDashboardService {
  /**
   * Get team overview dashboard
   */
  async getTeamOverview(tenantId) {
    try {
      console.log('[DASHBOARD] Getting team overview');

      const now = new Date();
      const today = now.toISOString().split('T')[0];
      const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

      // 1. Get all salesmen
      const { data: salesmen } = await dbClient
        .from('sales_users')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('status', 'active');

      if (!salesmen) {
        return { ok: false, error: 'Failed to fetch salesmen' };
      }

      // 2. Get today's visits
      const { data: visits } = await dbClient
        .from('visits')
        .select('salesman_id, status, created_at')
        .eq('tenant_id', tenantId)
        .like('created_at', `${today}%`);

      // 3. Get today's orders
      const { data: orders } = await dbClient
        .from('orders_new')
        .select('salesman_id, status, actual_amount, created_at')
        .eq('tenant_id', tenantId)
        .like('created_at', `${today}%`);

      // 4. Get targets
      const { data: targets } = await dbClient
        .from('salesman_targets')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('period', thisMonth);

      // Build overview
      const overview = {
        date: today,
        period: thisMonth,
        total_salesmen: salesmen.length,
        today_stats: {
          total_visits: 0,
          completed_visits: 0,
          total_orders: 0,
          pending_orders: 0,
          total_revenue: 0,
          average_order_value: 0
        },
        team_members: [],
        top_performers: [],
        at_risk: []
      };

      // Process visits
      (visits || []).forEach(v => {
        overview.today_stats.total_visits++;
        if (v.status === 'completed') overview.today_stats.completed_visits++;
      });

      // Process orders
      let totalOrderAmount = 0;
      (orders || []).forEach(o => {
        overview.today_stats.total_orders++;
        if (o.status !== 'cancelled') {
          overview.today_stats.pending_orders++;
          if (o.actual_amount) totalOrderAmount += o.actual_amount;
        }
      });

      overview.today_stats.total_revenue = totalOrderAmount;
      if (overview.today_stats.total_orders > 0) {
        overview.today_stats.average_order_value = 
          Math.round(totalOrderAmount / overview.today_stats.total_orders);
      }

      // Build team member details
      const salesmenMap = new Map(salesmen.map(s => [s.id, s]));
      const salesmenVisits = {};
      const salesmenOrders = {};

      (visits || []).forEach(v => {
        if (!salesmenVisits[v.salesman_id]) salesmenVisits[v.salesman_id] = 0;
        salesmenVisits[v.salesman_id]++;
      });

      (orders || []).forEach(o => {
        if (!salesmenOrders[o.salesman_id]) salesmenOrders[o.salesman_id] = 0;
        salesmenOrders[o.salesman_id]++;
      });

      // Team members with today's stats
      salesmen.forEach(salesman => {
        const target = targets?.find(t => t.salesman_id === salesman.id);
        const todayVisits = salesmenVisits[salesman.id] || 0;
        const todayOrders = salesmenOrders[salesman.id] || 0;

        const member = {
          id: salesman.id,
          name: salesman.name,
          today_visits: todayVisits,
          today_orders: todayOrders,
          target_visits: target?.target_visits || 0,
          target_orders: target?.target_orders || 0,
          achieved_visits: target?.achieved_visits || 0,
          achieved_orders: target?.achieved_orders || 0,
          visits_progress: target ? Math.round((target.achieved_visits / target.target_visits) * 100) : 0,
          orders_progress: target ? Math.round((target.achieved_orders / target.target_orders) * 100) : 0,
          status: 'active'
        };

        overview.team_members.push(member);

        // Categorize
        if (member.visits_progress >= 80) {
          overview.top_performers.push({
            name: member.name,
            progress: member.visits_progress,
            type: 'visits'
          });
        } else if (member.visits_progress < 50) {
          overview.at_risk.push({
            name: member.name,
            progress: member.visits_progress,
            gap: 50 - member.visits_progress,
            type: 'visits'
          });
        }
      });

      // Sort
      overview.team_members.sort((a, b) => b.visits_progress - a.visits_progress);
      overview.top_performers.sort((a, b) => b.progress - a.progress);
      overview.at_risk.sort((a, b) => a.progress - b.progress);

      return {
        ok: true,
        overview
      };

    } catch (error) {
      console.error('[DASHBOARD] Overview error:', error);
      return {
        ok: false,
        error: error.message
      };
    }
  }

  /**
   * Get performance analytics
   */
  async getPerformanceAnalytics(tenantId, days = 7) {
    try {
      console.log('[DASHBOARD] Getting performance analytics for last', days, 'days');

      const endDate = new Date();
      const startDate = new Date(endDate.getTime() - days * 24 * 60 * 60 * 1000);
      const startStr = startDate.toISOString().split('T')[0];
      const endStr = endDate.toISOString().split('T')[0];

      // Get visits over period
      const { data: visits } = await dbClient
        .from('visits')
        .select('salesman_id, status, created_at, gps_latitude, gps_longitude')
        .eq('tenant_id', tenantId)
        .gte('created_at', startStr)
        .lte('created_at', endStr);

      // Get orders over period
      const { data: orders } = await dbClient
        .from('orders_new')
        .select('salesman_id, status, actual_amount, created_at')
        .eq('tenant_id', tenantId)
        .gte('created_at', startStr)
        .lte('created_at', endStr);

      // Build daily metrics
      const dailyMetrics = {};
      for (let i = 0; i < days; i++) {
        const date = new Date(startDate.getTime() + i * 24 * 60 * 60 * 1000);
        const dateStr = date.toISOString().split('T')[0];
        dailyMetrics[dateStr] = {
          date: dateStr,
          visits: 0,
          orders: 0,
          revenue: 0,
          completion_rate: 0
        };
      }

      // Count visits by day
      (visits || []).forEach(v => {
        const dateStr = v.created_at.split('T')[0];
        if (dailyMetrics[dateStr]) {
          dailyMetrics[dateStr].visits++;
        }
      });

      // Count orders by day
      let totalRevenue = 0;
      (orders || []).forEach(o => {
        const dateStr = o.created_at.split('T')[0];
        if (dailyMetrics[dateStr] && o.status !== 'cancelled') {
          dailyMetrics[dateStr].orders++;
          if (o.actual_amount) {
            dailyMetrics[dateStr].revenue += o.actual_amount;
            totalRevenue += o.actual_amount;
          }
        }
      });

      // Calculate completion rate
      const completedVisits = (visits || []).filter(v => v.status === 'completed').length;
      const completionRate = visits?.length > 0 
        ? Math.round((completedVisits / visits.length) * 100)
        : 0;

      return {
        ok: true,
        analytics: {
          period: {
            start: startStr,
            end: endStr,
            days
          },
          daily_metrics: Object.values(dailyMetrics),
          summary: {
            total_visits: visits?.length || 0,
            total_orders: orders?.length || 0,
            total_revenue: totalRevenue,
            average_daily_visits: Math.round((visits?.length || 0) / days),
            average_daily_orders: Math.round((orders?.length || 0) / days),
            average_daily_revenue: Math.round(totalRevenue / days),
            completion_rate: completionRate
          }
        }
      };

    } catch (error) {
      console.error('[DASHBOARD] Analytics error:', error);
      return {
        ok: false,
        error: error.message
      };
    }
  }

  /**
   * Get salesman detail view
   */
  async getSalesmanDetail(tenantId, salesmanId) {
    try {
      console.log('[DASHBOARD] Getting salesman detail for', salesmanId);

      const now = new Date();
      const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

      // Get salesman
      const { data: salesman } = await dbClient
        .from('sales_users')
        .select('*')
        .eq('id', salesmanId)
        .single();

      if (!salesman) {
        return { ok: false, error: 'Salesman not found' };
      }

      // Get target
      const { data: targets } = await dbClient
        .from('salesman_targets')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('salesman_id', salesmanId)
        .eq('period', thisMonth);

      const target = targets?.[0];

      // Get visits this month
      const { data: visits } = await dbClient
        .from('visits')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('salesman_id', salesmanId)
        .like('created_at', `${thisMonth}%`);

      // Get orders this month
      const { data: orders } = await dbClient
        .from('orders_new')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('salesman_id', salesmanId)
        .like('created_at', `${thisMonth}%`);

      // Calculate metrics
      const completedVisits = (visits || []).filter(v => v.status === 'completed').length;
      let totalRevenue = 0;
      let pendingOrders = 0;

      (orders || []).forEach(o => {
        if (o.status !== 'cancelled') {
          if (o.actual_amount) totalRevenue += o.actual_amount;
          if (o.status === 'pending' || o.status === 'draft') pendingOrders++;
        }
      });

      const detail = {
        salesman: {
          id: salesman.id,
          name: salesman.name,
          email: salesman.email,
          status: salesman.status
        },
        this_month: thisMonth,
        targets: target ? {
          visits_target: target.target_visits,
          visits_achieved: target.achieved_visits,
          visits_progress: Math.round((target.achieved_visits / target.target_visits) * 100),
          orders_target: target.target_orders,
          orders_achieved: target.achieved_orders,
          orders_progress: Math.round((target.achieved_orders / target.target_orders) * 100),
          revenue_target: target.target_revenue,
          revenue_achieved: target.achieved_revenue,
          revenue_progress: Math.round((target.achieved_revenue / target.target_revenue) * 100)
        } : null,
        activities: {
          total_visits: visits?.length || 0,
          completed_visits: completedVisits,
          pending_visits: (visits?.length || 0) - completedVisits,
          completion_rate: visits?.length > 0 ? Math.round((completedVisits / visits.length) * 100) : 0
        },
        orders: {
          total_orders: orders?.length || 0,
          pending_orders: pendingOrders,
          total_revenue: totalRevenue,
          average_order_value: orders?.length > 0 ? Math.round(totalRevenue / orders.length) : 0
        },
        recent_visits: (visits || []).slice(-5).map(v => ({
          id: v.id,
          customer_id: v.customer_id,
          status: v.status,
          created_at: v.created_at,
          products: v.products_discussed?.length || 0
        }))
      };

      return {
        ok: true,
        detail
      };

    } catch (error) {
      console.error('[DASHBOARD] Salesman detail error:', error);
      return {
        ok: false,
        error: error.message
      };
    }
  }

  /**
   * Get real-time alerts
   */
  async getAlerts(tenantId) {
    try {
      console.log('[DASHBOARD] Getting alerts');

      const now = new Date();
      const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      const today = now.toISOString().split('T')[0];

      const alerts = {
        critical: [],
        warning: [],
        info: []
      };

      // Get targets
      const { data: targets } = await dbClient
        .from('salesman_targets')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('period', thisMonth);

      // Check each salesman's progress
      (targets || []).forEach(target => {
        const visitProgress = (target.achieved_visits / target.target_visits) * 100;
        const revenueProgress = (target.achieved_revenue / target.target_revenue) * 100;

        // Critical alerts
        if (visitProgress < 30) {
          alerts.critical.push({
            salesman_id: target.salesman_id,
            type: 'low_visits',
            message: `Only ${Math.round(visitProgress)}% of monthly visit target achieved`,
            priority: 'high'
          });
        }

        if (revenueProgress < 30) {
          alerts.critical.push({
            salesman_id: target.salesman_id,
            type: 'low_revenue',
            message: `Only ${Math.round(revenueProgress)}% of monthly revenue target achieved`,
            priority: 'high'
          });
        }

        // Warning alerts
        if (visitProgress < 60 && visitProgress >= 30) {
          alerts.warning.push({
            salesman_id: target.salesman_id,
            type: 'behind_visits',
            message: `${Math.round(visitProgress)}% of visit target - needs acceleration`,
            priority: 'medium'
          });
        }
      });

      // Check for salesmen with no activity today
      const { data: todayVisits } = await dbClient
        .from('visits')
        .select('salesman_id, count')
        .eq('tenant_id', tenantId)
        .like('created_at', `${today}%`);

      const activeToday = new Set(todayVisits?.map(v => v.salesman_id) || []);

      const { data: allSalesmen } = await dbClient
        .from('sales_users')
        .select('id, name')
        .eq('tenant_id', tenantId)
        .eq('status', 'active');

      (allSalesmen || []).forEach(salesman => {
        if (!activeToday.has(salesman.id)) {
          alerts.info.push({
            salesman_id: salesman.id,
            type: 'no_activity',
            message: `${salesman.name} has no visits today`,
            priority: 'low'
          });
        }
      });

      return {
        ok: true,
        alerts
      };

    } catch (error) {
      console.error('[DASHBOARD] Alerts error:', error);
      return {
        ok: false,
        error: error.message
      };
    }
  }

  /**
   * Generate dashboard report
   */
  async generateReport(tenantId) {
    try {
      console.log('[DASHBOARD] Generating report');

      const overview = await this.getTeamOverview(tenantId);
      const analytics = await this.getPerformanceAnalytics(tenantId, 7);
      const alerts = await this.getAlerts(tenantId);

      if (!overview.ok || !analytics.ok || !alerts.ok) {
        return {
          ok: false,
          error: 'Failed to generate report'
        };
      }

      return {
        ok: true,
        report: {
          generated_at: new Date().toISOString(),
          overview: overview.overview,
          analytics: analytics.analytics,
          alerts: alerts.alerts,
          summary: {
            team_size: overview.overview.total_salesmen,
            top_performer: overview.overview.top_performers[0]?.name || 'N/A',
            at_risk_count: overview.overview.at_risk.length,
            this_week_revenue: analytics.analytics.summary.total_revenue,
            completion_rate: analytics.analytics.summary.completion_rate
          }
        }
      };

    } catch (error) {
      console.error('[DASHBOARD] Report error:', error);
      return {
        ok: false,
        error: error.message
      };
    }
  }
}

module.exports = new ManagerDashboardService();

