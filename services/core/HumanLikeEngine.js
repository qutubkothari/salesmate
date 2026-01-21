/**
 * @title Human-Like Conversation Engine
 * @description Makes the AI feel genuinely human through natural delays, personality, and context awareness
 */

class HumanLikeEngine {
    constructor() {
        this.personalities = {
            friendly: {
                greetings: ['Hey there! 😊', 'Hello!', 'Hi! Great to hear from you!', 'Hey! How can I help you today?'],
                closings: ['Let me know if you need anything else!', 'Happy to help anytime! 🙌', 'Feel free to reach out if you have questions!'],
                acknowledgments: ['Got it!', 'I understand', 'Makes sense!', 'Absolutely!', 'For sure!'],
                thinking: ['Let me check that for you...', 'One moment...', 'Looking that up now...', 'Checking our catalog...']
            },
            professional: {
                greetings: ['Good day!', 'Hello and thank you for reaching out.', 'Greetings!'],
                closings: ['Please let me know if I can assist further.', 'Thank you for your inquiry.'],
                acknowledgments: ['Understood.', 'I see.', 'Certainly.', 'Of course.'],
                thinking: ['One moment please...', 'Allow me to check...', 'Let me verify that...']
            }
        };
    }

    /**
     * Calculate realistic typing delay based on message length
     * @param {string} message - The message to send
     * @returns {number} Delay in milliseconds
     */
    calculateTypingDelay(message) {
        const baseDelay = 500; // Base delay in ms
        const charsPerSecond = 40; // Average human typing speed
        const messageLength = message.length;
        
        // Simulate realistic typing: base delay + time based on length
        const typingTime = (messageLength / charsPerSecond) * 1000;
        
        // Add some randomness for natural feel (±20%)
        const randomness = 0.8 + (Math.random() * 0.4);
        
        // Cap at max 3 seconds to avoid making users wait too long
        return Math.min(baseDelay + (typingTime * randomness), 3000);
    }

    /**
     * Detect customer emotion from their message
     * @param {string} message - Customer's message
     * @param {object} conversationHistory - Previous conversation context
     * @returns {object} Emotion analysis
     */
    detectEmotion(message, conversationHistory = {}) {
        const msg = message.toLowerCase();
        
        // Frustration indicators
        const frustrationWords = ['not working', 'broken', 'terrible', 'worst', 'awful', 'useless', 'disappointed', 'frustrated', 'angry', 'fuck', 'shit', 'damn'];
        const isFrustrated = frustrationWords.some(w => msg.includes(w)) || msg.includes('!!!') || msg.includes('???');
        
        // Urgency indicators
        const urgencyWords = ['urgent', 'asap', 'quickly', 'now', 'immediately', 'emergency', 'hurry', 'fast'];
        const isUrgent = urgencyWords.some(w => msg.includes(w)) || msg.includes('!');
        
        // Excitement indicators
        const excitementWords = ['great', 'awesome', 'amazing', 'perfect', 'excellent', 'love', 'fantastic', 'wonderful'];
        const isExcited = excitementWords.some(w => msg.includes(w)) || msg.includes('😊') || msg.includes('👍') || msg.includes('❤️');
        
        // Gratitude indicators
        const gratitudeWords = ['thank', 'thanks', 'appreciate', 'grateful'];
        const isGrateful = gratitudeWords.some(w => msg.includes(w));
        
        // Confusion indicators
        const confusionWords = ['confused', "don't understand", 'not clear', 'what do you mean', 'explain', 'clarify'];
        const isConfused = confusionWords.some(w => msg.includes(w)) || msg.includes('???');
        
        return {
            frustrated: isFrustrated,
            urgent: isUrgent,
            excited: isExcited,
            grateful: isGrateful,
            confused: isConfused,
            neutral: !isFrustrated && !isUrgent && !isExcited && !isGrateful && !isConfused
        };
    }

