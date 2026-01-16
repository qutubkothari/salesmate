/**
 * @title AI Survey Service
 * @description Manages all logic for creating, deploying, and analyzing AI-powered surveys.
 */
const { dbClient, openai } = require('./config');
const { sendMessage } = require('./whatsappService');
const { logMessage, getConversationId } = require('./historyService');
const xlsx = require('xlsx');
const fetch = require('node-fetch');

/**
 * Creates a new survey for a tenant.
 * @param {string} tenantId The ID of the tenant.
 * @param {string} surveyName The name of the new survey.
 * @returns {Promise<string>} A confirmation or error message.
 */
const createSurvey = async (tenantId, surveyName) => {
    try {
        await dbClient.from('surveys').insert({ tenant_id: tenantId, survey_name: surveyName });
        return `Survey "${surveyName}" created successfully. Now add questions with /add_survey_question.`;
    } catch (error) {
        if (error.code === '23505') return `A survey with the name "${surveyName}" already exists.`;
        console.error('Error creating survey:', error.message);
        return 'An error occurred while creating the survey.';
    }
};

/**
 * Adds a question to a survey.
 * @param {string} tenantId The ID of the tenant.
 * @param {string} surveyName The name of the survey.
 * @param {number} sequenceOrder The order of the question.
 * @param {string} questionText The text of the question.
 * @returns {Promise<string>} A confirmation or error message.
 */
const addSurveyQuestion = async (tenantId, surveyName, sequenceOrder, questionText) => {
    try {
        const { data: survey, error } = await dbClient
            .from('surveys')
            .select('id')
            .eq('tenant_id', tenantId)
            .eq('survey_name', surveyName)
            .single();

        if (error || !survey) return `Could not find a survey named "${surveyName}".`;

        await dbClient.from('survey_questions').upsert({
            survey_id: survey.id,
            sequence_order: sequenceOrder,
            question_text: questionText
        }, { onConflict: 'survey_id, sequence_order' });

        return `Question #${sequenceOrder} added to survey "${surveyName}".`;
    } catch (error) {
        console.error('Error adding survey question:', error.message);
        return 'An error occurred while adding the question.';
    }
};

/**
 * Deploys a survey to a list of users from an Excel sheet.
 * @param {string} tenantId The ID of the tenant.
 * @param {string} surveyName The name of the survey.
 * @param {string} mediaUrl The URL of the contact sheet.
 * @returns {Promise<string>} A confirmation or error message.
 */
const deploySurveyFromSheet = async (tenantId, surveyName, mediaUrl) => {
    try {
        const { data: survey, error } = await dbClient
            .from('surveys')
            .select('id')
            .eq('tenant_id', tenantId)
            .eq('survey_name', surveyName)
            .single();

        if (error || !survey) return `Could not find a survey named "${surveyName}".`;

        const response = await fetch(mediaUrl);
        if (!response.ok) throw new Error(`Failed to download file: ${response.statusText}`);
        const buffer = await response.arrayBuffer();
        const workbook = xlsx.read(buffer, { type: 'buffer' });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const phoneNumbers = xlsx.utils.sheet_to_json(worksheet, { header: 1 }).map(row => String(row[0])).filter(Boolean);

        if (phoneNumbers.length === 0) return 'No phone numbers found in the sheet.';

        const deployments = phoneNumbers.map(phone => ({
            survey_id: survey.id,
            end_user_phone: phone,
        }));

        await dbClient.from('survey_deployments').insert(deployments);
        return `Survey "${surveyName}" has been scheduled for deployment to ${phoneNumbers.length} contacts.`;
    } catch (error) {
        console.error('Error deploying survey from sheet:', error.message);
        return 'An error occurred during deployment.';
    }
};

/**
 * Analyzes the sentiment of a user's text response.
 * @param {string} responseText The user's answer.
 * @returns {Promise<string>} 'Positive', 'Neutral', or 'Negative'.
 */
const analyzeSentiment = async (responseText) => {
    try {
        const response = await openai.chat.completions.create({
            model: "gpt-3.5-turbo",
            messages: [{
                role: "system",
                content: "Analyze the sentiment of the following text. Respond with only one word: Positive, Neutral, or Negative."
            }, {
                role: "user",
                content: responseText
            }],
            temperature: 0,
            max_tokens: 5,
        });
        const sentiment = response.choices[0].message.content.trim();
        return ['Positive', 'Neutral', 'Negative'].includes(sentiment) ? sentiment : 'Neutral';
    } catch (error) {
        console.error('Error analyzing sentiment:', error.message);
        return 'Neutral'; // Default on error
    }
};

/**
 * Handles the multi-step survey conversation flow.
 * @param {object} tenant The full tenant object.
 * @param {object} conversation The current conversation object.
 * @param {string} userMessage The message from the end-user.
 */
