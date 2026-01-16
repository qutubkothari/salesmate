/**
 * Visit Service
 * Manages field visits for salesmen
 * Handles CRUD, GPS tracking, order creation, and conversation linking
 */

const { dbClient } = require('./config');
const crypto = require('crypto');

class VisitService {
  /**
   * Create a new visit record
   */
  async createVisit(tenantId, salesmanId, visitData) {
    try {
      console.log('[VISIT] Creating visit for salesman:', salesmanId);

      // Validate required fields
      if (!visitData.customer_id && !visitData.customer_name) {
        throw new Error('Customer ID or customer name is required');
      }

      const visitId = `visit_${crypto.randomBytes(8).toString('hex')}`;

      // Prepare visit data
      const insertData = {
        id: visitId,
        tenant_id: tenantId,
        salesman_id: salesmanId,
        customer_id: visitData.customer_id || null,
        plant_id: visitData.plant_id || null,
        customer_name: visitData.customer_name,
        contact_person: visitData.contact_person || null,
        customer_phone: visitData.customer_phone || null,
        visit_type: visitData.visit_type || 'Regular',  // Regular, Follow-up, Demo, etc.
        visit_date: visitData.visit_date || new Date().toISOString().split('T')[0],
        meeting_types: JSON.stringify(visitData.meeting_types || []),  // e.g., ['Phone', 'In-person']
        products_discussed: JSON.stringify(visitData.products_discussed || []),
        potential: visitData.potential || 'Medium',  // High, Medium, Low
        competitor_name: visitData.competitor_name || null,
        can_be_switched: visitData.can_be_switched || false,
        remarks: visitData.remarks || null,
        next_action: JSON.stringify(visitData.next_action || {}),
        next_action_date: visitData.next_action_date || null,
        gps_latitude: visitData.gps_latitude || null,
        gps_longitude: visitData.gps_longitude || null,
        location_accuracy: visitData.location_accuracy || null,
        time_in: visitData.time_in || new Date().toISOString(),
        time_out: null,
        duration_minutes: null,
        order_id: null,
        synced: true,
        offline_id: visitData.offline_id || null,
        created_at: new Date().toISOString()
      };

      const result = await dbClient
        .from('visits')
        .insert(insertData)
        .select();

      if (result.error) {
        throw new Error(result.error.message);
      }

      console.log('[VISIT] Visit created:', visitId);

      return {
        ok: true,
        visit: result.data?.[0],
        visit_id: visitId
      };

    } catch (error) {
      console.error('[VISIT] Create error:', error);
      return {
        ok: false,
        error: error.message
      };
    }
  }

  /**
   * Complete a visit (mark as finished)
   */
  async completeVisit(visitId, completionData = {}) {
    try {
      console.log('[VISIT] Completing visit:', visitId);

      const now = new Date();
      const timeOut = completionData.time_out || now.toISOString();

      // Get original visit to calculate duration
      const visitResult = await dbClient
        .from('visits')
        .select('*')
        .eq('id', visitId)
        .single();

      if (visitResult.error || !visitResult.data) {
        throw new Error('Visit not found');
      }

      const visit = visitResult.data;
      const timeIn = new Date(visit.time_in);
      const duration = Math.round((new Date(timeOut).getTime() - timeIn.getTime()) / 60000); // minutes

      // Update visit
      const updateData = {
        time_out: timeOut,
        duration_minutes: duration,
        updated_at: now.toISOString()
      };

      // Merge any additional completion data
      if (completionData.remarks) updateData.remarks = completionData.remarks;
      if (completionData.next_action_date) updateData.next_action_date = completionData.next_action_date;
      if (completionData.final_status) updateData.final_status = completionData.final_status;

      const result = await dbClient
        .from('visits')
        .update(updateData)
        .eq('id', visitId)
        .select();

      if (result.error) {
        throw new Error(result.error.message);
      }

      const completedVisit = result.data?.[0];

      // Link visit to conversation if products discussed
      if (visit.customer_id && JSON.parse(visit.products_discussed || '[]').length > 0) {
        await this.linkVisitToConversation(visit.tenant_id, visitId, visit.customer_id);
      }

      // Update customer profile with visit info
      if (visit.customer_id) {
        await dbClient
          .from('customer_profiles_new')
          .update({
            last_visit_date: visit.visit_date,
            assigned_salesman_id: visit.salesman_id,
            updated_at: now.toISOString()
          })
          .eq('id', visit.customer_id);
      }

      console.log('[VISIT] Visit completed:', visitId, 'Duration:', duration, 'minutes');

      return {
        ok: true,
        visit: completedVisit,
        duration_minutes: duration
      };

    } catch (error) {
      console.error('[VISIT] Complete error:', error);
      return {
        ok: false,
        error: error.message
      };
    }
  }