    /**
     * Adapt response tone based on customer emotion
     * @param {string} baseResponse - The AI's base response
     * @param {object} emotion - Customer emotion analysis
     * @returns {string} Emotionally adapted response
     */
    adaptToneToEmotion(baseResponse, emotion) {
        if (emotion.frustrated) {
            return `I completely understand your frustration. ${baseResponse}\n\nI'm here to help make this right! 💪`;
        }
        
        if (emotion.urgent) {
            return `I've got you! ${baseResponse}\n\nLet me know if you need anything else urgently.`;
        }
        
        if (emotion.excited) {
            return `${baseResponse}\n\nSo glad you're excited! Let me know how else I can help! 🎉`;
        }
        
        if (emotion.grateful) {
            return `You're very welcome! ${baseResponse}\n\nAlways happy to help! 😊`;
        }
        
        if (emotion.confused) {
            return `Let me clarify that for you:\n\n${baseResponse}\n\nDoes that make sense? Feel free to ask if you need more details!`;
        }
        
        return baseResponse;
    }

    /**
     * Make response more conversational and less robotic
     * @param {string} response - Base AI response
     * @param {object} context - Conversation context
     * @returns {string} Humanized response
     */
    humanizeResponse(response, context = {}) {
        // Remove overly formal phrases
        let humanized = response
            .replace(/^I apologize, but /gi, "Sorry, ")
            .replace(/I do not have/gi, "I don't have")
            .replace(/I am unable to/gi, "I can't")
            .replace(/I would be happy to/gi, "I'd be happy to")
            .replace(/Please feel free to/gi, "Feel free to")
            .replace(/At this time,?/gi, "Right now,")
            .replace(/Additionally,/gi, "Also,")
            .replace(/However,/gi, "But")
            .replace(/Furthermore,/gi, "Plus,");
        
        // Add conversational connectors randomly
        const connectors = ['By the way,', 'Just so you know,', 'Quick note:', 'Oh, and'];
        if (Math.random() > 0.7 && !humanized.includes('\n\n')) {
            const parts = humanized.split('. ');
            if (parts.length > 1) {
                const randomConnector = connectors[Math.floor(Math.random() * connectors.length)];
                humanized = parts[0] + '. ' + randomConnector + ' ' + parts.slice(1).join('. ');
            }
        }
        
        // Add occasional emojis (but not too many)
        if (Math.random() > 0.6 && !humanized.includes('😊') && !humanized.includes('🙂')) {
            humanized += ' 😊';
        }
        
        return humanized;
    }

    /**
     * Generate proactive suggestions based on customer interest
     * @param {string} userMessage - What customer asked about
     * @param {array} products - Available products
     * @returns {string|null} Proactive suggestion
     */
    generateProactiveSuggestion(userMessage, products = []) {
        if (!products || products.length === 0) return null;
        
        const msg = userMessage.toLowerCase();
        
        // If asking about one category, suggest related products
        if (msg.includes('led panel') && products.some(p => p.category?.includes('Downlight'))) {
            return "\n\nBTW, many customers who get LED panels also like our downlights for a complete lighting solution. Want to see those too?";
        }
        
        if (msg.includes('smart') && products.some(p => p.name?.includes('RGB'))) {
            return "\n\nIf you're into smart lighting, you might also love our RGB LED strips - they're super popular! 🌈";
        }
        
        // If showing many products, offer to narrow down
        if (products.length > 5) {
            return "\n\nThat's quite a selection! Want me to help narrow it down based on your budget or specific needs?";
        }
        
        return null;
    }

    /**
     * Extract customer name from conversation
     * @param {array} messages - Conversation history
     * @returns {string|null} Customer name if found
     */
    extractCustomerName(messages = []) {
        // Look for "my name is X", "I'm X", "this is X"
        const namePatterns = [
            /my name is ([a-z]+)/i,
            /i'?m ([a-z]+)/i,
            /this is ([a-z]+)/i,
            /call me ([a-z]+)/i
        ];
        
        for (const msg of messages) {
            if (!msg.message_body) continue;
            for (const pattern of namePatterns) {
                const match = msg.message_body.match(pattern);
                if (match && match[1] && match[1].length > 2 && match[1].length < 20) {
                    const name = match[1].charAt(0).toUpperCase() + match[1].slice(1).toLowerCase();
                    return name;
                }
            }
        }
        
        return null;
    }

    /**
     * Personalize response with customer name if available
     * @param {string} response - Base response
     * @param {string} customerName - Customer's name
     * @param {number} messageCount - How many messages in conversation
     * @returns {string} Personalized response
     */
    personalizeResponse(response, customerName = null, messageCount = 0) {
        if (!customerName) return response;
        
        // Use name occasionally, not every message (that's weird)
        if (messageCount % 3 === 0 || messageCount === 1) {
            // Add name at the beginning sometimes
            if (Math.random() > 0.5) {
                return `${customerName}, ${response.charAt(0).toLowerCase()}${response.slice(1)}`;
            } else {
                return response + `\n\nHope that helps, ${customerName}!`;
            }
        }
        
        return response;
    }

