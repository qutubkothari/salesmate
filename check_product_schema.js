require('dotenv').config();
const { dbClient } = require('./config/database');

(async () => {
  // Get a sample product to see the schema
  const { data: product } = await dbClient
    .from('products')
    .select('*')
    .eq('name', 'NFF - 8x80')
    .maybeSingle();

  if (product) {
    console.log('Product Schema (field names):');
    console.log(Object.keys(product));
    console.log('\nProduct Data:');
    console.log(JSON.stringify(product, null, 2));
  } else {
    console.log('Product not found');
  }
})();