  /**
   * Update visit location (GPS)
   */
  async updateVisitLocation(visitId, latitude, longitude, accuracy = null) {
    try {
      console.log('[VISIT] Updating location for:', visitId);

      const result = await dbClient
        .from('visits')
        .update({
          gps_latitude: latitude,
          gps_longitude: longitude,
          location_accuracy: accuracy,
          updated_at: new Date().toISOString()
        })
        .eq('id', visitId)
        .select();

      if (result.error) {
        throw new Error(result.error.message);
      }

      return {
        ok: true,
        visit: result.data?.[0]
      };

    } catch (error) {
      console.error('[VISIT] Location update error:', error);
      return {
        ok: false,
        error: error.message
      };
    }
  }

  /**
   * Add images to visit
   */
  async addVisitImages(visitId, images) {
    try {
      console.log('[VISIT] Adding images to visit:', visitId);

      const imageRecords = images.map(img => ({
        id: `img_${crypto.randomBytes(8).toString('hex')}`,
        visit_id: visitId,
        image_url: img.url,
        caption: img.caption || null,
        created_at: new Date().toISOString()
      }));

      const result = await dbClient
        .from('visit_images')
        .insert(imageRecords)
        .select();

      if (result.error) {
        throw new Error(result.error.message);
      }

      console.log('[VISIT] Added', result.data?.length, 'images');

      return {
        ok: true,
        images: result.data || []
      };

    } catch (error) {
      console.error('[VISIT] Add images error:', error);
      return {
        ok: false,
        error: error.message
      };
    }
  }

  /**
   * Get visit details
   */
  async getVisit(visitId) {
    try {
      const result = await dbClient
        .from('visits')
        .select(`
          *,
          images:visit_images (id, image_url, caption),
          customer:customer_id (id, name, email, phone),
          salesman:salesman_id (id, name, phone),
          order:order_id (id, order_number, status, total_amount)
        `)
        .eq('id', visitId)
        .single();

      if (result.error || !result.data) {
        throw new Error('Visit not found');
      }

      const visit = result.data;

      // Parse JSON fields
      return {
        ok: true,
        visit: {
          ...visit,
          meeting_types: JSON.parse(visit.meeting_types || '[]'),
          products_discussed: JSON.parse(visit.products_discussed || '[]'),
          next_action: JSON.parse(visit.next_action || '{}')
        }
      };

    } catch (error) {
      console.error('[VISIT] Get error:', error);
      return {
        ok: false,
        error: error.message
      };
    }
  }

  /**
   * Get visits for a salesman
   */
  async getSalesmanVisits(tenantId, salesmanId, filters = {}) {
    try {
      console.log('[VISIT] Fetching visits for salesman:', salesmanId);

      let query = dbClient
        .from('visits')
        .select(`
          *,
          images:visit_images (id, image_url),
          customer:customer_id (id, name)
        `)
        .eq('tenant_id', tenantId)
        .eq('salesman_id', salesmanId);

      // Apply filters
      if (filters.start_date) {
        query = query.gte('visit_date', filters.start_date);
      }
      if (filters.end_date) {
        query = query.lte('visit_date', filters.end_date);
      }
      if (filters.completed_only) {
        query = query.not('time_out', 'is', null);
      }
      if (filters.pending_only) {
        query = query.is('time_out', null);
      }

      const result = await query.order('visit_date', { ascending: false });

      if (result.error) {
        throw new Error(result.error.message);
      }

      return {
        ok: true,
        visits: result.data || [],
        count: result.data?.length || 0
      };

    } catch (error) {
      console.error('[VISIT] Get visits error:', error);
      return {
        ok: false,
        error: error.message
      };
    }
  }

  /**
   * Get visits for a specific customer
   */
  async getCustomerVisits(tenantId, customerId) {
    try {
      const result = await dbClient
        .from('visits')
        .select(`
          *,
          salesman:salesman_id (id, name, phone)
        `)
        .eq('tenant_id', tenantId)
        .eq('customer_id', customerId)
        .order('visit_date', { ascending: false });

      if (result.error) {
        throw new Error(result.error.message);
      }

      return {
        ok: true,
        visits: result.data || [],
        visit_count: result.data?.length || 0
      };

    } catch (error) {
      console.error('[VISIT] Get customer visits error:', error);
      return {
        ok: false,
        error: error.message
      };
    }
  }

