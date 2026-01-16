/**
 * Target Service
 * Manages sales targets for field salesmen
 * Tracks monthly targets and achievements
 */

const { dbClient } = require('./config');
const crypto = require('crypto');

class TargetService {
  /**
   * Create or update monthly targets for a salesman
   */
  async setSalesmanTargets(tenantId, salesmanId, period, targetData) {
    try {
      console.log('[TARGET] Setting targets for:', salesmanId, 'Period:', period);

      // Check if target already exists
      const existing = await dbClient
        .from('salesman_targets')
        .select('id')
        .eq('salesman_id', salesmanId)
        .eq('period', period)
        .single();

      const targetRecord = {
        tenant_id: tenantId,
        salesman_id: salesmanId,
        plant_id: targetData.plant_id || null,
        period: period,  // YYYY-MM format
        target_visits: targetData.target_visits || 0,
        achieved_visits: 0,
        target_orders: targetData.target_orders || 0,
        achieved_orders: 0,
        target_revenue: targetData.target_revenue || 0,
        achieved_revenue: 0,
        target_new_customers: targetData.target_new_customers || 0,
        achieved_new_customers: 0,
        notes: targetData.notes || null,
        updated_at: new Date().toISOString()
      };

      let result;

      if (existing?.data) {
        // Update existing
        result = await dbClient
          .from('salesman_targets')
          .update(targetRecord)
          .eq('id', existing.data.id)
          .select();
      } else {
        // Insert new
        const id = `target_${crypto.randomBytes(8).toString('hex')}`;
        result = await dbClient
          .from('salesman_targets')
          .insert({
            id,
            ...targetRecord,
            created_at: new Date().toISOString()
          })
          .select();
      }

      if (result.error) {
        throw new Error(result.error.message);
      }

      console.log('[TARGET] Targets set for:', period);

      return {
        ok: true,
        target: result.data?.[0]
      };

    } catch (error) {
      console.error('[TARGET] Set targets error:', error);
      return {
        ok: false,
        error: error.message
      };
    }
  }

  /**
   * Get targets for a salesman for a specific period
   */
  async getSalesmanTargets(salesmanId, period) {
    try {
      console.log('[TARGET] Getting targets for:', salesmanId, 'Period:', period);

      const result = await dbClient
        .from('salesman_targets')
        .select(`
          *,
          salesman:salesman_id (id, name, phone),
          plant:plant_id (id, name)
        `)
        .eq('salesman_id', salesmanId)
        .eq('period', period)
        .single();

      if (result.error) {
        if (result.status === 406) {
          // Not found
          return {
            ok: true,
            target: null,
            message: 'No targets set for this period'
          };
        }
        throw new Error(result.error.message);
      }

      return {
        ok: true,
        target: result.data
      };

    } catch (error) {
      console.error('[TARGET] Get targets error:', error);
      return {
        ok: false,
        error: error.message
      };
    }
  }

  /**
   * Get all targets for a tenant in a period
   */
  async getTenantTargets(tenantId, period) {
    try {
      console.log('[TARGET] Getting all targets for tenant:', tenantId, 'Period:', period);

      const result = await dbClient
        .from('salesman_targets')
        .select(`
          *,
          salesman:salesman_id (id, name, phone),
          plant:plant_id (id, name)
        `)
        .eq('tenant_id', tenantId)
        .eq('period', period)
        .order('achieved_visits', { ascending: false });

      if (result.error) {
        throw new Error(result.error.message);
      }

      // Calculate aggregate metrics
      const targets = result.data || [];
      const aggregate = {
        total_salesmen: targets.length,
        total_target_visits: targets.reduce((sum, t) => sum + (t.target_visits || 0), 0),
        total_achieved_visits: targets.reduce((sum, t) => sum + (t.achieved_visits || 0), 0),
        total_target_revenue: targets.reduce((sum, t) => sum + (t.target_revenue || 0), 0),
        total_achieved_revenue: targets.reduce((sum, t) => sum + (t.achieved_revenue || 0), 0),
        visit_achievement_percent: 0,
        revenue_achievement_percent: 0
      };

      if (aggregate.total_target_visits > 0) {
        aggregate.visit_achievement_percent = Math.round(
          (aggregate.total_achieved_visits / aggregate.total_target_visits) * 100
        );
      }

      if (aggregate.total_target_revenue > 0) {
        aggregate.revenue_achievement_percent = Math.round(
          (aggregate.total_achieved_revenue / aggregate.total_target_revenue) * 100
        );
      }

      return {
        ok: true,
        targets,
        count: targets.length,
        aggregate
      };

    } catch (error) {
      console.error('[TARGET] Get tenant targets error:', error);
      return {
        ok: false,
        error: error.message
      };
    }
  }

