/**
 * Dashboard API Routes for Website Content Management
 * Handles crawling, embedding, and searching website content
 */

const express = require('express');
const router = express.Router();
const { dbClient } = require('../../services/config');
const { crawlWebsite, crawlMultipleUrls, crawlEntireWebsite, parseSitemap, normalizeUrl } = require('../../services/webCrawlerService');
const { processWebsiteContent, deleteWebsiteEmbeddings } = require('../../services/websiteEmbeddingService');
const { 
    searchWebsiteContent, 
    getCrawledUrls, 
    getEmbeddingStats,
    findProductInfo 
} = require('../../services/websiteSearchService');

/**
 * POST /api/dashboard/website-content/crawl/:tenantId
 * Crawl a website URL and create embeddings
 */
router.post('/website-content/crawl/:tenantId', async (req, res) => {
    const { tenantId } = req.params;
    const { url, options = {} } = req.body;

    if (!url) {
        return res.status(400).json({ error: 'URL is required' });
    }

    try {
        console.log(`[Dashboard] Starting crawl for tenant ${tenantId}: ${url}`);

        // Create crawl job
        const { data: job, error: jobError } = await dbClient
            .from('crawl_jobs')
            .insert({
                tenant_id: tenantId,
                url: normalizeUrl(url),
                status: 'processing'
            })
            .select()
            .single();

        if (jobError) throw jobError;

        // Crawl the website
        const crawlResult = await crawlWebsite(url, {
            timeout: options.timeout || 10000,
            contentSelectors: options.contentSelectors,
            excludeSelectors: options.excludeSelectors
        });

        if (!crawlResult.success) {
            // Update job as failed
            await dbClient
                .from('crawl_jobs')
                .update({
                    status: 'failed',
                    error_message: crawlResult.error,
                    completed_at: new Date()
                })
                .eq('id', job.id);

            return res.status(400).json({
                success: false,
                error: crawlResult.error
            });
        }

        // Process and create embeddings
        const embeddingResult = await processWebsiteContent(crawlResult, tenantId);

        // Update job as completed
        await dbClient
            .from('crawl_jobs')
            .update({
                status: 'completed',
                pages_crawled: 1,
                chunks_created: embeddingResult.chunksCreated,
                completed_at: new Date()
            })
            .eq('id', job.id);

        res.json({
            success: true,
            jobId: job.id,
            url: crawlResult.url,
            pageTitle: crawlResult.pageTitle,
            chunksCreated: embeddingResult.chunksCreated,
            wordCount: crawlResult.wordCount
        });

    } catch (error) {
        console.error('[Dashboard] Error crawling website:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * POST /api/dashboard/website-content/crawl-all/:tenantId
 * Crawl entire website recursively (all pages and subpages)
 */
router.post('/website-content/crawl-all/:tenantId', async (req, res) => {
    const { tenantId } = req.params;
    const { url, options = {} } = req.body;

    if (!url) {
        return res.status(400).json({ error: 'URL is required' });
    }

    try {
        console.log(`[Dashboard] Starting full website crawl for tenant ${tenantId}: ${url}`);

        // Create master job
        const { data: masterJob, error: jobError } = await dbClient
            .from('crawl_jobs')
            .insert({
                tenant_id: tenantId,
                url: normalizeUrl(url),
                status: 'processing'
            })
            .select()
            .single();

        if (jobError) throw jobError;

        // Try sitemap first for faster discovery
        let urlsToCrawl = [];
        if (options.useSitemap !== false) {
            console.log(`[Dashboard] Attempting to parse sitemap for ${url}`);
            urlsToCrawl = await parseSitemap(url);
            
            if (urlsToCrawl.length > 0) {
                console.log(`[Dashboard] Found ${urlsToCrawl.length} URLs in sitemap`);
            }
        }

        // If no sitemap or sitemap disabled, use recursive crawling
        let crawlResults = [];
        if (urlsToCrawl.length === 0) {
            console.log(`[Dashboard] Using recursive crawling (no sitemap found)`);
            
            crawlResults = await crawlEntireWebsite(url, {
                maxDepth: options.maxDepth || 3,
                maxPages: options.maxPages || 100,
                delayBetweenRequests: options.delayBetweenRequests || 1000,
                contentSelectors: options.contentSelectors,
                excludeSelectors: options.excludeSelectors,
                excludePatterns: options.excludePatterns || ['/login', '/logout', '/admin', '/cart', '/checkout']
            });
        } else {
            // Crawl URLs from sitemap
            const maxUrls = options.maxPages || 100;
            const urlsToProcess = urlsToCrawl.slice(0, maxUrls);
            
            for (const pageUrl of urlsToProcess) {
                const result = await crawlWebsite(pageUrl, {
                    contentSelectors: options.contentSelectors,
                    excludeSelectors: options.excludeSelectors
                });
                
                if (result.success) {
                    crawlResults.push(result);
                }
                
                // Respectful delay
                await new Promise(resolve => setTimeout(resolve, options.delayBetweenRequests || 1000));
            }
        }

        // Process all crawled pages and create embeddings
        let totalChunks = 0;
        let successfulPages = 0;
        const processedUrls = [];

        for (const crawlResult of crawlResults) {
            try {
                const embeddingResult = await processWebsiteContent(crawlResult, tenantId);
                totalChunks += embeddingResult.chunksCreated;
                successfulPages++;
                processedUrls.push({
                    url: crawlResult.url,
                    title: crawlResult.pageTitle,
                    chunks: embeddingResult.chunksCreated
                });
            } catch (error) {
                console.error(`[Dashboard] Error processing ${crawlResult.url}:`, error.message);
            }
        }

        // Update master job
        await dbClient
            .from('crawl_jobs')
            .update({
                status: 'completed',
                pages_crawled: successfulPages,
                chunks_created: totalChunks,
                completed_at: new Date()
            })
            .eq('id', masterJob.id);

        console.log(`[Dashboard] Full crawl complete: ${successfulPages} pages, ${totalChunks} chunks`);

        res.json({
            success: true,
            jobId: masterJob.id,
            pagesCrawled: successfulPages,
            totalChunks,
            urls: processedUrls
        });

    } catch (error) {
        console.error('[Dashboard] Error in full website crawl:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * POST /api/dashboard/website-content/crawl-batch/:tenantId
 * Crawl multiple URLs at once
 */
router.post('/website-content/crawl-batch/:tenantId', async (req, res) => {
    const { tenantId } = req.params;
    const { urls, options = {} } = req.body;

    if (!urls || !Array.isArray(urls) || urls.length === 0) {
        return res.status(400).json({ error: 'URLs array is required' });
    }

    try {
        const results = [];

        for (const url of urls) {
            // Create job
            const { data: job } = await dbClient
                .from('crawl_jobs')
                .insert({
                    tenant_id: tenantId,
                    url: normalizeUrl(url),
                    status: 'processing'
                })
                .select()
                .single();

            // Crawl
            const crawlResult = await crawlWebsite(url, options);

            if (crawlResult.success) {
                const embeddingResult = await processWebsiteContent(crawlResult, tenantId);
                
                await dbClient
                    .from('crawl_jobs')
                    .update({
                        status: 'completed',
                        pages_crawled: 1,
                        chunks_created: embeddingResult.chunksCreated,
                        completed_at: new Date()
                    })
                    .eq('id', job.id);

                results.push({
                    url,
                    success: true,
                    chunksCreated: embeddingResult.chunksCreated
                });
            } else {
                await dbClient
                    .from('crawl_jobs')
                    .update({
                        status: 'failed',
                        error_message: crawlResult.error,
                        completed_at: new Date()
                    })
                    .eq('id', job.id);

                results.push({
                    url,
                    success: false,
                    error: crawlResult.error
                });
            }

            // Delay between requests
            await new Promise(resolve => setTimeout(resolve, 1000));
        }

        res.json({
            success: true,
            totalUrls: urls.length,
            results
        });

    } catch (error) {
        console.error('[Dashboard] Error in batch crawl:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * GET /api/dashboard/website-content/list/:tenantId
 * Get all crawled URLs for tenant
 */
router.get('/website-content/list/:tenantId', async (req, res) => {
    const { tenantId } = req.params;

    try {
        const urls = await getCrawledUrls(tenantId);
        
        res.json({
            success: true,
            urls,
            count: urls.length
        });

    } catch (error) {
        console.error('[Dashboard] Error listing URLs:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * GET /api/dashboard/website-content/stats/:tenantId
 * Get statistics about embeddings
 */
router.get('/website-content/stats/:tenantId', async (req, res) => {
    const { tenantId } = req.params;

    try {
        const stats = await getEmbeddingStats(tenantId);
        
        res.json({
            success: true,
            stats
        });

    } catch (error) {
        console.error('[Dashboard] Error getting stats:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /api/dashboard/website-content/search/:tenantId
 * Search website content
 */
router.post('/website-content/search/:tenantId', async (req, res) => {
    const { tenantId } = req.params;
    const { query, contentType, limit = 5, minSimilarity = 0.7 } = req.body;

    if (!query) {
        return res.status(400).json({ error: 'Query is required' });
    }

    try {
        const results = await searchWebsiteContent(query, tenantId, {
            limit,
            contentType,
            minSimilarity
        });

        res.json({
            success: true,
            query,
            results,
            count: results.length
        });

    } catch (error) {
        console.error('[Dashboard] Error searching:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * DELETE /api/dashboard/website-content/:tenantId
 * Delete embeddings for a URL
 */
router.delete('/website-content/:tenantId', async (req, res) => {
    const { tenantId } = req.params;
    const { url } = req.body;

    if (!url) {
        return res.status(400).json({ error: 'URL is required' });
    }

    try {
        const result = await deleteWebsiteEmbeddings(url, tenantId);
        
        res.json({
            success: true,
            deletedCount: result.deletedCount
        });

    } catch (error) {
        console.error('[Dashboard] Error deleting embeddings:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * GET /api/dashboard/website-content/jobs/:tenantId
 * Get crawl job history
 */
router.get('/website-content/jobs/:tenantId', async (req, res) => {
    const { tenantId } = req.params;
    const { limit = 20 } = req.query;

    try {
        const { data, error } = await dbClient
            .from('crawl_jobs')
            .select('*')
            .eq('tenant_id', tenantId)
            .order('created_at', { ascending: false })
            .limit(parseInt(limit));

        if (error) throw error;

        res.json({
            success: true,
            jobs: data,
            count: data.length
        });

    } catch (error) {
        console.error('[Dashboard] Error getting jobs:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * GET /api/dashboard/website-content/product/:tenantId/:productCode
 * Find product information from website content
 */
router.get('/website-content/product/:tenantId/:productCode', async (req, res) => {
    const { tenantId, productCode } = req.params;

    try {
        const results = await findProductInfo(productCode, tenantId);
        
        res.json({
            success: true,
            productCode,
            results,
            count: results.length
        });

    } catch (error) {
        console.error('[Dashboard] Error finding product info:', error);
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;