const handleSurveyFlow = async (tenant, conversation, userMessage) => {
    const { state, id: conversationId, end_user_phone, temp_storage } = conversation;
    const { surveyId, currentQuestionId, currentSequence } = JSON.parse(temp_storage || '{}');

    // 1. Save the response to the previous question
    const sentiment = await analyzeSentiment(userMessage);
    await dbClient.from('survey_responses').insert({
        survey_id: surveyId,
        conversation_id: conversationId,
        question_id: currentQuestionId,
        response_text: userMessage,
        sentiment: sentiment
    });

    // 2. Find the next question in the sequence
    const nextSequence = currentSequence + 1;
    const { data: nextQuestion } = await dbClient
        .from('survey_questions')
        .select('*')
        .eq('survey_id', surveyId)
        .eq('sequence_order', nextSequence)
        .single();

    if (nextQuestion) {
        // 3. Ask the next question
        await dbClient.from('conversations_new').update({
            temp_storage: JSON.stringify({ surveyId, currentQuestionId: nextQuestion.id, currentSequence: nextSequence })
        }).eq('id', conversationId);
        await sendMessage(end_user_phone, nextQuestion.question_text);
        await logMessage(tenant.id, end_user_phone, 'bot', nextQuestion.question_text, 'survey_question');
    } else {
        // 4. End of survey
        await dbClient.from('conversations_new').update({ state: null, temp_storage: null }).eq('id', conversationId);
        await dbClient.from('survey_deployments').update({ status: 'completed' }).eq('survey_id', surveyId).eq('end_user_phone', end_user_phone);
        
        const endMessage = "Thank you for completing our survey!";
        await sendMessage(end_user_phone, endMessage);
        await logMessage(tenant.id, end_user_phone, 'bot', endMessage, 'survey_end');

        const tenantNotification = `📋 *Survey Completed!*\n\n The user at ${end_user_phone} has completed your survey.`;
        await sendMessage(tenant.phone_number, tenantNotification);
    }
};

/**
 * Processes the survey deployment queue, sending the first question to pending users.
 */
const processSurveyDeployments = async () => {
    try {
        const { data: pendingDeployments, error } = await dbClient
            .from('survey_deployments')
            .select('*')
            .eq('status', 'pending');

        if (error) throw error;
        if (!pendingDeployments || pendingDeployments.length === 0) return;

        console.log(`Processing ${pendingDeployments.length} survey deployments...`);

        for (const deployment of pendingDeployments) {
            const { data: firstQuestion } = await dbClient
                .from('survey_questions')
                .select('*')
                .eq('survey_id', deployment.survey_id)
                .eq('sequence_order', 1)
                .single();

            if (firstQuestion) {
                const conversationId = await getConversationId(deployment.survey.tenant_id, deployment.end_user_phone);
                await dbClient.from('conversations_new').update({
                    state: 'awaiting_survey_response',
                    temp_storage: JSON.stringify({
                        surveyId: deployment.survey_id,
                        currentQuestionId: firstQuestion.id,
                        currentSequence: 1
                    })
                }).eq('id', conversationId);

                await sendMessage(deployment.end_user_phone, firstQuestion.question_text);
                await logMessage(deployment.survey.tenant_id, deployment.end_user_phone, 'bot', firstQuestion.question_text, 'survey_question');
                await dbClient.from('survey_deployments').update({ status: 'sent', sent_at: new Date().toISOString() }).eq('id', deployment.id);
            }
        }
    } catch (error) {
        console.error('Error processing survey deployments:', error.message);
    }
};

/**
 * Gets a report of responses for a specific survey.
 * @param {string} tenantId The ID of the tenant.
 * @param {string} surveyName The name of the survey.
 * @returns {Promise<string>} A formatted report of survey results.
 */
const getSurveyReport = async (tenantId, surveyName) => {
    try {
        const { data: survey, error: surveyError } = await dbClient
            .from('surveys')
            .select(`
                id,
                survey_name,
                questions:survey_questions(id, question_text, sequence_order),
                responses:survey_responses(question_id, response_text, sentiment)
            `)
            .eq('tenant_id', tenantId)
            .eq('survey_name', surveyName)
            .single();

        if (surveyError || !survey) return `Could not find a survey named "${surveyName}".`;
        if (survey.responses.length === 0) return `Survey "${surveyName}" has no responses yet.`;
        
        let report = `📊 *Survey Report: ${survey.survey_name}*\n\n`;
        
        survey.questions.sort((a, b) => a.sequence_order - b.sequence_order);

        for (const question of survey.questions) {
            const responsesToQuestion = survey.responses.filter(r => r.question_id === question.id);
            if (responsesToQuestion.length === 0) continue;

            report += `*Q${question.sequence_order}: ${question.question_text}*\n`;
            
            const sentimentCounts = responsesToQuestion.reduce((acc, curr) => {
                const sentiment = curr.sentiment || 'N/A';
                acc[sentiment] = (acc[sentiment] || 0) + 1;
                return acc;
            }, {});

            report += `  - Total Responses: ${responsesToQuestion.length}\n`;
            report += `  - Sentiments: Positive (${sentimentCounts.Positive || 0}), Neutral (${sentimentCounts.Neutral || 0}), Negative (${sentimentCounts.Negative || 0})\n\n`;
        }

        return report;
    } catch (error) {
        console.error('Error generating survey report:', error.message);
        return 'An error occurred while generating the survey report.';
    }
};

module.exports = {
    createSurvey,
    addSurveyQuestion,
    deploySurveyFromSheet,
    handleSurveyFlow,
    processSurveyDeployments,
    getSurveyReport,
};



