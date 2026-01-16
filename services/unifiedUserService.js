/**
 * Unified User Service
 * Merges Salesmate users with FSM salesmen
 * Handles user creation, authentication, and salesman profile linking
 */

const { dbClient } = require('./config');
const crypto = require('crypto');

class UnifiedUserService {
  /**
   * Create a salesman (field staff) as a user with 'salesman' role
   * Also creates corresponding salesmen record for FSM
   */
  async createSalesman(tenantId, data) {
    try {
      console.log('[UNIFIED_USER] Creating salesman:', data.name);

      // Validate input
      if (!data.name || !data.phone) {
        throw new Error('Name and phone are required');
      }

      // Check if phone already exists
      const existing = await dbClient
        .from('salesmen')
        .select('id')
        .eq('tenant_id', tenantId)
        .eq('phone', data.phone)
        .single();

      if (existing?.data) {
        throw new Error('Salesman with this phone number already exists');
      }

      const salesmanId = `salesman_${crypto.randomBytes(8).toString('hex')}`;
      const userId = `user_${crypto.randomBytes(8).toString('hex')}`;

      // Start transaction-like operation
      // 1. Create user record
      const userInsert = await dbClient
        .from('users')
        .insert({
          id: userId,
          tenant_id: tenantId,
          email: data.email,
          name: data.name,
          phone: data.phone,
          role: 'salesman',  // FSM-specific role
          is_active: true,
          created_at: new Date().toISOString()
        });

      if (userInsert.error) {
        throw new Error(`Failed to create user: ${userInsert.error.message}`);
      }

      // 2. Create salesman record
      const salesmanInsert = await dbClient
        .from('salesmen')
        .insert({
          id: salesmanId,
          tenant_id: tenantId,
          user_id: userId,  // Link to user
          name: data.name,
          phone: data.phone,
          email: data.email,
          plant_id: data.plant_id || null,
          is_active: true,
          created_at: new Date().toISOString()
        });

      if (salesmanInsert.error) {
        // Rollback user creation if salesman creation fails
        await dbClient
          .from('users')
          .delete()
          .eq('id', userId);
        throw new Error(`Failed to create salesman: ${salesmanInsert.error.message}`);
      }

      console.log('[UNIFIED_USER] Salesman created:', salesmanId);

      return {
        ok: true,
        user_id: userId,
        salesman_id: salesmanId,
        message: 'Salesman created successfully'
      };

    } catch (error) {
      console.error('[UNIFIED_USER] Create error:', error);
      return {
        ok: false,
        error: error.message
      };
    }
  }

  /**
   * Get user with full context (user info + salesman info if applicable)
   */
  async getUserWithContext(userId) {
    try {
      console.log('[UNIFIED_USER] Fetching user context:', userId);

      // Get user info
      const userResult = await dbClient
        .from('users')
        .select('*')
        .eq('id', userId)
        .single();

      if (userResult.error || !userResult.data) {
        throw new Error('User not found');
      }

      const user = userResult.data;

      // If user is a salesman, fetch salesman details
      let salesmanData = null;
      if (user.role === 'salesman') {
        const salesmanResult = await dbClient
          .from('salesmen')
          .select(`
            *,
            plant:plant_id (id, name, city, timezone),
            current_target:salesman_targets (
              period,
              target_visits,
              achieved_visits,
              target_revenue,
              achieved_revenue
            )
          `)
          .eq('user_id', userId)
          .single();

        if (salesmanResult.data) {
          salesmanData = salesmanResult.data;
        }
      }

      // Return unified user object
      return {
        ok: true,
        user: {
          ...user,
          salesman_profile: salesmanData,
          is_field_staff: !!salesmanData
        }
      };

    } catch (error) {
      console.error('[UNIFIED_USER] Get context error:', error);
      return {
        ok: false,
        error: error.message
      };
    }
  }

