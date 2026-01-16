/**
 * Conversation Linking Service - Phase 2
 * Links field visits to customer conversations
 * Enriches conversations with visit context and field data
 */

const { dbClient } = require('./config');

class ConversationLinkingService {
  /**
   * Link a visit to a conversation
   */
  async linkVisitToConversation(tenantId, visitId, customerId) {
    try {
      console.log('[CONV_LINK] Linking visit to conversation:', visitId, 'Customer:', customerId);

      // Get visit details
      const visitResult = await dbClient
        .from('visits')
        .select('*')
        .eq('id', visitId)
        .single();

      if (visitResult.error || !visitResult.data) {
        return {
          ok: false,
          error: 'Visit not found'
        };
      }

      const visit = visitResult.data;

      // Get or create conversation for customer
      const conversationResult = await dbClient
        .from('conversations_new')
        .select('id')
        .eq('tenant_id', tenantId)
        .eq('customer_id', customerId)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      let conversationId;

      if (conversationResult.data) {
        conversationId = conversationResult.data.id;
      } else {
        // Create new conversation linked to visit
        const newConvResult = await dbClient
          .from('conversations_new')
          .insert({
            tenant_id: tenantId,
            customer_id: customerId,
            created_at: new Date().toISOString()
          })
          .select();

        if (newConvResult.error) {
          return {
            ok: false,
            error: 'Failed to create conversation'
          };
        }

        conversationId = newConvResult.data[0].id;
      }

      // Store visit context in conversation metadata
      const visitContext = {
        visit_id: visitId,
        visit_date: visit.visit_date,
        salesman_id: visit.salesman_id,
        salesman_name: visit.salesman_name,
        products_discussed: JSON.parse(visit.products_discussed || '[]'),
        potential: visit.potential,
        competitor_name: visit.competitor_name,
        can_be_switched: visit.can_be_switched,
        remarks: visit.remarks,
        next_action: JSON.parse(visit.next_action || '{}'),
        next_action_date: visit.next_action_date
      };

      // Update conversation with visit context
      const updateResult = await dbClient
        .from('conversations_new')
        .update({
          visit_context: JSON.stringify(visitContext),
          last_visit_date: visit.visit_date,
          updated_at: new Date().toISOString()
        })
        .eq('id', conversationId)
        .select();

      if (updateResult.error) {
        return {
          ok: false,
          error: 'Failed to update conversation'
        };
      }

      console.log('[CONV_LINK] Conversation linked:', conversationId);

      return {
        ok: true,
        conversation_id: conversationId,
        visit_context: visitContext,
        message: 'Visit linked to conversation'
      };

    } catch (error) {
      console.error('[CONV_LINK] Link error:', error);
      return {
        ok: false,
        error: error.message
      };
    }
  }

  /**
   * Get conversation context from visit
   */
  async getConversationFromVisit(visitId) {
    try {
      const visitResult = await dbClient
        .from('visits')
        .select(`
          *,
          customer:customer_id (id, name, email, phone),
          salesman:salesman_id (id, name, phone)
        `)
        .eq('id', visitId)
        .single();

      if (visitResult.error || !visitResult.data) {
        return {
          ok: false,
          error: 'Visit not found'
        };
      }

      const visit = visitResult.data;

      return {
        ok: true,
        context: {
          visit_id: visitId,
          customer: visit.customer,
          salesman: visit.salesman,
          visit_date: visit.visit_date,
          products_discussed: JSON.parse(visit.products_discussed || '[]'),
          potential: visit.potential,
          remarks: visit.remarks,
          next_action: JSON.parse(visit.next_action || '{}')
        }
      };

    } catch (error) {
      console.error('[CONV_LINK] Get context error:', error);
      return {
        ok: false,
        error: error.message
      };
    }
  }

  /**
   * Enrich conversation with visit data for AI context
   */
  async enrichConversationWithVisit(conversationId, visitId) {
    try {
      console.log('[CONV_LINK] Enriching conversation with visit data');

      // Get conversation
      const convResult = await dbClient
        .from('conversations_new')
        .select('*')
        .eq('id', conversationId)
        .single();

      if (convResult.error || !convResult.data) {
        return {
          ok: false,
          error: 'Conversation not found'
        };
      }

      const conversation = convResult.data;

      // Get visit
      const visitResult = await dbClient
        .from('visits')
        .select('*')
        .eq('id', visitId)
        .single();

      if (visitResult.error || !visitResult.data) {
        return {
          ok: false,
          error: 'Visit not found'
        };
      }

      const visit = visitResult.data;

      // Build enriched context
      const enrichedContext = {
        // Existing context
        ...JSON.parse(conversation.context || '{}'),
        // Add visit data
        recent_visit: {
          visit_id: visitId,
          visit_date: visit.visit_date,
          products_discussed: JSON.parse(visit.products_discussed || '[]'),
          potential: visit.potential,
          remarks: visit.remarks,
          next_action: JSON.parse(visit.next_action || '{}'),
          competitor_info: {
            competitor_name: visit.competitor_name,
            can_be_switched: visit.can_be_switched
          }
        }
      };

      // Build AI prompt context
      const aiContext = this.buildAIContext(conversation, enrichedContext);

      return {
        ok: true,
        enriched_context: enrichedContext,
        ai_context: aiContext,
        message: 'Conversation enriched with visit data'
      };

    } catch (error) {
      console.error('[CONV_LINK] Enrich error:', error);
      return {
        ok: false,
        error: error.message
      };
    }
  }

