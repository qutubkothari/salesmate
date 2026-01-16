/**
 * Target Sync Service - Phase 2
 * Syncs sales targets with broadcast messaging and AI context
 * Enriches broadcasts and AI responses with current target status
 */

const { dbClient } = require('./config');

class TargetSyncService {
  /**
   * Get current target status for AI context
   */
  async getTargetContextForAI(tenantId, salesmanId = null) {
    try {
      console.log('[TARGET_SYNC] Getting target context for AI');

      const now = new Date();
      const period = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

      let query = dbClient
        .from('salesman_targets')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('period', period);

      if (salesmanId) {
        query = query.eq('salesman_id', salesmanId);
      }

      const result = await query;

      if (result.error) {
        return {
          ok: false,
          error: result.error.message
        };
      }

      const targets = result.data || [];

      // Build AI context
      let aiContext = `📊 *Current Sales Targets (${period}):*\n\n`;

      if (targets.length === 0) {
        aiContext += 'No targets set for this period.';
        return { ok: true, context: aiContext, targets: [] };
      }

      targets.forEach(target => {
        const visitsPercent = target.target_visits > 0 
          ? Math.round((target.achieved_visits / target.target_visits) * 100) 
          : 0;
        const revenuePercent = target.target_revenue > 0 
          ? Math.round((target.achieved_revenue / target.target_revenue) * 100) 
          : 0;

        aiContext += `💼 Salesman: ${target.salesman_id}\n`;
        aiContext += `  • Visits: ${target.achieved_visits}/${target.target_visits} (${visitsPercent}%)\n`;
        aiContext += `  • Revenue: ₹${target.achieved_revenue}/${target.target_revenue} (${revenuePercent}%)\n`;
        aiContext += `  • Orders: ${target.achieved_orders}/${target.target_orders}\n\n`;
      });

      return {
        ok: true,
        context: aiContext,
        targets,
        period
      };

    } catch (error) {
      console.error('[TARGET_SYNC] Get context error:', error);
      return {
        ok: false,
        error: error.message
      };
    }
  }

  /**
   * Enrich broadcast with target context
   */
  async enrichBroadcastWithTargets(tenantId, broadcastMessage) {
    try {
      console.log('[TARGET_SYNC] Enriching broadcast with targets');

      // Get current targets
      const targetsResult = await this.getTargetContextForAI(tenantId);

      if (!targetsResult.ok) {
        return {
          ok: false,
          error: 'Failed to get targets'
        };
      }

      // Append target context to broadcast
      const enrichedMessage = `${broadcastMessage}\n\n${targetsResult.context}`;

      return {
        ok: true,
        original: broadcastMessage,
        enriched: enrichedMessage,
        target_context: targetsResult.context
      };

    } catch (error) {
      console.error('[TARGET_SYNC] Enrich error:', error);
      return {
        ok: false,
        error: error.message
      };
    }
  }

  /**
   * Sync targets to conversation context
   */
  async syncTargetsToConversation(tenantId, conversationId) {
    try {
      console.log('[TARGET_SYNC] Syncing targets to conversation');

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

      // Get target context
      const targetContext = await this.getTargetContextForAI(tenantId);

      if (!targetContext.ok) {
        return {
          ok: false,
          error: 'Failed to get target context'
        };
      }

      // Update conversation with target context
      const existingContext = JSON.parse(conversation.context || '{}');
      existingContext.target_context = targetContext.context;
      existingContext.target_context_updated_at = new Date().toISOString();

      const updateResult = await dbClient
        .from('conversations_new')
        .update({
          context: JSON.stringify(existingContext)
        })
        .eq('id', conversationId);

      if (updateResult.error) {
        return {
          ok: false,
          error: 'Failed to update conversation'
        };
      }

      return {
        ok: true,
        target_context: targetContext.context,
        message: 'Targets synced to conversation'
      };

    } catch (error) {
      console.error('[TARGET_SYNC] Sync to conversation error:', error);
      return {
        ok: false,
        error: error.message
      };
    }
  }

