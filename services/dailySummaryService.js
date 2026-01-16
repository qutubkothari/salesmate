/**
 * Daily Summary Service - Phase 2
 * Generates daily WhatsApp summaries for field team performance
 * Sends summaries to management with key metrics
 */

const { dbClient } = require('./config');

class DailySummaryService {
  /**
   * Generate daily field summary for a tenant
   */
  async generateDailySummary(tenantId, date = null) {
    try {
      const dateStr = date || new Date().toISOString().split('T')[0];
      console.log('[SUMMARY] Generating daily summary for:', dateStr);

      // Get visits for the day
      const visitsResult = await dbClient
        .from('visits')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('visit_date', dateStr);

      const visits = visitsResult.data || [];

      // Get orders created from visits today
      const ordersResult = await dbClient
        .from('orders_new')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('source_type', 'field_visit')
        .gte('created_at', `${dateStr}T00:00:00`)
        .lt('created_at', `${dateStr}T23:59:59`);

      const orders = ordersResult.data || [];

      // Calculate metrics by salesman
      const salesmenMetrics = {};

      visits.forEach(visit => {
        if (!salesmenMetrics[visit.salesman_id]) {
          salesmenMetrics[visit.salesman_id] = {
            salesman_id: visit.salesman_id,
            visits: 0,
            completed_visits: 0,
            total_minutes: 0,
            high_potential: 0,
            medium_potential: 0,
            low_potential: 0,
            products_discussed: 0,
            customers_visited: new Set(),
            orders_created: 0,
            order_value: 0
          };
        }

        const metrics = salesmenMetrics[visit.salesman_id];
        metrics.visits += 1;
        if (visit.time_out) metrics.completed_visits += 1;
        metrics.total_minutes += visit.duration_minutes || 0;
        
        if (visit.potential === 'High') metrics.high_potential += 1;
        else if (visit.potential === 'Medium') metrics.medium_potential += 1;
        else if (visit.potential === 'Low') metrics.low_potential += 1;

        const products = JSON.parse(visit.products_discussed || '[]');
        metrics.products_discussed += products.length;
        metrics.customers_visited.add(visit.customer_id);
      });

      // Add order data
      orders.forEach(order => {
        if (salesmenMetrics[order.salesman_id]) {
          const metrics = salesmenMetrics[order.salesman_id];
          metrics.orders_created += 1;
          metrics.order_value += order.total_amount || 0;
        }
      });

      // Get salesman info
      const salesmenIds = Object.keys(salesmenMetrics);
      let salesmenInfo = {};

      if (salesmenIds.length > 0) {
        const salesmenResult = await dbClient
          .from('salesmen')
          .select('id, name, phone')
          .in('id', salesmenIds);

        salesmenResult.data?.forEach(salesman => {
          salesmenInfo[salesman.id] = salesman;
        });
      }

      // Build summary data
      const summary = {
        date: dateStr,
        total_visits: visits.length,
        completed_visits: visits.filter(v => v.time_out).length,
        total_field_hours: Math.round(visits.reduce((sum, v) => sum + (v.duration_minutes || 0), 0) / 60),
        total_unique_customers: new Set(visits.map(v => v.customer_id)).size,
        orders_created: orders.length,
        total_order_value: orders.reduce((sum, o) => sum + (o.total_amount || 0), 0),
        team_summary: [],
        highlights: []
      };

      // Build team summaries
      Object.values(salesmenMetrics).forEach(metrics => {
        const salesman = salesmenInfo[metrics.salesman_id];
        summary.team_summary.push({
          salesman_id: metrics.salesman_id,
          salesman_name: salesman?.name || 'Unknown',
          phone: salesman?.phone,
          visits: metrics.visits,
          completed: metrics.completed_visits,
          field_hours: Math.round(metrics.total_minutes / 60),
          high_potential_visits: metrics.high_potential,
          unique_customers: metrics.customers_visited.size,
          products_discussed: metrics.products_discussed,
          orders_created: metrics.orders_created,
          order_value: metrics.order_value
        });
      });

      // Generate highlights
      if (summary.total_visits > 0) {
        summary.highlights.push(`📊 ${summary.total_visits} visits made by team`);
      }

      if (summary.completed_visits > 0) {
        const completionRate = Math.round((summary.completed_visits / summary.total_visits) * 100);
        summary.highlights.push(`✅ ${completionRate}% visits completed (${summary.completed_visits}/${summary.total_visits})`);
      }

      if (summary.total_field_hours > 0) {
        summary.highlights.push(`⏱️  ${summary.total_field_hours} hours in field`);
      }

      if (summary.orders_created > 0) {
        summary.highlights.push(`🎯 ${summary.orders_created} orders created (₹${Math.round(summary.total_order_value).toLocaleString()})`);
      }

      // Find top performer
      const topPerformer = summary.team_summary.reduce((prev, current) => {
        return (prev.visits || 0) < (current.visits || 0) ? current : prev;
      }, {});

      if (topPerformer.salesman_name) {
        summary.highlights.push(`⭐ Top performer: ${topPerformer.salesman_name} (${topPerformer.visits} visits)`);
      }

      console.log('[SUMMARY] Summary generated:', summary);

      return {
        ok: true,
        summary
      };

    } catch (error) {
      console.error('[SUMMARY] Generate error:', error);
      return {
        ok: false,
        error: error.message
      };
    }
  }

