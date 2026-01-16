/**
 * @title Customer Loyalty Service
 * @description Manages all logic for tenant loyalty programs, including points and rewards.
 */
const { dbClient } = require('./config');
const { getConversationId } = require('./historyService');

/**
 * Finds or creates a loyalty program for a tenant.
 * @param {string} tenantId The ID of the tenant.
 * @returns {Promise<object>} The loyalty program object.
 */
const getOrCreateLoyaltyProgram = async (tenantId) => {
    let { data: program } = await dbClient
        .from('loyalty_programs')
        .select('*')
        .eq('tenant_id', tenantId)
        .single();

    if (!program) {
        const { data: newProgram } = await dbClient
            .from('loyalty_programs')
            .insert({ tenant_id: tenantId, is_active: true }) // Activate by default
            .select('*')
            .single();
        program = newProgram;
    }
    return program;
};

/**
 * Adds loyalty points to a customer's balance after an order.
 * @param {string} tenantId The ID of the tenant.
 * @param {string} conversationId The ID of the conversation.
 * @param {number} totalAmount The total amount of the order.
 */
const addPointsForPurchase = async (tenantId, conversationId, totalAmount) => {
    try {
        const program = await getOrCreateLoyaltyProgram(tenantId);
        if (!program.is_active) return; // Do nothing if the program isn't active

        const pointsToAdd = Math.floor(totalAmount * program.points_per_dollar);
        if (pointsToAdd <= 0) return;

        // Upsert the customer's point balance
        const { data: loyalty, error } = await dbClient
            .from('customer_loyalty_points')
            .select('id, points_balance')
            .eq('conversation_id', conversationId)
            .single();

        if (loyalty) {
            await dbClient
                .from('customer_loyalty_points')
                .update({ points_balance: loyalty.points_balance + pointsToAdd })
                .eq('id', loyalty.id);
        } else {
            await dbClient
                .from('customer_loyalty_points')
                .insert({ conversation_id: conversationId, points_balance: pointsToAdd });
        }
        console.log(`Added ${pointsToAdd} loyalty points for conversation ${conversationId}.`);
    } catch (error) {
        console.error('Error adding points for purchase:', error.message);
    }
};

/**
 * Allows a tenant to create a new reward.
 * @param {string} tenantId The ID of the tenant.
 * @param {string} rewardName The name of the reward.
 * @param {number} pointsCost The cost in points.
 * @param {string} description A description of the reward.
 * @returns {Promise<string>} A confirmation message.
 */
const createReward = async (tenantId, rewardName, pointsCost, description) => {
    try {
        const program = await getOrCreateLoyaltyProgram(tenantId);
        await dbClient.from('loyalty_rewards').insert({
            program_id: program.id,
            reward_name: rewardName,
            points_cost: pointsCost,
            description: description,
        });
        return `Reward "${rewardName}" created successfully.`;
    } catch (error) {
        console.error('Error creating reward:', error.message);
        return 'An error occurred while creating the reward.';
    }
};

/**
 * Allows a customer to view their points balance and available rewards.
 * @param {string} tenantId The ID of the tenant.
 * @param {string} endUserPhone The phone number of the customer.
 * @returns {Promise<string>} A formatted message with their balance and rewards.
 */
const viewLoyaltyStatus = async (tenantId, endUserPhone) => {
    try {
        const conversationId = await getConversationId(tenantId, endUserPhone);
        if (!conversationId) return "We couldn't find your loyalty account.";

        const program = await getOrCreateLoyaltyProgram(tenantId);
        if (!program.is_active) return "Our loyalty program is not active at the moment.";

        const { data: loyalty } = await dbClient
            .from('customer_loyalty_points')
            .select('points_balance')
            .eq('conversation_id', conversationId)
            .single();
        
        const balance = loyalty?.points_balance || 0;

        const { data: rewards } = await dbClient
            .from('loyalty_rewards')
            .select('*')
            .eq('program_id', program.id)
            .order('points_cost', { ascending: true });

        let message = `🌟 *Your Loyalty Status*\n\n`;
        message += `You currently have *${balance} points*.\n\n`;
        message += `*Available Rewards:*\n`;

        if (!rewards || rewards.length === 0) {
            message += `- No rewards are available at this time.\n`;
        } else {
            rewards.forEach(r => {
                message += `- *${r.reward_name}* (${r.points_cost} points)\n`;
                message += `  _${r.description}_\n`;
            });
            message += `\nTo redeem a reward, type \`/redeem <reward_name>\`.`;
        }
        return message;
    } catch (error) {
        console.error('Error viewing loyalty status:', error.message);
        return 'An error occurred while fetching your loyalty status.';
    }
};

/**
 * Allows a customer to redeem a reward.
 * @param {string} tenantId The ID of the tenant.
 * @param {string} endUserPhone The phone number of the customer.
 * @param {string} rewardName The name of the reward to redeem.
 * @returns {Promise<string>} A confirmation or error message.
 */
const redeemReward = async (tenantId, endUserPhone, rewardName) => {
    try {
        const conversationId = await getConversationId(tenantId, endUserPhone);
        const program = await getOrCreateLoyaltyProgram(tenantId);
        if (!program.is_active) return "Our loyalty program is not active.";

        const { data: reward } = await dbClient
            .from('loyalty_rewards')
            .select('*')
            .eq('program_id', program.id)
            .ilike('reward_name', rewardName)
            .single();

        if (!reward) return `Reward "${rewardName}" not found.`;

        const { data: loyalty } = await dbClient
            .from('customer_loyalty_points')
            .select('id, points_balance')
            .eq('conversation_id', conversationId)
            .single();
        
        const balance = loyalty?.points_balance || 0;
        
        if (balance < reward.points_cost) {
            return `You don't have enough points for this reward. You need ${reward.points_cost} points, but you have ${balance}.`;
        }

        await dbClient
            .from('customer_loyalty_points')
            .update({ points_balance: balance - reward.points_cost })
            .eq('id', loyalty.id);

        return `Congratulations! You have successfully redeemed "${reward.reward_name}". We will contact you shortly with the details.`;
    } catch (error) {
        console.error('Error redeeming reward:', error.message);
        return 'An error occurred while redeeming your reward.';
    }
};

module.exports = {
    addPointsForPurchase,
    createReward,
    viewLoyaltyStatus,
    redeemReward,
};


