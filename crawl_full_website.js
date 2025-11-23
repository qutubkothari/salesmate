/**
 * Crawl entire website with all subpages
 */

const { crawlEntireWebsite, parseSitemap } = require('./services/webCrawlerService');
const { processWebsiteContent } = require('./services/websiteEmbeddingService');
const { supabase } = require('./services/config');

async function crawlFullWebsite() {
    const tenantId = 'a10aa26a-b5f9-4afe-87cc-70bfb4d1f6e6';
    const websiteUrl = 'https://www.sakfasteners.com/';
    
    console.log('===========================================');
    console.log('FULL WEBSITE CRAWL');
    console.log('===========================================\n');
    console.log('Website:', websiteUrl);
    console.log('Max pages: 100');
    console.log('Max depth: 3');
    console.log('Tenant:', tenantId);
    console.log('\n-------------------------------------------\n');
    
    // Create crawl job
    const { data: job, error: jobError } = await supabase
        .from('crawl_jobs')
        .insert({
            tenant_id: tenantId,
            url: websiteUrl,
            status: 'processing'
        })
        .select()
        .single();
    
    if (jobError) {
        console.error('Failed to create job:', jobError.message);
        return;
    }
    
    console.log('Job created:', job.id);
    console.log('\n-------------------------------------------\n');
    
    // Try sitemap first
    console.log('Step 1: Checking for sitemap...');
    let urlsToCrawl = await parseSitemap(websiteUrl);
    
    if (urlsToCrawl.length > 0) {
        console.log(`✅ Found sitemap with ${urlsToCrawl.length} URLs`);
        urlsToCrawl = urlsToCrawl.slice(0, 100); // Limit to 100
        console.log(`Processing ${urlsToCrawl.length} URLs...\n`);
    } else {
        console.log('No sitemap found, using recursive crawling...\n');
    }
    
    // Crawl all pages
    let crawlResults = [];
    
    if (urlsToCrawl.length > 0) {
        // Crawl from sitemap
        console.log('Step 2: Crawling pages from sitemap...\n');
        
        for (let i = 0; i < urlsToCrawl.length; i++) {
            const url = urlsToCrawl[i];
            console.log(`[${i + 1}/${urlsToCrawl.length}] Crawling: ${url}`);
            
            const { crawlWebsite } = require('./services/webCrawlerService');
            const result = await crawlWebsite(url, {
                timeout: 10000,
                contentSelectors: null,
                excludeSelectors: ['script', 'style', 'nav', 'header', 'footer']
            });
            
            if (result.success) {
                crawlResults.push(result);
                console.log(`    ✅ ${result.wordCount} words extracted`);
            } else {
                console.log(`    ❌ Failed: ${result.error}`);
            }
            
            // Respectful delay
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
    } else {
        // Recursive crawl
        console.log('Step 2: Recursively crawling website...\n');
        
        crawlResults = await crawlEntireWebsite(websiteUrl, {
            maxDepth: 3,
            maxPages: 100,
            delayBetweenRequests: 1000,
            excludePatterns: ['/login', '/logout', '/admin', '/cart', '/checkout']
        }, (progress) => {
            console.log(`Progress: ${progress.currentPage} pages crawled, ${progress.totalFound} found, depth ${progress.depth}`);
        });
    }
    
    console.log(`\n-------------------------------------------`);
    console.log(`Crawled ${crawlResults.length} pages successfully`);
    console.log(`-------------------------------------------\n`);
    
    // Process and save embeddings
    console.log('Step 3: Generating embeddings and saving to database...\n');
    
    let totalChunks = 0;
    let successfulPages = 0;
    
    for (let i = 0; i < crawlResults.length; i++) {
        const crawlResult = crawlResults[i];
        console.log(`[${i + 1}/${crawlResults.length}] Processing: ${crawlResult.pageTitle}`);
        
        try {
            const embeddingResult = await processWebsiteContent(crawlResult, tenantId);
            totalChunks += embeddingResult.chunksCreated;
            successfulPages++;
            console.log(`    ✅ ${embeddingResult.chunksCreated} chunks saved`);
        } catch (error) {
            console.log(`    ❌ Failed: ${error.message}`);
        }
    }
    
    // Update job
    await supabase
        .from('crawl_jobs')
        .update({
            status: 'completed',
            pages_crawled: successfulPages,
            chunks_created: totalChunks,
            completed_at: new Date()
        })
        .eq('id', job.id);
    
    console.log('\n===========================================');
    console.log('CRAWL COMPLETE!');
    console.log('===========================================');
    console.log(`✅ Pages crawled: ${successfulPages}`);
    console.log(`✅ Total chunks: ${totalChunks}`);
    console.log(`✅ Job ID: ${job.id}`);
    console.log('===========================================\n');
    
    // Show summary
    const { data: allChunks } = await supabase
        .from('website_embeddings')
        .select('url, page_title')
        .eq('tenant_id', tenantId);
    
    const uniqueUrls = [...new Set(allChunks.map(c => c.url))];
    
    console.log('Total URLs in database:', uniqueUrls.length);
    console.log('Total chunks in database:', allChunks.length);
    console.log('\nYour website content is now searchable! 🎉');
}

crawlFullWebsite().catch(error => {
    console.error('Crawl failed:', error);
    process.exit(1);
});
