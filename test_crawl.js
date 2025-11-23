/**
 * Test script to verify website crawling and embedding storage
 */

const { crawlWebsite } = require('./services/webCrawlerService');
const { processWebsiteContent } = require('./services/websiteEmbeddingService');
const { supabase } = require('./services/config');

async function testCrawl() {
    const tenantId = 'a10aa26a-b5f9-4afe-87cc-70bfb4d1f6e6';
    const testUrl = 'https://www.sakfasteners.com/';
    
    console.log('===========================================');
    console.log('WEBSITE CRAWL TEST');
    console.log('===========================================\n');
    
    // Step 1: Check if tables exist
    console.log('Step 1: Checking database tables...');
    const { data: embeddings, error: embError } = await supabase
        .from('website_embeddings')
        .select('count');
    
    if (embError) {
        console.error('❌ website_embeddings table error:', embError.message);
        console.log('\n⚠️  You need to run the migration first!');
        console.log('Run this in Supabase SQL Editor:');
        console.log('migrations/create_website_embeddings.sql\n');
        return;
    }
    
    console.log('✅ website_embeddings table exists');
    console.log(`   Current rows: ${embeddings[0].count}\n`);
    
    // Step 2: Test crawling
    console.log('Step 2: Crawling test URL:', testUrl);
    const crawlResult = await crawlWebsite(testUrl, {
        timeout: 10000,
        maxDepth: 0
    });
    
    if (!crawlResult.success) {
        console.error('❌ Crawl failed:', crawlResult.error);
        return;
    }
    
    console.log('✅ Crawl successful!');
    console.log(`   Page title: ${crawlResult.pageTitle}`);
    console.log(`   Content length: ${crawlResult.content.length} chars`);
    console.log(`   Word count: ${crawlResult.wordCount}`);
    console.log(`   Product codes found: ${crawlResult.productCodes.join(', ') || 'None'}\n`);
    
    // Step 3: Test embedding generation
    console.log('Step 3: Generating embeddings...');
    try {
        const embeddingResult = await processWebsiteContent(crawlResult, tenantId);
        
        console.log('✅ Embeddings created successfully!');
        console.log(`   Chunks created: ${embeddingResult.chunksCreated}`);
        console.log(`   Embedding IDs: ${embeddingResult.embeddingIds.slice(0, 3).join(', ')}...`);
    } catch (embError) {
        console.error('❌ Embedding creation failed:', embError.message);
        console.error('   Stack:', embError.stack);
        return;
    }
    
    // Step 4: Verify data in database
    console.log('\nStep 4: Verifying data in database...');
    const { data: savedEmbeddings, error: verifyError } = await supabase
        .from('website_embeddings')
        .select('id, url, page_title, chunk_index, content_type')
        .eq('tenant_id', tenantId)
        .eq('url', testUrl)
        .order('chunk_index');
    
    if (verifyError) {
        console.error('❌ Verification failed:', verifyError.message);
        return;
    }
    
    console.log(`✅ Found ${savedEmbeddings.length} chunks in database:`);
    savedEmbeddings.forEach((emb, idx) => {
        console.log(`   ${idx + 1}. Chunk ${emb.chunk_index}: ${emb.page_title}`);
    });
    
    // Step 5: Test search function
    console.log('\nStep 5: Testing search function...');
    const { generateFreeEmbedding } = require('./services/freeEmbeddingService');
    const queryEmbedding = await generateFreeEmbedding('fasteners products');
    
    const { data: searchResults, error: searchError } = await supabase
        .rpc('search_website_content', {
            query_embedding: queryEmbedding,
            query_tenant_id: tenantId,
            match_threshold: 0.3,
            match_count: 3
        });
    
    if (searchError) {
        console.error('❌ Search function error:', searchError.message);
        console.log('   The RPC function might not be created yet.');
        console.log('   Make sure to run the full migration SQL.');
    } else {
        console.log(`✅ Search works! Found ${searchResults.length} results`);
        searchResults.forEach((result, idx) => {
            console.log(`   ${idx + 1}. ${result.page_title} (similarity: ${result.similarity?.toFixed(3)})`);
        });
    }
    
    console.log('\n===========================================');
    console.log('TEST COMPLETE');
    console.log('===========================================');
}

// Run test
testCrawl().catch(error => {
    console.error('Test failed:', error);
    process.exit(1);
});
