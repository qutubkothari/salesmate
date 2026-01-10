const discountCalculationService = require('../services/discountCalculationService');
const { dbClient } = require('../services/config');

(async () => {
  const tenantId = 'a10aa26a-b5f9-4afe-87cc-70bfb4d1f6e6';
  const productCodes = ['8x80','8x100','10x100'];
  const { data: productsByName } = await dbClient
    .from('products')
    .select('id, name, category, price, units_per_carton')
    .or(productCodes.map(c => `name.ilike.%${c}%`).join(','));

  const extracted = [
    { productCode: '8x80', quantity: 8 },
    { productCode: '8x100', quantity: 8 },
    { productCode: '10x100', quantity: 10 }
  ];

  const productMap = {};
  (productsByName || []).forEach(pr => {
    const codeMatch = String(pr.name || '').match(/\d+x\d+/);
    if (codeMatch) productMap[codeMatch[0]] = pr;
  });

  const orderData = {
    items: extracted.map(p => {
      const prod = productMap[p.productCode] || {};
      return {
        product_id: prod.id || null,
        category: prod.category || null,
        quantity: parseInt(p.quantity, 10) || 1,
        price: prod.price || 0
      };
    }),
    totalAmount: 0,
    quantity: extracted.reduce((s, p) => s + p.quantity, 0),
    customerProfile: null
  };
  orderData.totalAmount = orderData.items.reduce((s, it) => s + (it.price * it.quantity), 0);

  console.log('orderData', JSON.stringify(orderData, null, 2));

  const applicable = await discountCalculationService.findApplicableDiscounts(tenantId, orderData);
  console.log('applicable discounts count:', applicable.length);
  console.log(JSON.stringify(applicable, null, 2));
})();
