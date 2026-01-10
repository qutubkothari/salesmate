const { dbClient } = require('../services/config');

(async () => {
  try {
    const code = '8x80';
    console.log('Querying products with name ilike %' + code + '%');
    const { data, error } = await dbClient
      .from('products')
      .select('id, name, category, price, units_per_carton')
      .ilike('name', `%${code}%`)
      .limit(20);

    if (error) {
      console.error('Error:', error);
    } else {
      console.log('Found', data?.length || 0, 'rows');
      console.log(JSON.stringify(data, null, 2));
    }
  } catch (err) {
    console.error(err);
  }
})();