  /**
   * Update achievement metrics when visit is completed
   */
  async recordVisitAchievement(tenantId, salesmanId, period, visitData) {
    try {
      console.log('[TARGET] Recording visit achievement for:', salesmanId);

      // Get current target
      const targetResult = await dbClient
        .from('salesman_targets')
        .select('*')
        .eq('salesman_id', salesmanId)
        .eq('period', period)
        .single();

      if (targetResult.error) {
        console.log('[TARGET] No target set for this period, skipping achievement update');
        return {
          ok: true,
          message: 'No target set for this period'
        };
      }

      const target = targetResult.data;

      // Increment achieved visits
      let newAchievedVisits = (target.achieved_visits || 0) + 1;
      let newAchievedOrders = target.achieved_orders || 0;
      let newAchievedRevenue = target.achieved_revenue || 0;
      let newAchievedNewCustomers = target.achieved_new_customers || 0;

      // If visit resulted in order, increment orders
      if (visitData.order_created) {
        newAchievedOrders += 1;
      }

      // Add revenue if provided
      if (visitData.revenue_amount) {
        newAchievedRevenue += visitData.revenue_amount;
      }

      // If new customer, increment
      if (visitData.is_new_customer) {
        newAchievedNewCustomers += 1;
      }

      // Update target
      const result = await dbClient
        .from('salesman_targets')
        .update({
          achieved_visits: newAchievedVisits,
          achieved_orders: newAchievedOrders,
          achieved_revenue: newAchievedRevenue,
          achieved_new_customers: newAchievedNewCustomers,
          updated_at: new Date().toISOString()
        })
        .eq('id', target.id)
        .select();

      if (result.error) {
        throw new Error(result.error.message);
      }

      const updatedTarget = result.data?.[0];

      // Calculate achievement percentages
      const achievements = {
        visits: {
          target: target.target_visits,
          achieved: newAchievedVisits,
          percentage: target.target_visits > 0 ? Math.round((newAchievedVisits / target.target_visits) * 100) : 0
        },
        orders: {
          target: target.target_orders,
          achieved: newAchievedOrders,
          percentage: target.target_orders > 0 ? Math.round((newAchievedOrders / target.target_orders) * 100) : 0
        },
        revenue: {
          target: target.target_revenue,
          achieved: newAchievedRevenue,
          percentage: target.target_revenue > 0 ? Math.round((newAchievedRevenue / target.target_revenue) * 100) : 0
        },
        new_customers: {
          target: target.target_new_customers,
          achieved: newAchievedNewCustomers,
          percentage: target.target_new_customers > 0 ? Math.round((newAchievedNewCustomers / target.target_new_customers) * 100) : 0
        }
      };

      console.log('[TARGET] Achievement recorded:', achievements);

      return {
        ok: true,
        target: updatedTarget,
        achievements
      };

    } catch (error) {
      console.error('[TARGET] Record achievement error:', error);
      return {
        ok: false,
        error: error.message
      };
    }
  }

  /**
   * Record order achievement
   */
  async recordOrderAchievement(tenantId, salesmanId, period, revenueAmount) {
    try {
      console.log('[TARGET] Recording order achievement for:', salesmanId);

      const targetResult = await dbClient
        .from('salesman_targets')
        .select('*')
        .eq('salesman_id', salesmanId)
        .eq('period', period)
        .single();

      if (targetResult.error) {
        console.log('[TARGET] No target set for this period');
        return { ok: true, message: 'No target set' };
      }

      const target = targetResult.data;

      const result = await dbClient
        .from('salesman_targets')
        .update({
          achieved_orders: (target.achieved_orders || 0) + 1,
          achieved_revenue: (target.achieved_revenue || 0) + revenueAmount,
          updated_at: new Date().toISOString()
        })
        .eq('id', target.id)
        .select();

      if (result.error) {
        throw new Error(result.error.message);
      }

      return {
        ok: true,
        target: result.data?.[0]
      };

    } catch (error) {
      console.error('[TARGET] Record order error:', error);
      return {
        ok: false,
        error: error.message
      };
    }
  }

  /**
   * Get performance summary using the salesman_performance view
   */
  async getPerformanceSummary(tenantId) {
    try {
      console.log('[TARGET] Getting performance summary');

      const result = await dbClient
        .from('salesman_performance')
        .select('*')
        .eq('tenant_id', tenantId)
        .order('visits_achievement_percent', { ascending: false });

      if (result.error) {
        throw new Error(result.error.message);
      }

      return {
        ok: true,
        performance: result.data || []
      };

    } catch (error) {
      console.error('[TARGET] Performance summary error:', error);
      return {
        ok: false,
        error: error.message
      };
    }
  }