  /**
   * Update user basic info
   */
  async updateUser(userId, data) {
    try {
      console.log('[UNIFIED_USER] Updating user:', userId);

      const updateData = {
        ...data,
        updated_at: new Date().toISOString()
      };

      // Remove fields that shouldn't be updated
      delete updateData.id;
      delete updateData.created_at;
      delete updateData.role;  // Prevent role change via this endpoint

      const result = await dbClient
        .from('users')
        .update(updateData)
        .eq('id', userId)
        .select();

      if (result.error) {
        throw new Error(result.error.message);
      }

      // If updating salesman-specific info, also update salesmen table
      if (data.salesman_info) {
        await dbClient
          .from('salesmen')
          .update({
            ...data.salesman_info,
            updated_at: new Date().toISOString()
          })
          .eq('user_id', userId);
      }

      return {
        ok: true,
        user: result.data?.[0]
      };

    } catch (error) {
      console.error('[UNIFIED_USER] Update error:', error);
      return {
        ok: false,
        error: error.message
      };
    }
  }

  /**
   * Update salesman location (GPS tracking)
   */
  async updateSalesmanLocation(salesmanId, latitude, longitude, accuracy = null) {
    try {
      console.log('[UNIFIED_USER] Updating location for:', salesmanId);

      const result = await dbClient
        .from('salesmen')
        .update({
          current_latitude: latitude,
          current_longitude: longitude,
          last_location_update: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .eq('id', salesmanId)
        .select();

      if (result.error) {
        throw new Error(result.error.message);
      }

      // Log activity for audit trail
      const salesman = result.data?.[0];
      if (salesman) {
        await this.logFieldActivity(salesman.tenant_id, salesmanId, 'location_update', {
          latitude,
          longitude,
          accuracy
        });
      }

      return {
        ok: true,
        salesman: result.data?.[0]
      };

    } catch (error) {
      console.error('[UNIFIED_USER] Location update error:', error);
      return {
        ok: false,
        error: error.message
      };
    }
  }

  /**
   * Get all salesmen for a tenant
   */
  async getSalesmenForTenant(tenantId, activeOnly = true) {
    try {
      console.log('[UNIFIED_USER] Fetching salesmen for tenant:', tenantId);

      let query = dbClient
        .from('salesmen')
        .select(`
          *,
          user:user_id (id, email, name, phone),
          plant:plant_id (id, name, city),
          targets:salesman_targets (
            period,
            target_visits,
            achieved_visits,
            target_revenue,
            achieved_revenue
          )
        `)
        .eq('tenant_id', tenantId);

      if (activeOnly) {
        query = query.eq('is_active', true);
      }

      const result = await query.order('name');

      if (result.error) {
        throw new Error(result.error.message);
      }

      return {
        ok: true,
        salesmen: result.data || [],
        count: result.data?.length || 0
      };

    } catch (error) {
      console.error('[UNIFIED_USER] Get salesmen error:', error);
      return {
        ok: false,
        error: error.message
      };
    }
  }

  /**
   * Deactivate salesman (soft delete)
   */
  async deactivateSalesman(salesmanId) {
    try {
      console.log('[UNIFIED_USER] Deactivating salesman:', salesmanId);

      // Update both users and salesmen tables
      const result = await dbClient
        .from('salesmen')
        .update({
          is_active: false,
          updated_at: new Date().toISOString()
        })
        .eq('id', salesmanId)
        .select();

      if (result.error) {
        throw new Error(result.error.message);
      }

      // Also deactivate the linked user
      const salesman = result.data?.[0];
      if (salesman?.user_id) {
        await dbClient
          .from('users')
          .update({ is_active: false })
          .eq('id', salesman.user_id);
      }

      return {
        ok: true,
        message: 'Salesman deactivated'
      };

    } catch (error) {
      console.error('[UNIFIED_USER] Deactivate error:', error);
      return {
        ok: false,
        error: error.message
      };
    }
  }

  /**
   * Get salesman performance summary
   */
  async getSalesmanPerformance(salesmanId, period = null) {
    try {
      console.log('[UNIFIED_USER] Getting performance for:', salesmanId);

      // Default to current month
      if (!period) {
        const now = new Date();
        period = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      }

      // Get target
      const targetResult = await dbClient
        .from('salesman_targets')
        .select('*')
        .eq('salesman_id', salesmanId)
        .eq('period', period)
        .single();

      // Get actual visits
      const startDate = `${period}-01`;
      const endDate = new Date(period + '-01');
      endDate.setMonth(endDate.getMonth() + 1);
      const endDateStr = endDate.toISOString().split('T')[0];

      const visitsResult = await dbClient
        .from('visits')
        .select('id, visit_date, duration_minutes, order_id, products_discussed')
        .eq('salesman_id', salesmanId)
        .gte('visit_date', startDate)
        .lt('visit_date', endDateStr);

      const visits = visitsResult.data || [];
      const target = targetResult.data;

      // Calculate metrics
      const performance = {
        period,
        visits: {
          target: target?.target_visits || 0,
          achieved: visits.length,
          percentage: target?.target_visits ? Math.round((visits.length / target.target_visits) * 100) : 0
        },
        orders: {
          target: target?.target_orders || 0,
          achieved: visits.filter(v => v.order_id).length,
          percentage: target?.target_orders ? Math.round((visits.filter(v => v.order_id).length / target.target_orders) * 100) : 0
        },
        revenue: {
          target: target?.target_revenue || 0,
          achieved: target?.achieved_revenue || 0,
          percentage: target?.target_revenue ? Math.round(((target?.achieved_revenue || 0) / target.target_revenue) * 100) : 0
        },
        field_time_minutes: visits.reduce((sum, v) => sum + (v.duration_minutes || 0), 0)
      };

      return {
        ok: true,
        performance
      };

    } catch (error) {
      console.error('[UNIFIED_USER] Performance error:', error);
      return {
        ok: false,
        error: error.message
      };
    }
  }

  /**
   * Log field activity for audit trail
   */
  async logFieldActivity(tenantId, salesmanId, activityType, activityData = {}) {
    try {
      const id = `activity_${crypto.randomBytes(8).toString('hex')}`;

      await dbClient
        .from('field_activity_log')
        .insert({
          id,
          tenant_id: tenantId,
          salesman_id: salesmanId,
          activity_type: activityType,
          activity_data: JSON.stringify(activityData),
          created_at: new Date().toISOString()
        });

      return { ok: true };

    } catch (error) {
      console.error('[UNIFIED_USER] Logging activity error:', error);
      return { ok: false };
    }
  }

  /**
   * Get team overview (all salesmen stats)
   */
  async getTeamOverview(tenantId) {
    try {
      console.log('[UNIFIED_USER] Getting team overview for:', tenantId);

      const salesmenResult = await this.getSalesmenForTenant(tenantId, true);
      
      if (!salesmenResult.ok) {
        throw new Error(salesmenResult.error);
      }

      // Get today's visits
      const today = new Date().toISOString().split('T')[0];
      const visitsResult = await dbClient
        .from('visits')
        .select('salesman_id, duration_minutes')
        .eq('tenant_id', tenantId)
        .eq('visit_date', today);

      const todayVisits = visitsResult.data || [];
      const visitsByTeam = {};
      let totalFieldMinutes = 0;

      todayVisits.forEach(v => {
        if (!visitsByTeam[v.salesman_id]) {
          visitsByTeam[v.salesman_id] = 0;
        }
        visitsByTeam[v.salesman_id]++;
        totalFieldMinutes += v.duration_minutes || 0;
      });

      const overview = {
        total_salesmen: salesmenResult.salesmen.length,
        active_salesmen: salesmenResult.salesmen.filter(s => s.is_active).length,
        today_visits: todayVisits.length,
        total_field_minutes: totalFieldMinutes,
        average_visits_per_person: salesmenResult.salesmen.length > 0 ? Math.round(todayVisits.length / salesmenResult.salesmen.length * 10) / 10 : 0,
        team_members: salesmenResult.salesmen.map(s => ({
          id: s.id,
          name: s.name,
          phone: s.phone,
          plant: s.plant?.name,
          today_visits: visitsByTeam[s.id] || 0,
          is_active: s.is_active
        }))
      };

      return {
        ok: true,
        overview
      };

    } catch (error) {
      console.error('[UNIFIED_USER] Team overview error:', error);
      return {
        ok: false,
        error: error.message
      };
    }
  }
}

module.exports = new UnifiedUserService();

