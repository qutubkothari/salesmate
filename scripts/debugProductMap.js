const { dbClient } = require('../services/config');

(async () => {
  const productCodes = ['8x80','8x100','10x100'];
  console.log('productCodes', productCodes);
  try {
    const { data: productsFromDb, error: prodErr } = await dbClient
      .from('products')
      .select('id, name, category, price, units_per_carton')
      .in('product_code', productCodes);
    console.log('productsFromDb error:', prodErr);
    console.log('productsFromDb:', productsFromDb);
  } catch (err) {
    console.log('caught error from in(product_code):', err.message || err);
  }

  try {
    const orExpr = productCodes.map(c => `name.ilike.%${c}%`).join(',');
    console.log('orExpr:', orExpr);
    const { data: productsByName, error: nameErr } = await dbClient
      .from('products')
      .select('id, name, category, price, units_per_carton')
      .or(orExpr);
    console.log('nameErr:', nameErr);
    console.log('productsByName:', productsByName);
    const productMap = {};
    (productsByName || []).forEach(pr => {
      if (pr.product_code) productMap[pr.product_code] = pr;
      if (pr.name) productMap[pr.name] = pr;
      const codeMatch = String(pr.name || '').match(/\d+x\d+/);
      if (codeMatch) productMap[codeMatch[0]] = pr;
    });
    console.log('productMap keys:', Object.keys(productMap));
  } catch (err) {
    console.error('fallback err', err.message || err);
  }

})();
