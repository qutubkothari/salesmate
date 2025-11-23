const { searchWebsiteForQuery } = require('./services/websiteContentIntegration');

async function test() {
    try {
        console.log('Testing website search for: "tell me more about your company"');
        const results = await searchWebsiteForQuery(
            'tell me more about your company',
            'a10aa26a-b5f9-4afe-87cc-70bfb4d1f6e6'
        );
        
        console.log('\n✅ Results found:', results.length);
        
        results.forEach((result, i) => {
            console.log(`\n${i + 1}. ${result.pageTitle}`);
            console.log(`   URL: ${result.url}`);
            console.log(`   Content: ${result.content.substring(0, 200)}...`);
            console.log(`   Similarity: ${result.similarity}`);
        });
    } catch (error) {
        console.error('❌ Error:', error.message);
        console.error(error.stack);
    }
}

test();