  /**
   * Format summary for WhatsApp message
   */
  formatSummaryForWhatsApp(summary) {
    try {
      let message = `📅 *Daily Field Summary - ${summary.date}*\n\n`;

      // Highlights
      if (summary.highlights.length > 0) {
        message += `*Today's Highlights:*\n`;
        summary.highlights.forEach(highlight => {
          message += `${highlight}\n`;
        });
        message += '\n';
      }

      // Team breakdown
      if (summary.team_summary.length > 0) {
        message += `*Team Performance:*\n`;
        summary.team_summary.forEach(team => {
          if (team.visits > 0) {
            message += `\n🔹 *${team.salesman_name}*\n`;
            message += `   Visits: ${team.visits} (${team.completed}✓)\n`;
            message += `   Time: ${team.field_hours}h\n`;
            message += `   Customers: ${team.unique_customers}\n`;
            if (team.orders_created > 0) {
              message += `   Orders: ${team.orders_created} (₹${Math.round(team.order_value).toLocaleString()})\n`;
            }
          }
        });
      }

      return message;

    } catch (error) {
      console.error('[SUMMARY] Format error:', error);
      return null;
    }
  }

  /**
   * Send summary to management via WhatsApp
   */
  async sendSummaryToManagement(tenantId, summary, managementPhoneNumbers = []) {
    try {
      console.log('[SUMMARY] Sending to management:', managementPhoneNumbers.length, 'contacts');

      // If no phone numbers provided, get management users for tenant
      let phonesToNotify = managementPhoneNumbers;

      if (phonesToNotify.length === 0) {
        // Get tenant's manager/admin phone numbers
        const usersResult = await dbClient
          .from('users')
          .select('phone')
          .eq('tenant_id', tenantId)
          .in('role', ['admin', 'manager'])
          .neq('phone', null);

        phonesToNotify = (usersResult.data || [])
          .map(u => u.phone)
          .filter(p => p);
      }

      if (phonesToNotify.length === 0) {
        return {
          ok: false,
          error: 'No management phone numbers found'
        };
      }

      // Format message
      const message = this.formatSummaryForWhatsApp(summary);

      if (!message) {
        return {
          ok: false,
          error: 'Failed to format message'
        };
      }

      // Would send via WhatsApp integration here
      // For now, just log
      console.log('[SUMMARY] Message to send:\n', message);

      return {
        ok: true,
        sent_to: phonesToNotify.length,
        recipients: phonesToNotify,
        message,
        status: 'queued'
      };

    } catch (error) {
      console.error('[SUMMARY] Send error:', error);
      return {
        ok: false,
        error: error.message
      };
    }
  }