    /**
     * Create natural conversation starters based on time of day
     * @returns {string} Time-appropriate greeting
     */
    getTimeBasedGreeting() {
        const hour = new Date().getHours();
        
        if (hour < 12) {
            return ['Good morning!', 'Morning!', 'Hey! Early bird today! 🌅'][Math.floor(Math.random() * 3)];
        } else if (hour < 17) {
            return ['Good afternoon!', 'Hey there!', 'Hi!'][Math.floor(Math.random() * 3)];
        } else {
            return ['Good evening!', 'Evening!', 'Hey!'][Math.floor(Math.random() * 3)];
        }
    }

    /**
     * Determine if should use typing indicator
     * @param {string} message - Message to send
     * @returns {boolean} Whether to show typing
     */
    shouldShowTyping(message) {
        // Show typing for longer messages or when searching
        return message.length > 50 || message.includes('looking') || message.includes('checking');
    }

    /**
     * Create a more human-like version of product listings
     * @param {array} products - Products to list
     * @returns {string} Natural product presentation
     */
    humanizeProductList(products) {
        if (!products || products.length === 0) {
            return "Hmm, I don't have specific products matching that right now. Want to tell me more about what you're looking for?";
        }
        
        if (products.length === 1) {
            const p = products[0];
            return `I've got just the thing! Check out our ${p.name} - ${p.description || 'a great choice'}. It's AED ${p.price}.\n\nInterested? I can add it to your cart or tell you more about it!`;
        }
        
        if (products.length <= 3) {
            let response = "Here are some great options I think you'll like:\n\n";
            products.forEach((p, i) => {
                response += `${i + 1}. **${p.name}** - AED ${p.price}\n   ${p.description?.substring(0, 80) || 'High quality product'}...\n\n`;
            });
            response += "Which one catches your eye? I can share more details about any of them!";
            return response;
        }
        
        // Many products - be more selective
        const intro = ["Wow, we've got quite a selection for you!", "Great news - tons of options!", "You're in luck! Check these out:"][Math.floor(Math.random() * 3)];
        let response = `${intro}\n\n`;
        
        products.slice(0, 6).forEach((p, i) => {
            response += `• ${p.name} - AED ${p.price}\n`;
        });
        
        if (products.length > 6) {
            response += `\n...and ${products.length - 6} more options available!\n\n`;
        }
        
        response += "Want details on any specific item? Or should I help you narrow these down?";
        return response;
    }

    /**
     * Handle small talk naturally
     * @param {string} message - User message
     * @returns {string|null} Small talk response or null if not small talk
     */
    handleSmallTalk(message) {
        const msg = message.toLowerCase();
        
        if (msg.match(/^(hi|hello|hey|howdy|sup|yo)$/i)) {
            const greetings = [
                "Hey! 👋 How can I help you today?",
                "Hello! What can I do for you?",
                "Hi there! Looking for something specific?",
                "Hey! Great to hear from you! What brings you here today?"
            ];
            return greetings[Math.floor(Math.random() * greetings.length)];
        }
        
        if (msg.includes('how are you') || msg.includes('how r u')) {
            return "I'm doing great, thanks for asking! 😊 How about you? What can I help you with today?";
        }
        
        if (msg.includes('what is your name') || msg.includes('who are you')) {
            return "I'm your AI shopping assistant from Hylite Industries! I'm here to help you find the perfect lighting products. What are you looking for?";
        }
        
        if (msg.match(/^(bye|goodbye|see ya|later)$/i)) {
            return "Take care! Feel free to message anytime you need help. Have a great day! 👋";
        }
        
        if (msg.includes('thank') || msg === 'ty' || msg === 'thx') {
            const thanks = [
                "You're welcome! Anything else I can help with? 😊",
                "Happy to help! Let me know if you need anything else!",
                "No problem at all! Just let me know if you have questions!"
            ];
            return thanks[Math.floor(Math.random() * thanks.length)];
        }
        
        return null;
    }
}

module.exports = new HumanLikeEngine();
