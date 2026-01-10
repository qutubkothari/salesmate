const express = require('express');
const router = express.Router();
const { dbClient } = require('../../config/database');
const { getLearningInsights } = require('../../services/aiConversationContextService');

/**
 * Dashboard for AI Context Analysis Learning
 * Shows how well the AI is performing and where it needs improvement
 */

// Get learning insights
router.get('/ai-learning', async (req, res) => {
    try {
        const insights = await getLearningInsights();
        
        // Get overall stats
        const { data: stats } = await dbClient
            .from('ai_context_analysis_log')
            .select('outcome_correct, ai_confidence')
            .not('outcome_correct', 'is', null);
        
        const totalAnalyzed = stats?.length || 0;
        const correctCount = stats?.filter(s => s.outcome_correct === true).length || 0;
        const incorrectCount = stats?.filter(s => s.outcome_correct === false).length || 0;
        const accuracy = totalAnalyzed > 0 ? ((correctCount / totalAnalyzed) * 100).toFixed(2) : 0;
        const avgConfidence = stats && stats.length > 0 
            ? (stats.reduce((sum, s) => sum + parseFloat(s.ai_confidence || 0), 0) / stats.length).toFixed(2)
            : 0;
        
        // Get recent analyses
        const { data: recentAnalyses } = await dbClient
            .from('ai_context_analysis_log')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(50);
        
        // Get insights view
        const { data: performanceByIntent } = await dbClient
            .from('ai_context_learning_insights')
            .select('*')
            .order('occurrence_count', { ascending: false });
        
        res.json({
            success: true,
            summary: {
                totalAnalyzed,
                correctCount,
                incorrectCount,
                accuracy: `${accuracy}%`,
                avgConfidence
            },
            insights,
            performanceByIntent,
            recentAnalyses: recentAnalyses?.slice(0, 20).map(a => ({
                message: a.message,
                state: a.conversation_state,
                aiIntent: a.ai_intent,
                aiAction: a.ai_action,
                confidence: a.ai_confidence,
                reasoning: a.ai_reasoning,
                outcome: a.outcome_correct === true ? 'âœ… Correct' : a.outcome_correct === false ? 'âŒ Incorrect' : 'â³ Pending',
                timestamp: a.created_at
            }))
        });
    } catch (error) {
        console.error('[AI_LEARNING_DASHBOARD] Error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Mark an analysis as correct
router.post('/ai-learning/:id/mark-correct', async (req, res) => {
    try {
        const { id } = req.params;
        const { outcome } = req.body;
        
        await dbClient
            .from('ai_context_analysis_log')
            .update({
                outcome_correct: true,
                actual_outcome: outcome || 'User confirmed correct behavior',
                updated_at: new Date().toISOString()
            })
            .eq('id', id);
        
        res.json({ success: true, message: 'Analysis marked as correct' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Mark an analysis as incorrect
router.post('/ai-learning/:id/mark-incorrect', async (req, res) => {
    try {
        const { id } = req.params;
        const { actualIntent, actualAction } = req.body;
        
        await dbClient
            .from('ai_context_analysis_log')
            .update({
                outcome_correct: false,
                actual_intent: actualIntent,
                actual_action: actualAction,
                updated_at: new Date().toISOString()
            })
            .eq('id', id);
        
        res.json({ success: true, message: 'Analysis marked as incorrect - AI will learn from this' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;

