// Test if performance router can be loaded
console.log('Testing performance router loading...\n');

try {
    const PerformanceService = require('./services/performance-service');
    console.log('✅ PerformanceService loaded:', typeof PerformanceService);
    console.log('   Methods:', Object.keys(PerformanceService).join(', '));
} catch (error) {
    console.log('❌ PerformanceService failed:', error.message);
    console.log(error.stack);
}

console.log('');

try {
    const router = require('./routes/api/performance');
    console.log('✅ Performance router loaded:', typeof router);
    console.log('   Stack size:', router.stack.length);
    console.log('   Routes:');
    router.stack.forEach((layer, i) => {
        if (layer.route) {
            const methods = Object.keys(layer.route.methods).join(',').toUpperCase();
            console.log(`   ${i + 1}. ${methods} ${layer.route.path}`);
        }
    });
} catch (error) {
    console.log('❌ Performance router failed:', error.message);
    console.log(error.stack);
}