  /**
   * Build AI context from conversation and visit data
   */
  buildAIContext(conversation, context) {
    try {
      let aiPrompt = `Customer Context:\n`;

      // Add customer info
      if (context.customer_name) {
        aiPrompt += `- Name: ${context.customer_name}\n`;
      }

      if (context.customer_type) {
        aiPrompt += `- Type: ${context.customer_type}\n`;
      }

      // Add recent visit info
      if (context.recent_visit) {
        const visit = context.recent_visit;
        aiPrompt += `\nRecent Visit (${visit.visit_date}):\n`;
        aiPrompt += `- Potential: ${visit.potential}\n`;

        if (visit.products_discussed.length > 0) {
          aiPrompt += `- Products Discussed: ${visit.products_discussed.map(p => p.name || p.id).join(', ')}\n`;
        }

        if (visit.remarks) {
          aiPrompt += `- Notes: ${visit.remarks}\n`;
        }

        if (visit.next_action && visit.next_action.action) {
          aiPrompt += `- Next Action: ${visit.next_action.action}`;
          if (visit.next_action_date) {
            aiPrompt += ` (${visit.next_action_date})`;
          }
          aiPrompt += `\n`;
        }

        if (visit.competitor_info && visit.competitor_info.competitor_name) {
          aiPrompt += `- Competitor: ${visit.competitor_info.competitor_name}`;
          if (visit.competitor_info.can_be_switched) {
            aiPrompt += ` (potential switcher)`;
          }
          aiPrompt += `\n`;
        }
      }

      return aiPrompt;

    } catch (error) {
      console.error('[CONV_LINK] Build AI context error:', error);
      return '';
    }
  }

  /**
   * Get all conversations with recent visits
   */
  async getConversationsWithVisits(tenantId, filters = {}) {
    try {
      let query = dbClient
        .from('conversations_new')
        .select(`
          id,
          customer_id,
          context,
          created_at,
          updated_at,
          visits:visits (id, visit_date, potential, products_discussed)
        `)
        .eq('tenant_id', tenantId);

      if (filters.customer_id) {
        query = query.eq('customer_id', filters.customer_id);
      }

      const result = await query.order('updated_at', { ascending: false });

      if (result.error) {
        return {
          ok: false,
          error: result.error.message
        };
      }

      return {
        ok: true,
        conversations: result.data || [],
        count: result.data?.length || 0
      };

    } catch (error) {
      console.error('[CONV_LINK] Get conversations error:', error);
      return {
        ok: false,
        error: error.message
      };
    }
  }

  /**
   * Get customer context from all visits
   */
  async getCustomerContextFromVisits(tenantId, customerId) {
    try {
      console.log('[CONV_LINK] Getting customer context from visits');

      // Get all visits for customer
      const visitsResult = await dbClient
        .from('visits')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('customer_id', customerId)
        .order('visit_date', { ascending: false });

      const visits = visitsResult.data || [];

      if (visits.length === 0) {
        return {
          ok: true,
          context: {
            visits_count: 0,
            message: 'No visit history'
          }
        };
      }

      // Analyze visits
      const context = {
        visits_count: visits.length,
        last_visit_date: visits[0]?.visit_date,
        first_visit_date: visits[visits.length - 1]?.visit_date,
        sales_potential: visits[0]?.potential,
        products_interested: {},
        competitors: new Set(),
        follow_up_needed: false,
        average_visit_duration: 0,
        trends: {}
      };

      // Aggregate products mentioned
      let totalDuration = 0;
      visits.forEach((visit, index) => {
        const products = JSON.parse(visit.products_discussed || '[]');
        products.forEach(product => {
          const name = product.name || product.id;
          context.products_interested[name] = (context.products_interested[name] || 0) + 1;
        });

        totalDuration += visit.duration_minutes || 0;

        if (visit.competitor_name) {
          context.competitors.add(visit.competitor_name);
        }

        if (visit.next_action_date && !context.follow_up_needed) {
          const nextDate = new Date(visit.next_action_date);
          if (nextDate <= new Date()) {
            context.follow_up_needed = true;
          }
        }
      });

      context.average_visit_duration = Math.round(totalDuration / visits.length);
      context.competitors = Array.from(context.competitors);

      // Find top products
      context.top_products = Object.entries(context.products_interested)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([name, count]) => ({ name, mentions: count }));

      return {
        ok: true,
        context
      };

    } catch (error) {
      console.error('[CONV_LINK] Get customer context error:', error);
      return {
        ok: false,
        error: error.message
      };
    }
  }
}

module.exports = new ConversationLinkingService();

