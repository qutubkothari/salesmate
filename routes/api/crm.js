const express = require('express');
const router = express.Router();

const crmAuthRouter = require('./crm/auth');
const crmUsersRouter = require('./crm/users');
const crmLeadsRouter = require('./crm/leads');
const crmLeadMergeRouter = require('./crm/leadMerge');
const crmAnalyticsRouter = require('./crm/analytics');
const crmIngestRouter = require('./crm/ingest');
const crmTriageRouter = require('./crm/triage');
const crmTemplatesRouter = require('./crm/templates');
const crmNotificationsRouter = require('./crm/notifications');
const crmAuditRouter = require('./crm/audit');
const crmSlaRouter = require('./crm/sla');
const crmFeaturesRouter = require('./crm/features');

router.use('/auth', crmAuthRouter);
router.use('/features', crmFeaturesRouter);
router.use('/users', crmUsersRouter);
router.use('/leads', crmLeadMergeRouter); // Mount first for /leads/find-duplicates, /leads/merge, /leads/bulk-update
router.use('/leads', crmLeadsRouter);
router.use('/analytics', crmAnalyticsRouter);
router.use('/ingest', crmIngestRouter);
router.use('/triage', crmTriageRouter);
router.use('/templates', crmTemplatesRouter);
router.use('/notifications', crmNotificationsRouter);
router.use('/audit', crmAuditRouter);
router.use('/sla', crmSlaRouter);

module.exports = router;

