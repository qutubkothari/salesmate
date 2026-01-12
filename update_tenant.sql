UPDATE tenants 
SET 
  business_name = 'SAK Solutions',
  business_website = 'https://saksolution.ae'
WHERE id = '101f04af63cbefc2bf8f0a98b9ae1205';

SELECT business_name, business_website FROM tenants WHERE id = '101f04af63cbefc2bf8f0a98b9ae1205';