  /**
   * Get weekly summary
   */
  async getWeeklySummary(tenantId, endDate = null) {
    try {
      const end = endDate ? new Date(endDate) : new Date();
      const start = new Date(end);
      start.setDate(start.getDate() - 6);

      console.log('[SUMMARY] Generating weekly summary');

      const weekSummaries = [];
      const weekMetrics = {
        total_visits: 0,
        total_completed: 0,
        total_hours: 0,
        unique_customers: new Set(),
        total_orders: 0,
        total_revenue: 0,
        by_salesman: {}
      };

      // Get data for each day
      for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        const dateStr = d.toISOString().split('T')[0];
        const dailyResult = await this.generateDailySummary(tenantId, dateStr);

        if (dailyResult.ok && dailyResult.summary) {
          const daily = dailyResult.summary;
          weekSummaries.push(daily);

          // Aggregate
          weekMetrics.total_visits += daily.total_visits;
          weekMetrics.total_completed += daily.completed_visits;
          weekMetrics.total_hours += daily.total_field_hours;
          weekMetrics.total_orders += daily.orders_created;
          weekMetrics.total_revenue += daily.total_order_value;

          // Aggregate by salesman
          daily.team_summary.forEach(team => {
            if (!weekMetrics.by_salesman[team.salesman_id]) {
              weekMetrics.by_salesman[team.salesman_id] = {
                name: team.salesman_name,
                visits: 0,
                orders: 0,
                revenue: 0
              };
            }
            weekMetrics.by_salesman[team.salesman_id].visits += team.visits;
            weekMetrics.by_salesman[team.salesman_id].orders += team.orders_created;
            weekMetrics.by_salesman[team.salesman_id].revenue += team.order_value;
          });
        }
      }

      return {
        ok: true,
        week: {
          start: start.toISOString().split('T')[0],
          end: end.toISOString().split('T')[0],
          daily_summaries: weekSummaries,
          aggregate: weekMetrics
        }
      };

    } catch (error) {
      console.error('[SUMMARY] Weekly error:', error);
      return {
        ok: false,
        error: error.message
      };
    }
  }

  /**
   * Calculate average metrics for comparison
   */
  async getPerformanceComparison(tenantId, days = 7) {
    try {
      console.log('[SUMMARY] Calculating performance comparison');

      const end = new Date();
      const start = new Date(end);
      start.setDate(start.getDate() - days);

      const visitsResult = await dbClient
        .from('visits')
        .select('salesman_id, duration_minutes')
        .eq('tenant_id', tenantId)
        .gte('visit_date', start.toISOString().split('T')[0])
        .lte('visit_date', end.toISOString().split('T')[0]);

      const visits = visitsResult.data || [];

      const byWorkmanship = {};
      visits.forEach(visit => {
        if (!byWorkmanship[visit.salesman_id]) {
          byWorkmanship[visit.salesman_id] = {
            visit_count: 0,
            total_minutes: 0
          };
        }
        byWorkmanship[visit.salesman_id].visit_count += 1;
        byWorkmanship[visit.salesman_id].total_minutes += visit.duration_minutes || 0;
      });

      const totalVisits = visits.length;
      const avgVisitsPerSalesman = totalVisits > 0 ? Math.round(totalVisits / Object.keys(byWorkmanship).length) : 0;
      const avgMinutesPerVisit = totalVisits > 0 ? Math.round(visits.reduce((sum, v) => sum + (v.duration_minutes || 0), 0) / totalVisits) : 0;

      return {
        ok: true,
        comparison: {
          period_days: days,
          total_visits: totalVisits,
          avg_visits_per_salesman: avgVisitsPerSalesman,
          avg_minutes_per_visit: avgMinutesPerVisit,
          by_salesman: byWorkmanship
        }
      };

    } catch (error) {
      console.error('[SUMMARY] Comparison error:', error);
      return {
        ok: false,
        error: error.message
      };
    }
  }
}

module.exports = new DailySummaryService();

