// Utility to normalize phone numbers for WhatsApp and digit-only formats
function normalizePhone(phone) {
    if (!phone) return '';
    // Remove WhatsApp suffix if present
    let num = phone.replace(/@.*$/, '');
    // Remove all non-digits
    num = num.replace(/\D/g, '');
    return num;
}

// Utility to upsert customer profile by tenant, phone, and updateData
async function upsertCustomerProfile(tenantId, phone, updateData) {
    const normalizedPhone = normalizePhone(phone);
    // Upsert by tenant_id and phone
    await dbClient
        .from('customer_profiles')
        .upsert({
            tenant_id: tenantId,
            phone: normalizedPhone,
            ...updateData
        }, {
            onConflict: 'tenant_id,phone'
        });
}

module.exports = { normalizePhone, upsertCustomerProfile };

