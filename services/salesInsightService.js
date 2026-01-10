/**
 * @title AI Sales Insight Service
 * @description Manages the logic for generating AI-powered sales insights and reports for tenants.
 */
const { dbClient, openai } = require('./config');

/**
 * Generates an AI-powered sales insight report for a tenant based on the last 30 days of activity.
 * @param {string} tenantId The ID of the tenant.
 * @returns {Promise<string>} A formatted string containing the AI-generated sales report.
 */
const generateSalesInsights = async (tenantId) => {
    try {
        console.log(`Generating sales insights for tenant ${tenantId}...`);
        const thirtyDaysAgo = new Date(new Date().setDate(new Date().getDate() - 30)).toISOString();

        // 1. Fetch raw data in parallel
        const [
            { data: orders, error: ordersError },
            { data: messages, error: messagesError }
        ] = await Promise.all([
            dbClient.from('orders')
                .select(`
                    total_amount,
                    order_items (
                        quantity,
                        product:products (name)
                    )
                `)
                .eq('tenant_id', tenantId)
                .gt('created_at', thirtyDaysAgo),
            dbClient.from('messages')
                .select('message_body')
                .eq('sender', 'user') // Only analyze customer messages
                .gt('created_at', thirtyDaysAgo)
                .limit(100) // Limit to the last 100 messages to keep the prompt manageable
        ]);

        if (ordersError || messagesError) {
            throw ordersError || messagesError;
        }

        if (!orders || orders.length === 0) {
            return "There is not enough sales data from the last 30 days to generate an insights report.";
        }

        // 2. Process and summarize the raw data
        const totalRevenue = orders.reduce((sum, order) => sum + order.total_amount, 0);
        const totalOrders = orders.length;
        const productSales = orders.flatMap(o => o.order_items).reduce((acc, item) => {
            const productName = item.product.name;
            acc[productName] = (acc[productName] || 0) + item.quantity;
            return acc;
        }, {});

        const topProducts = Object.entries(productSales)
            .sort(([, a], [, b]) => b - a)
            .slice(0, 3) // Get top 3
            .map(([name, quantity]) => `${name} (${quantity} units)`)
            .join(', ');

        const recentCustomerQueries = messages.map(m => m.message_body).join('\n - ');

        // 3. Create a data digest for the AI
        const dataDigest = `
- Total Revenue (Last 30 Days): $${totalRevenue.toFixed(2)}
- Total Orders (Last 30 Days): ${totalOrders}
- Top Selling Products: ${topProducts || 'None'}
- Recent Customer Queries:
 - ${recentCustomerQueries || 'None'}
`;

        // 4. Call the AI to generate insights from the digest
        const response = await openai.chat.completions.create({
            model: "gpt-4-turbo",
            messages: [{
                role: "system",
                content: `You are a business intelligence analyst. Based on the following data digest, provide a concise report with 2-3 actionable insights for a small business owner. The tone should be encouraging and professional. Structure the output clearly with headings.`
            }, {
                role: "user",
                content: dataDigest
            }],
            temperature: 0.6,
        });

        const insights = response.choices[0].message.content;

        let finalReport = `ðŸ“ˆ *Your AI-Powered Sales Insights (Last 30 Days)*\n\n`;
        finalReport += insights;

        return finalReport;

    } catch (error) {
        console.error('Error generating sales insights:', error.message);
        return 'An error occurred while generating your sales insights report.';
    }
};

module.exports = {
    generateSalesInsights,
};