  /**
   * Get targets for a plant (location/branch)
   */
  async getPlantTargets(tenantId, plantId, period) {
    try {
      console.log('[TARGET] Getting plant targets:', plantId);

      const result = await dbClient
        .from('salesman_targets')
        .select(`
          *,
          salesman:salesman_id (id, name, phone)
        `)
        .eq('tenant_id', tenantId)
        .eq('plant_id', plantId)
        .eq('period', period)
        .order('achieved_visits', { ascending: false });

      if (result.error) {
        throw new Error(result.error.message);
      }

      const targets = result.data || [];

      // Calculate plant-level metrics
      const metrics = {
        total_salesmen: targets.length,
        total_target_visits: targets.reduce((sum, t) => sum + (t.target_visits || 0), 0),
        total_achieved_visits: targets.reduce((sum, t) => sum + (t.achieved_visits || 0), 0),
        total_target_revenue: targets.reduce((sum, t) => sum + (t.target_revenue || 0), 0),
        total_achieved_revenue: targets.reduce((sum, t) => sum + (t.achieved_revenue || 0), 0)
      };

      if (metrics.total_target_visits > 0) {
        metrics.visit_achievement_percent = Math.round(
          (metrics.total_achieved_visits / metrics.total_target_visits) * 100
        );
      }

      if (metrics.total_target_revenue > 0) {
        metrics.revenue_achievement_percent = Math.round(
          (metrics.total_achieved_revenue / metrics.total_target_revenue) * 100
        );
      }

      return {
        ok: true,
        targets,
        metrics
      };

    } catch (error) {
      console.error('[TARGET] Get plant targets error:', error);
      return {
        ok: false,
        error: error.message
      };
    }
  }

  /**
   * Get target history for a salesman
   */
  async getSalesmanTargetHistory(salesmanId, months = 3) {
    try {
      console.log('[TARGET] Getting target history:', salesmanId);

      const result = await dbClient
        .from('salesman_targets')
        .select('*')
        .eq('salesman_id', salesmanId)
        .order('period', { ascending: false })
        .limit(months);

      if (result.error) {
        throw new Error(result.error.message);
      }

      return {
        ok: true,
        history: result.data || []
      };

    } catch (error) {
      console.error('[TARGET] Target history error:', error);
      return {
        ok: false,
        error: error.message
      };
    }
  }

  /**
   * Get current period (YYYY-MM format)
   */
  getCurrentPeriod() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  }

  /**
   * Get next period
   */
  getNextPeriod(period = null) {
    if (!period) {
      period = this.getCurrentPeriod();
    }

    const [year, month] = period.split('-');
    let nextMonth = parseInt(month) + 1;
    let nextYear = parseInt(year);

    if (nextMonth > 12) {
      nextMonth = 1;
      nextYear += 1;
    }

    return `${nextYear}-${String(nextMonth).padStart(2, '0')}`;
  }

  /**
   * Rollover targets from current period to next
   * Copies structure but resets achievements
   */
  async rolloverTargets(tenantId) {
    try {
      console.log('[TARGET] Rolling over targets');

      const currentPeriod = this.getCurrentPeriod();
      const nextPeriod = this.getNextPeriod(currentPeriod);

      // Get all current targets
      const currentResult = await dbClient
        .from('salesman_targets')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('period', currentPeriod);

      if (currentResult.error) {
        throw new Error(currentResult.error.message);
      }

      const targets = currentResult.data || [];

      // Create new targets for next period
      const newTargets = targets.map(t => ({
        id: `target_${crypto.randomBytes(8).toString('hex')}`,
        tenant_id: tenantId,
        salesman_id: t.salesman_id,
        plant_id: t.plant_id,
        period: nextPeriod,
        target_visits: t.target_visits,
        achieved_visits: 0,  // Reset achievement
        target_orders: t.target_orders,
        achieved_orders: 0,
        target_revenue: t.target_revenue,
        achieved_revenue: 0,
        target_new_customers: t.target_new_customers,
        achieved_new_customers: 0,
        notes: t.notes,
        created_at: new Date().toISOString()
      }));

      const result = await dbClient
        .from('salesman_targets')
        .insert(newTargets);

      if (result.error) {
        throw new Error(result.error.message);
      }

      console.log('[TARGET] Rollover complete:', newTargets.length, 'targets created');

      return {
        ok: true,
        new_period: nextPeriod,
        targets_created: newTargets.length
      };

    } catch (error) {
      console.error('[TARGET] Rollover error:', error);
      return {
        ok: false,
        error: error.message
      };
    }
  }
}

module.exports = new TargetService();