  /**
   * Get targets due for review
   */
  async getTargetsDueForReview(tenantId) {
    try {
      console.log('[TARGET_SYNC] Getting targets due for review');

      const now = new Date();
      const currentDay = now.getDate();
      const period = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

      // Get targets for current month
      const result = await dbClient
        .from('salesman_targets')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('period', period);

      if (result.error) {
        return {
          ok: false,
          error: result.error.message
        };
      }

      const targets = result.data || [];
      const review = {
        period,
        day: currentDay,
        on_track: [],
        at_risk: [],
        fallen_behind: []
      };

      targets.forEach(target => {
        const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
        const expectedProgress = (currentDay / daysInMonth) * 100;

        const visitProgress = target.target_visits > 0 
          ? (target.achieved_visits / target.target_visits) * 100 
          : 0;
        
        const revenueProgress = target.target_revenue > 0 
          ? (target.achieved_revenue / target.target_revenue) * 100 
          : 0;

        const avgProgress = (visitProgress + revenueProgress) / 2;
        const gap = expectedProgress - avgProgress;

        const targetStatus = {
          salesman_id: target.salesman_id,
          visits: {
            achieved: target.achieved_visits,
            target: target.target_visits,
            percent: Math.round(visitProgress)
          },
          revenue: {
            achieved: Math.round(target.achieved_revenue),
            target: Math.round(target.target_revenue),
            percent: Math.round(revenueProgress)
          },
          overall_percent: Math.round(avgProgress),
          expected_percent: Math.round(expectedProgress),
          gap: Math.round(gap)
        };

        if (gap <= 5) {
          review.on_track.push(targetStatus);
        } else if (gap <= 15) {
          review.at_risk.push(targetStatus);
        } else {
          review.fallen_behind.push(targetStatus);
        }
      });

      return {
        ok: true,
        review
      };

    } catch (error) {
      console.error('[TARGET_SYNC] Review error:', error);
      return {
        ok: false,
        error: error.message
      };
    }
  }

  /**
   * Generate target progress message for messaging
   */
  async generateTargetProgressMessage(tenantId) {
    try {
      console.log('[TARGET_SYNC] Generating target progress message');

      const reviewResult = await this.getTargetsDueForReview(tenantId);

      if (!reviewResult.ok) {
        return {
          ok: false,
          error: 'Failed to get target review'
        };
      }

      const review = reviewResult.review;
      let message = `📈 *Target Progress Report - ${review.period}*\n\n`;

      // Summary
      const totalSalesmen = review.on_track.length + review.at_risk.length + review.fallen_behind.length;
      message += `Team Status (Day ${review.day}):\n`;
      message += `  ✅ On Track: ${review.on_track.length}/${totalSalesmen}\n`;
      message += `  ⚠️  At Risk: ${review.at_risk.length}/${totalSalesmen}\n`;
      message += `  ❌ Behind: ${review.fallen_behind.length}/${totalSalesmen}\n\n`;

      // On track
      if (review.on_track.length > 0) {
        message += `*✅ Performing Well:*\n`;
        review.on_track.slice(0, 3).forEach(target => {
          message += `  • ${target.salesman_id}: ${target.overall_percent}% complete\n`;
        });
        message += '\n';
      }

      // At risk
      if (review.at_risk.length > 0) {
        message += `*⚠️  Needs Attention:*\n`;
        review.at_risk.forEach(target => {
          message += `  • ${target.salesman_id}: ${target.overall_percent}% (gap: ${target.gap}%)\n`;
        });
        message += '\n';
      }

      // Behind
      if (review.fallen_behind.length > 0) {
        message += `*❌ Urgent Action Required:*\n`;
        review.fallen_behind.forEach(target => {
          message += `  • ${target.salesman_id}: ${target.overall_percent}% (gap: ${target.gap}%)\n`;
        });
      }

      return {
        ok: true,
        message,
        review
      };

    } catch (error) {
      console.error('[TARGET_SYNC] Message generation error:', error);
      return {
        ok: false,
        error: error.message
      };
    }
  }

  /**
   * Sync all tenant targets daily
   */
  async syncAllTenantsTargets() {
    try {
      console.log('[TARGET_SYNC] Syncing targets for all tenants');

      // Get all tenants
      const tenantsResult = await dbClient
        .from('tenants')
        .select('id');

      if (tenantsResult.error) {
        return {
          ok: false,
          error: 'Failed to get tenants'
        };
      }

      const tenants = tenantsResult.data || [];
      const results = [];

      // Sync each tenant
      for (const tenant of tenants) {
        const syncResult = await this.generateTargetProgressMessage(tenant.id);
        results.push({
          tenant_id: tenant.id,
          synced: syncResult.ok
        });
      }

      console.log('[TARGET_SYNC] Sync complete for', results.length, 'tenants');

      return {
        ok: true,
        synced_tenants: results.length,
        results
      };

    } catch (error) {
      console.error('[TARGET_SYNC] Sync all error:', error);
      return {
        ok: false,
        error: error.message
      };
    }
  }
}

module.exports = new TargetSyncService();

