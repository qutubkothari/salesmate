/**
 * Follow-up Sequences API Routes
 * 
 * Manages autonomous follow-up campaigns
 */

const express = require('express');
const router = express.Router();
const AutonomousFollowupService = require('../../services/autonomous-followup-service');
const { requireAuth: authenticateToken } = require('../../middleware/authMiddleware');

/**
 * GET /api/followup-sequences
 * List all sequences for tenant
 */
router.get('/', authenticateToken, async (req, res) => {
    try {
        const sequences = AutonomousFollowupService.listSequences(req.user.tenantId);
        res.json({ success: true, sequences });
    } catch (error) {
        console.error('[API] Error listing sequences:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * POST /api/followup-sequences
 * Create new sequence
 */
router.post('/', authenticateToken, async (req, res) => {
    try {
        const { name, type, description, targetCustomerType, targetDealStage } = req.body;

        if (!name) {
            return res.status(400).json({ success: false, error: 'Sequence name required' });
        }

        const result = AutonomousFollowupService.createSequence(
            req.user.tenantId,
            { name, type, description, targetCustomerType, targetDealStage },
            req.user.userId
        );

        res.json({ success: true, ...result });
    } catch (error) {
        console.error('[API] Error creating sequence:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * POST /api/followup-sequences/:sequenceId/steps
 * Add step to sequence
 */
router.post('/:sequenceId/steps', authenticateToken, async (req, res) => {
    try {
        const { sequenceId } = req.params;
        const { 
            stepNumber, name, delayDays, delayHours, sendTime, 
            skipWeekends, channel, subjectLine, messageBody, ctaText, ctaUrl 
        } = req.body;

        if (!channel || !messageBody) {
            return res.status(400).json({ success: false, error: 'Channel and message body required' });
        }

        const result = AutonomousFollowupService.addStep(
            req.user.tenantId,
            parseInt(sequenceId),
            {
                stepNumber: stepNumber || 1,
                name,
                delayDays,
                delayHours,
                sendTime,
                skipWeekends,
                channel,
                subjectLine,
                messageBody,
                ctaText,
                ctaUrl
            }
        );

        res.json({ success: true, ...result });
    } catch (error) {
        console.error('[API] Error adding step:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * POST /api/followup-sequences/:sequenceId/enroll
 * Enroll contact in sequence
 */
router.post('/:sequenceId/enroll', authenticateToken, async (req, res) => {
    try {
        const { sequenceId } = req.params;
        const { customerId, contactId, dealId, source } = req.body;

        if (!customerId) {
            return res.status(400).json({ success: false, error: 'Customer ID required' });
        }

        const result = AutonomousFollowupService.enrollContact(
            req.user.tenantId,
            parseInt(sequenceId),
            { customerId, contactId, dealId, source },
            req.user.userId
        );

        res.json({ success: true, ...result });
    } catch (error) {
        console.error('[API] Error enrolling contact:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/followup-sequences/:sequenceId/performance
 * Get sequence performance metrics
 */
router.get('/:sequenceId/performance', authenticateToken, async (req, res) => {
    try {
        const { sequenceId } = req.params;
        const performance = AutonomousFollowupService.getSequencePerformance(parseInt(sequenceId));
        res.json({ success: true, ...performance });
    } catch (error) {
        console.error('[API] Error getting performance:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * POST /api/followup-sequences/:sequenceId/pause
 * Pause sequence
 */
router.post('/:sequenceId/pause', authenticateToken, async (req, res) => {
    try {
        const { sequenceId } = req.params;
        AutonomousFollowupService.pauseSequence(req.user.tenantId, parseInt(sequenceId));
        res.json({ success: true, message: 'Sequence paused' });
    } catch (error) {
        console.error('[API] Error pausing sequence:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * POST /api/followup-sequences/:sequenceId/activate
 * Activate sequence
 */
router.post('/:sequenceId/activate', authenticateToken, async (req, res) => {
    try {
        const { sequenceId } = req.params;
        AutonomousFollowupService.activateSequence(req.user.tenantId, parseInt(sequenceId));
        res.json({ success: true, message: 'Sequence activated' });
    } catch (error) {
        console.error('[API] Error activating sequence:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * POST /api/followup-sequences/messages/:messageId/track/opened
 * Track message opened
 */
router.post('/messages/:messageId/track/opened', async (req, res) => {
    try {
        const { messageId } = req.params;
        AutonomousFollowupService.trackOpen(parseInt(messageId));
        res.json({ success: true });
    } catch (error) {
        console.error('[API] Error tracking open:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * POST /api/followup-sequences/messages/:messageId/track/clicked
 * Track message link clicked
 */
router.post('/messages/:messageId/track/clicked', async (req, res) => {
    try {
        const { messageId } = req.params;
        const { linkUrl } = req.body;
        AutonomousFollowupService.trackClick(parseInt(messageId), linkUrl);
        res.json({ success: true });
    } catch (error) {
        console.error('[API] Error tracking click:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * POST /api/followup-sequences/enrollments/:enrollmentId/convert
 * Mark enrollment as converted
 */
router.post('/enrollments/:enrollmentId/convert', authenticateToken, async (req, res) => {
    try {
        const { enrollmentId } = req.params;
        const { conversionValue } = req.body;
        
        AutonomousFollowupService.markConversion(parseInt(enrollmentId), conversionValue);
        res.json({ success: true, message: 'Conversion tracked' });
    } catch (error) {
        console.error('[API] Error tracking conversion:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
