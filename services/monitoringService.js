// Add to services/monitoringService.js
const monitoringService = {
  // Track broadcast success rates
  trackBroadcastMetrics: async (campaignId, batchSize, successCount, failureCount) => {
    const metrics = {
      campaign_id: campaignId,
      batch_size: batchSize,
      success_count: successCount,
      failure_count: failureCount,
      success_rate: (successCount / (successCount + failureCount)) * 100,
      timestamp: new Date()
    };
    
    await dbClient.from('broadcast_metrics').insert(metrics);
    
    // Alert if success rate drops below 95%
    if (metrics.success_rate < 95) {
      await this.sendAlert('Low broadcast success rate', metrics);
    }
  },
  
  // Monitor API usage and costs
  trackAPIUsage: async (service, tokens, cost) => {
    // Track OpenAI, WhatsApp API usage
  }
};
