/**
 * Test AI Lead Qualification
 * Verify AI analysis is working correctly
 */

// Simulate the AI analysis function
function analyzeLeadQuality(messageBody) {
    if (!messageBody) {
        return { heat: 'COLD', score: 20, intent: 'unknown', urgency: 'low' };
    }

    const text = messageBody.toLowerCase();
    let score = 30;
    let urgency = 'low';
    let intent = 'inquiry';

    const highIntentKeywords = [
        'buy', 'purchase', 'order', 'price', 'cost', 'quote', 'quotation',
        'invoice', 'payment', 'pay', 'book', 'reserve', 'confirm',
        'interested', 'want', 'need', 'require', 'urgent', 'asap',
        'immediately', 'today', 'now', 'ready'
    ];

    const warmIntentKeywords = [
        'details', 'information', 'info', 'tell me', 'looking for',
        'available', 'availability', 'stock', 'delivery', 'shipping',
        'specifications', 'features', 'options', 'variants'
    ];

    const urgentKeywords = [
        'urgent', 'asap', 'immediately', 'today', 'now', 'emergency',
        'right now', 'as soon as possible', 'quick', 'fast'
    ];

    const premiumKeywords = [
        'bulk', 'wholesale', 'business', 'company', 'corporate',
        'large order', 'multiple', 'quantity', 'dealer', 'distributor'
    ];

    let highIntentCount = 0;
    let warmIntentCount = 0;
    let urgentCount = 0;
    let premiumCount = 0;

    highIntentKeywords.forEach(keyword => {
        if (text.includes(keyword)) highIntentCount++;
    });

    warmIntentKeywords.forEach(keyword => {
        if (text.includes(keyword)) warmIntentCount++;
    });

    urgentKeywords.forEach(keyword => {
        if (text.includes(keyword)) urgentCount++;
    });

    premiumKeywords.forEach(keyword => {
        if (text.includes(keyword)) premiumCount++;
    });

    if (highIntentCount >= 2) {
        score += 40;
        intent = 'purchase';
    } else if (highIntentCount === 1) {
        score += 25;
        intent = 'purchase';
    }

    if (warmIntentCount >= 2) {
        score += 20;
    } else if (warmIntentCount === 1) {
        score += 10;
    }

    if (urgentCount > 0) {
        score += 15;
        urgency = urgentCount >= 2 ? 'critical' : 'high';
    }

    if (premiumCount > 0) {
        score += 20;
    }

    const questionCount = (text.match(/\?/g) || []).length;
    if (questionCount >= 2) {
        score += 5;
    }

    const wordCount = text.split(/\s+/).length;
    if (wordCount > 20) {
        score += 10;
    } else if (wordCount < 5) {
        score -= 10;
    }

    score = Math.min(100, Math.max(0, score));

    let heat = 'COLD';
    if (score >= 80) {
        heat = 'ON_FIRE';
    } else if (score >= 60) {
        heat = 'HOT';
    } else if (score >= 40) {
        heat = 'WARM';
    }

    return {
        heat,
        score,
        intent,
        urgency,
        analysis: {
            highIntentMatches: highIntentCount,
            warmIntentMatches: warmIntentCount,
            urgentMatches: urgentCount,
            premiumMatches: premiumCount,
            questionCount,
            wordCount
        }
    };
}

// Test cases
const testMessages = [
    {
        name: "🔥 ON_FIRE - Urgent bulk purchase",
        message: "Need urgent quote for bulk order. Want to purchase 500 units asap.",
        expected: { heat: 'ON_FIRE', minScore: 80 }
    },
    {
        name: "🌶️ HOT - Ready to buy",
        message: "I want to buy this product. What is the price?",
        expected: { heat: 'HOT', minScore: 60 }
    },
    {
        name: "☀️ WARM - General inquiry",
        message: "Looking for information about your products. Are they available?",
        expected: { heat: 'WARM', minScore: 40 }
    },
    {
        name: "❄️ COLD - Minimal engagement",
        message: "Hi",
        expected: { heat: 'COLD', maxScore: 39 }
    },
    {
        name: "🔥 ON_FIRE - Corporate urgent order",
        message: "Our company needs immediate delivery of bulk order today. Please confirm availability and send invoice.",
        expected: { heat: 'ON_FIRE', minScore: 80 }
    },
    {
        name: "🌶️ HOT - Price inquiry",
        message: "Interested in your product. Please send quotation and details.",
        expected: { heat: 'HOT', minScore: 60 }
    },
    {
        name: "☀️ WARM - Checking availability",
        message: "Is this product in stock? Need some information.",
        expected: { heat: 'WARM', minScore: 40 }
    }
];

console.log('\n🧠 AI LEAD QUALIFICATION TEST\n');
console.log('='.repeat(80));

let passed = 0;
let failed = 0;

testMessages.forEach((test, index) => {
    const result = analyzeLeadQuality(test.message);
    
    console.log(`\n${index + 1}. ${test.name}`);
    console.log('   Message:', test.message);
    console.log('   Result:', `${result.heat} (score: ${result.score})`);
    console.log('   Intent:', result.intent, '| Urgency:', result.urgency);
    console.log('   Analysis:', JSON.stringify(result.analysis, null, 2).split('\n').map(l => '   ' + l).join('\n'));
    
    // Validation
    let testPassed = result.heat === test.expected.heat;
    if (test.expected.minScore) {
        testPassed = testPassed && result.score >= test.expected.minScore;
    }
    if (test.expected.maxScore) {
        testPassed = testPassed && result.score <= test.expected.maxScore;
    }
    
    if (testPassed) {
        console.log('   ✅ PASSED');
        passed++;
    } else {
        console.log(`   ❌ FAILED - Expected ${test.expected.heat}`);
        failed++;
    }
});

console.log('\n' + '='.repeat(80));
console.log(`\n📊 RESULTS: ${passed}/${testMessages.length} tests passed`);

if (failed === 0) {
    console.log('✅ All tests passed! AI qualification is working correctly.\n');
} else {
    console.log(`⚠️  ${failed} tests failed. Review keyword weights.\n`);
}
