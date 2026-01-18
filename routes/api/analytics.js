/**
 * Analytics & Reporting API Routes
 * Custom dashboards, KPIs, reports, exports
 */

const express = require('express');
const router = express.Router();
const { db } = require('../../services/config');
const AnalyticsService = require('../../services/analytics-service');
const crypto = require('crypto');

// ===== DASHBOARDS =====

/**
 * GET /api/analytics/dashboards
 * List all dashboards for tenant
 */
router.get('/dashboards', (req, res) => {
  try {
    const tenantId = req.query.tenant_id || 'default-tenant';
    const userId = req.query.user_id;
    
    let query = 'SELECT * FROM analytics_dashboards WHERE tenant_id = ?';
    let params = [tenantId];
    
    if (userId) {
      query += ' AND (visibility = ? OR created_by = ?)';
      params.push('public', userId);
    }
    
    query += ' ORDER BY created_at DESC';
    
    const dashboards = db.prepare(query).all(...params);
    
    res.json({
      success: true,
      dashboards: dashboards.map(d => ({
        ...d,
        layout_config: d.layout_config ? JSON.parse(d.layout_config) : null
      }))
    });
  } catch (error) {
    console.error('Error fetching dashboards:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/analytics/dashboards
 * Create new dashboard
 */
router.post('/dashboards', (req, res) => {
  try {
    const {
      tenantId = 'default-tenant',
      dashboardName,
      description,
      layoutConfig = {},
      refreshInterval = 300,
      visibility = 'private',
      createdBy
    } = req.body;
    
    const id = crypto.randomBytes(16).toString('hex');
    
    db.prepare(`
      INSERT INTO analytics_dashboards (
        id, tenant_id, dashboard_name, description, layout_config,
        refresh_interval, visibility, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, tenantId, dashboardName, description, JSON.stringify(layoutConfig),
      refreshInterval, visibility, createdBy || null
    );
    
    res.json({
      success: true,
      dashboard: {
        id,
        dashboardName,
        layoutConfig
      }
    });
  } catch (error) {
    console.error('Error creating dashboard:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/analytics/dashboards/:id
 * Get dashboard with widgets
 */
router.get('/dashboards/:id', (req, res) => {
  try {
    const { id } = req.params;
    const tenantId = req.query.tenant_id || 'default-tenant';
    
    const dashboard = db.prepare(`
      SELECT * FROM analytics_dashboards WHERE id = ? AND tenant_id = ?
    `).get(id, tenantId);
    
    if (!dashboard) {
      return res.status(404).json({ success: false, error: 'Dashboard not found' });
    }
    
    const widgets = db.prepare(`
      SELECT * FROM analytics_widgets WHERE dashboard_id = ?
    `).all(id);
    
    res.json({
      success: true,
      dashboard: {
        ...dashboard,
        layout_config: dashboard.layout_config ? JSON.parse(dashboard.layout_config) : null,
        widgets: widgets.map(w => ({
          ...w,
          widget_config: w.widget_config ? JSON.parse(w.widget_config) : null
        }))
      }
    });
  } catch (error) {
    console.error('Error fetching dashboard:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ===== WIDGETS =====

/**
 * POST /api/analytics/widgets
 * Add widget to dashboard
 */
router.post('/widgets', (req, res) => {
  try {
    const {
      dashboardId,
      widgetName,
      widgetType,
      dataSource,
      widgetConfig = {},
      position = 0,
      width = 12,
      height = 4,
      autoRefresh = true
    } = req.body;
    
    const id = crypto.randomBytes(16).toString('hex');
    
    db.prepare(`
      INSERT INTO analytics_widgets (
        id, dashboard_id, widget_name, widget_type, data_source,
        widget_config, position, width, height, auto_refresh
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, dashboardId, widgetName, widgetType, dataSource,
      JSON.stringify(widgetConfig), position, width, height, autoRefresh ? 1 : 0
    );
    
    res.json({
      success: true,
      widget: { id, widgetName, widgetType }
    });
  } catch (error) {
    console.error('Error creating widget:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/analytics/widgets/:id/data
 * Get data for widget
 */
router.get('/widgets/:id/data', (req, res) => {
  try {
    const { id } = req.params;
    const tenantId = req.query.tenant_id || 'default-tenant';
    const { period_start, period_end } = req.query;
    
    const widget = db.prepare('SELECT * FROM analytics_widgets WHERE id = ?').get(id);
    if (!widget) {
      return res.status(404).json({ success: false, error: 'Widget not found' });
    }
    
    let data = null;
    
    // Generate data based on widget type and data source
    switch (widget.data_source) {
      case 'sales_overview':
        data = AnalyticsService.getSalesOverview(tenantId, period_start, period_end);
        break;
      case 'sales_trend':
        data = AnalyticsService.getSalesByPeriod(tenantId, period_start, period_end, 'day');
        break;
      case 'top_products':
        data = AnalyticsService.getTopProducts(tenantId, period_start, period_end, 10);
        break;
      case 'customer_insights':
        data = AnalyticsService.getCustomerInsights(tenantId, period_start, period_end);
        break;
      case 'pipeline_funnel':
        const pipelineId = req.query.pipeline_id;
        data = AnalyticsService.getPipelineFunnel(tenantId, pipelineId);
        break;
      case 'user_performance':
        data = AnalyticsService.getUserPerformance(tenantId, period_start, period_end);
        break;
      default:
        data = { message: 'Data source not implemented' };
    }
    
    res.json({
      success: true,
      widget: {
        id: widget.id,
        name: widget.widget_name,
        type: widget.widget_type,
        dataSource: widget.data_source
      },
      data
    });
  } catch (error) {
    console.error('Error fetching widget data:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ===== KPIs =====

/**
 * GET /api/analytics/kpis
 * List all KPIs
 */
router.get('/kpis', (req, res) => {
  try {
    const tenantId = req.query.tenant_id || 'default-tenant';
    
    const kpis = db.prepare(`
      SELECT * FROM analytics_kpis WHERE tenant_id = ? AND is_active = 1
      ORDER BY kpi_category, kpi_name
    `).all(tenantId);
    
    res.json({
      success: true,
      kpis: kpis.map(kpi => ({
        ...kpi,
        calculation_config: kpi.calculation_config ? JSON.parse(kpi.calculation_config) : null
      }))
    });
  } catch (error) {
    console.error('Error fetching KPIs:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/analytics/kpis
 * Create new KPI
 */
router.post('/kpis', (req, res) => {
  try {
    const {
      tenantId = 'default-tenant',
      kpiName,
      kpiCategory,
      calculationType,
      calculationConfig = {},
      targetValue,
      targetPeriod = 'month',
      goodThreshold,
      warningThreshold,
      criticalThreshold,
      createdBy
    } = req.body;
    
    const id = crypto.randomBytes(16).toString('hex');
    
    db.prepare(`
      INSERT INTO analytics_kpis (
        id, tenant_id, kpi_name, kpi_category, calculation_type,
        calculation_config, target_value, target_period,
        good_threshold, warning_threshold, critical_threshold, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, tenantId, kpiName, kpiCategory, calculationType,
      JSON.stringify(calculationConfig), targetValue, targetPeriod,
      goodThreshold, warningThreshold, criticalThreshold, createdBy || null
    );
    
    res.json({
      success: true,
      kpi: { id, kpiName, kpiCategory }
    });
  } catch (error) {
    console.error('Error creating KPI:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/analytics/kpis/:id/calculate
 * Calculate KPI value
 */
router.post('/kpis/:id/calculate', (req, res) => {
  try {
    const { id } = req.params;
    const tenantId = req.body.tenant_id || 'default-tenant';
    const { period_start, period_end } = req.body;
    
    const result = AnalyticsService.calculateKPI(id, tenantId, period_start, period_end);
    
    if (!result) {
      return res.status(404).json({ success: false, error: 'KPI not found' });
    }
    
    res.json({
      success: true,
      kpi: result
    });
  } catch (error) {
    console.error('Error calculating KPI:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/analytics/kpis/:id/history
 * Get KPI historical values
 */
router.get('/kpis/:id/history', (req, res) => {
  try {
    const { id } = req.params;
    const { limit = 30 } = req.query;
    
    const history = db.prepare(`
      SELECT * FROM analytics_kpi_values
      WHERE kpi_id = ?
      ORDER BY period_end DESC
      LIMIT ?
    `).all(id, limit);
    
    res.json({
      success: true,
      history
    });
  } catch (error) {
    console.error('Error fetching KPI history:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ===== REPORTS =====

/**
 * GET /api/analytics/reports
 * List all reports
 */
router.get('/reports', (req, res) => {
  try {
    const tenantId = req.query.tenant_id || 'default-tenant';
    
    const reports = db.prepare(`
      SELECT * FROM analytics_reports WHERE tenant_id = ?
      ORDER BY created_at DESC
    `).all(tenantId);
    
    res.json({
      success: true,
      reports: reports.map(r => ({
        ...r,
        report_config: r.report_config ? JSON.parse(r.report_config) : null,
        schedule_config: r.schedule_config ? JSON.parse(r.schedule_config) : null
      }))
    });
  } catch (error) {
    console.error('Error fetching reports:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/analytics/reports
 * Create new report
 */
router.post('/reports', (req, res) => {
  try {
    const {
      tenantId = 'default-tenant',
      reportName,
      reportType,
      reportConfig = {},
      scheduleConfig = null,
      isScheduled = false,
      createdBy
    } = req.body;
    
    const id = crypto.randomBytes(16).toString('hex');
    
    db.prepare(`
      INSERT INTO analytics_reports (
        id, tenant_id, report_name, report_type, report_config,
        schedule_config, is_scheduled, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, tenantId, reportName, reportType, JSON.stringify(reportConfig),
      scheduleConfig ? JSON.stringify(scheduleConfig) : null,
      isScheduled ? 1 : 0, createdBy || null
    );
    
    res.json({
      success: true,
      report: { id, reportName, reportType }
    });
  } catch (error) {
    console.error('Error creating report:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/analytics/reports/:id/generate
 * Generate/run report
 */
router.post('/reports/:id/generate', (req, res) => {
  try {
    const { id } = req.params;
    const tenantId = req.body.tenant_id || 'default-tenant';
    const { period_start, period_end } = req.body;
    
    const report = db.prepare('SELECT * FROM analytics_reports WHERE id = ?').get(id);
    if (!report) {
      return res.status(404).json({ success: false, error: 'Report not found' });
    }
    
    let reportData = null;
    let status = 'completed';
    let errorMessage = null;
    
    try {
      // Generate report based on type
      switch (report.report_type) {
        case 'sales_summary':
          reportData = AnalyticsService.generateSalesSummary(tenantId, period_start, period_end);
          break;
        case 'pipeline_analysis':
          const pipelineId = req.body.pipeline_id;
          reportData = AnalyticsService.generatePipelineAnalysis(tenantId, pipelineId);
          break;
        default:
          reportData = { message: 'Report type not implemented' };
      }
    } catch (error) {
      status = 'failed';
      errorMessage = error.message;
    }
    
    // Save report run
    const runId = crypto.randomBytes(16).toString('hex');
    db.prepare(`
      INSERT INTO analytics_report_runs (
        id, report_id, tenant_id, status, result_data, error_message
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      runId, id, tenantId, status,
      reportData ? JSON.stringify(reportData) : null,
      errorMessage
    );
    
    res.json({
      success: status === 'completed',
      reportRun: {
        id: runId,
        reportId: id,
        status,
        data: reportData
      }
    });
  } catch (error) {
    console.error('Error generating report:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/analytics/reports/:id/runs
 * Get report execution history
 */
router.get('/reports/:id/runs', (req, res) => {
  try {
    const { id } = req.params;
    const { limit = 20 } = req.query;
    
    const runs = db.prepare(`
      SELECT 
        id, report_id, tenant_id, status, started_at, completed_at, error_message
      FROM analytics_report_runs
      WHERE report_id = ?
      ORDER BY started_at DESC
      LIMIT ?
    `).all(id, limit);
    
    res.json({
      success: true,
      runs
    });
  } catch (error) {
    console.error('Error fetching report runs:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ===== INSIGHTS =====

/**
 * POST /api/analytics/insights/generate
 * Generate AI insights
 */
router.post('/insights/generate', (req, res) => {
  try {
    const tenantId = req.body.tenant_id || 'default-tenant';
    const { period_start, period_end } = req.body;
    
    const insights = AnalyticsService.generateInsights(tenantId, period_start, period_end);
    
    res.json({
      success: true,
      insights
    });
  } catch (error) {
    console.error('Error generating insights:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/analytics/insights
 * Get recent insights
 */
router.get('/insights', (req, res) => {
  try {
    const tenantId = req.query.tenant_id || 'default-tenant';
    const { limit = 10, insight_type } = req.query;
    
    let query = 'SELECT * FROM analytics_insights WHERE tenant_id = ?';
    const params = [tenantId];
    
    if (insight_type) {
      query += ' AND insight_type = ?';
      params.push(insight_type);
    }
    
    query += ' ORDER BY generated_at DESC LIMIT ?';
    params.push(parseInt(limit));
    
    const insights = db.prepare(query).all(...params);
    
    res.json({
      success: true,
      insights
    });
  } catch (error) {
    console.error('Error fetching insights:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