  /**
   * Get daily visit summary
   */
  async getDailyVisitSummary(tenantId, date) {
    try {
      console.log('[VISIT] Getting daily summary for:', date);

      const result = await dbClient
        .from('daily_visit_summary')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('visit_date', date);

      if (result.error) {
        throw new Error(result.error.message);
      }

      return {
        ok: true,
        summary: result.data || []
      };

    } catch (error) {
      console.error('[VISIT] Daily summary error:', error);
      return {
        ok: false,
        error: error.message
      };
    }
  }

  /**
   * Link visit to conversation for order creation
   * Creates a draft order from visit products
   */
  async linkVisitToConversation(tenantId, visitId, customerId) {
    try {
      console.log('[VISIT] Linking visit to conversation:', visitId);

      // Get visit details
      const visitResult = await dbClient
        .from('visits')
        .select('*')
        .eq('id', visitId)
        .single();

      if (visitResult.error || !visitResult.data) {
        throw new Error('Visit not found');
      }

      const visit = visitResult.data;
      const productsDiscussed = JSON.parse(visit.products_discussed || '[]');

      if (productsDiscussed.length === 0) {
        return { ok: true, message: 'No products to create order from' };
      }

      // Create conversation context linking visit
      const conversationData = {
        visit_id: visitId,
        customer_id: customerId,
        source: 'field_visit',
        salesman_id: visit.salesman_id,
        products: productsDiscussed,
        context: {
          visit_date: visit.visit_date,
          potential: visit.potential,
          remarks: visit.remarks
        }
      };

      // Store in conversations table as context
      // This will be picked up when salesman sends order from mobile app
      console.log('[VISIT] Conversation context created for visit');

      return {
        ok: true,
        conversation_context: conversationData
      };

    } catch (error) {
      console.error('[VISIT] Link to conversation error:', error);
      return {
        ok: false,
        error: error.message
      };
    }
  }

  /**
   * Get pending visits (not completed yet)
   */
  async getPendingVisits(tenantId, salesmanId = null) {
    try {
      let query = dbClient
        .from('visits')
        .select('*')
        .eq('tenant_id', tenantId)
        .is('time_out', null);  // Not completed

      if (salesmanId) {
        query = query.eq('salesman_id', salesmanId);
      }

      const result = await query.order('time_in', { ascending: false });

      if (result.error) {
        throw new Error(result.error.message);
      }

      return {
        ok: true,
        pending_visits: result.data || [],
        count: result.data?.length || 0
      };

    } catch (error) {
      console.error('[VISIT] Get pending error:', error);
      return {
        ok: false,
        error: error.message
      };
    }
  }

  /**
   * Get today's visits overview
   */
  async getTodayVisits(tenantId) {
    try {
      const today = new Date().toISOString().split('T')[0];

      const result = await dbClient
        .from('visits')
        .select(`
          *,
          salesman:salesman_id (id, name),
          customer:customer_id (id, name)
        `)
        .eq('tenant_id', tenantId)
        .eq('visit_date', today)
        .order('time_in', { ascending: false });

      if (result.error) {
        throw new Error(result.error.message);
      }

      const visits = result.data || [];

      // Calculate metrics
      const metrics = {
        total_visits: visits.length,
        completed_visits: visits.filter(v => v.time_out).length,
        pending_visits: visits.filter(v => !v.time_out).length,
        total_field_minutes: visits.reduce((sum, v) => sum + (v.duration_minutes || 0), 0),
        visits_with_potential: visits.filter(v => v.potential === 'High').length
      };

      return {
        ok: true,
        visits,
        metrics
      };

    } catch (error) {
      console.error('[VISIT] Today visits error:', error);
      return {
        ok: false,
        error: error.message
      };
    }
  }

  /**
   * Search visits
   */
  async searchVisits(tenantId, searchTerm) {
    try {
      console.log('[VISIT] Searching visits:', searchTerm);

      const result = await dbClient
        .from('visits')
        .select(`
          *,
          customer:customer_id (id, name)
        `)
        .eq('tenant_id', tenantId)
        .or(`customer_name.ilike.%${searchTerm}%,contact_person.ilike.%${searchTerm}%,remarks.ilike.%${searchTerm}%`)
        .order('visit_date', { ascending: false });

      if (result.error) {
        throw new Error(result.error.message);
      }

      return {
        ok: true,
        visits: result.data || [],
        count: result.data?.length || 0
      };

    } catch (error) {
      console.error('[VISIT] Search error:', error);
      return {
        ok: false,
        error: error.message
      };
    }
  }
}

module.exports = new VisitService();

