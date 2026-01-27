/**
 * Dashboard API Routes for Embedding Configuration
 * Allows users to switch between OpenAI and Hugging Face embeddings via UI
 */

const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { dbClient } = require('../../services/config');

/**
 * GET /api/dashboard/embedding-config/:tenantId
 * Get current embedding configuration and stats
 */
router.get('/embedding-config/:tenantId', async (req, res) => {
    const { tenantId } = req.params;

    try {
        // Read current .env setting
        const envPath = path.join(__dirname, '../../.env');
        const envContent = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf-8') : '';
        const useOpenAI = envContent.includes('USE_OPENAI_EMBEDDINGS=true');

        // Get embedding statistics
        const { data: embeddings, error } = await dbClient
            .from('website_embeddings')
            .select('embedding')
            .eq('tenant_id', tenantId)
            .limit(100); // Sample first 100 to check quality

        if (error) throw error;

        const totalEmbeddings = embeddings?.length || 0;
        
        // Check if embeddings are dummy values (all 0.01)
        let hasDummyEmbeddings = false;
        if (totalEmbeddings > 0) {
            // Check first embedding for dummy pattern
            const firstEmbedding = embeddings[0].embedding;
            if (Array.isArray(firstEmbedding)) {
                const isDummy = firstEmbedding.every(val => Math.abs(val - 0.01) < 0.001);
                hasDummyEmbeddings = isDummy;
            }
        }

        res.json({
            success: true,
            config: {
                useOpenAI,
                provider: useOpenAI ? 'OpenAI' : 'Hugging Face'
            },
            stats: {
                totalEmbeddings,
                hasDummyEmbeddings
            }
        });
    } catch (error) {
        console.error('[EmbeddingConfig] Error getting config:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to get embedding configuration'
        });
    }
});

/**
 * POST /api/dashboard/embedding-config/:tenantId
 * Update embedding provider (OpenAI vs Hugging Face)
 */
router.post('/embedding-config/:tenantId', async (req, res) => {
    const { tenantId } = req.params;
    const { useOpenAI } = req.body;

    try {
        console.log(`[EmbeddingConfig] Updating provider for tenant ${tenantId}: ${useOpenAI ? 'OpenAI' : 'Hugging Face'}`);

        // Update .env file
        const envPath = path.join(__dirname, '../../.env');
        let envContent = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf-8') : '';

        // Remove existing USE_OPENAI_EMBEDDINGS setting
        envContent = envContent.replace(/USE_OPENAI_EMBEDDINGS=.*/g, '');

        // Add new setting
        const newSetting = `USE_OPENAI_EMBEDDINGS=${useOpenAI ? 'true' : 'false'}`;
        
        if (envContent.trim()) {
            // Append to existing content
            if (!envContent.endsWith('\n')) envContent += '\n';
            envContent += newSetting + '\n';
        } else {
            // Create new content
            envContent = newSetting + '\n';
        }

        fs.writeFileSync(envPath, envContent, 'utf-8');

        // Update environment variable in current process
        process.env.USE_OPENAI_EMBEDDINGS = useOpenAI ? 'true' : 'false';

        console.log(`[EmbeddingConfig] Updated USE_OPENAI_EMBEDDINGS=${process.env.USE_OPENAI_EMBEDDINGS}`);

        res.json({
            success: true,
            message: `Switched to ${useOpenAI ? 'OpenAI' : 'Hugging Face'} embeddings`,
            config: {
                useOpenAI,
                provider: useOpenAI ? 'OpenAI' : 'Hugging Face'
            }
        });
    } catch (error) {
        console.error('[EmbeddingConfig] Error updating config:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to update embedding configuration'
        });
    }
});

/**
 * POST /api/dashboard/embedding-config/:tenantId/clear
 * Clear all embeddings for a tenant
 */
router.post('/embedding-config/:tenantId/clear', async (req, res) => {
    const { tenantId } = req.params;

    try {
        console.log(`[EmbeddingConfig] Clearing embeddings for tenant ${tenantId}`);

        const { error } = await dbClient
            .from('website_embeddings')
            .delete()
            .eq('tenant_id', tenantId);

        if (error) throw error;

        // Get count before deletion
        const { count, error: countError } = await dbClient
            .from('website_embeddings')
            .select('*', { count: 'exact', head: true })
            .eq('tenant_id', tenantId);

        res.json({
            success: true,
            deletedCount: count || 0,
            message: 'All embeddings cleared successfully'
        });
    } catch (error) {
        console.error('[EmbeddingConfig] Error clearing embeddings:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to clear embeddings'
        });
    }
});

module.exports = router;
