/**
 * Desktop Agent - WhatsApp Web Connection Handler
 * Runs on your PC - Handles WhatsApp Web connection locally
 * Communicates with cloud server only for AI processing
 */

const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const axios = require('axios');
const notifier = require('node-notifier');
const fs = require('fs');
const path = require('path');
const express = require('express');
const { exec } = require('child_process');
require('dotenv').config();

// Configuration
const CLOUD_SERVER_URL = process.env.CLOUD_SERVER_URL || 'http://43.205.192.171:8080';
const LOCAL_PORT = process.env.LOCAL_PORT || 3001;
const WHATSAPP_PHONE = process.env.WHATSAPP_PHONE || '971507055253'; // Your WhatsApp number
let TENANT_ID = process.env.TENANT_ID || null; // Read from .env file first
const API_KEY = process.env.API_KEY || '';
let isAuthenticated = true; // Auto-authenticate

// Global WhatsApp client for broadcast access
global.whatsappClient = null;

// Find Chrome executable
function findChrome() {
    const possiblePaths = [
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
        process.env.LOCALAPPDATA + '\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
        'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
    ];
    
    for (const chromePath of possiblePaths) {
        if (fs.existsSync(chromePath)) {
            console.log(`✅ Found browser: ${chromePath}`);
            return chromePath;
        }
    }
    
    console.log('⚠️  No Chrome/Edge found. Install Google Chrome from: https://www.google.com/chrome/');
    return null;
}

const executablePath = findChrome();

if (!executablePath) {
    console.error('\n❌ ERROR: Chrome or Edge browser not found!');
    console.error('📥 Please install Google Chrome from: https://www.google.com/chrome/');
    console.error('   Or Microsoft Edge from: https://www.microsoft.com/edge');
    process.exit(1);
}

// Create local Express server for authentication callback
const localApp = express();
localApp.use(express.json());

// CORS middleware - Allow dashboard to check agent status
localApp.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type');
    
    // Handle preflight
    if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
    }
    
    next();
});

// Health check endpoint
localApp.get('/health', (req, res) => {
    res.json({ 
        status: 'running',
        authenticated: isAuthenticated,
        tenantId: TENANT_ID,
        timestamp: new Date().toISOString()
    });
});

// Advanced Broadcast endpoint - Handles all dashboard features (image, batch, timing)
localApp.post('/broadcast', async (req, res) => {
    try {
        const { 
            phoneNumbers, 
            message: broadcastMessage,
            imageBase64,
            imageBase64List,
            messageType = 'text',
            batchSize = 10,
            messageDelay = 500,
            batchDelay = 2000
        } = req.body;

        const images = Array.isArray(imageBase64List)
            ? imageBase64List.filter(Boolean)
            : (imageBase64 ? [imageBase64] : []);
        
        if (!phoneNumbers || !Array.isArray(phoneNumbers) || phoneNumbers.length === 0) {
            return res.status(400).json({ error: 'Phone numbers array required' });
        }
        
        // Allow either a global `message` OR per-recipient objects like { phone, message }.
        const hasPerRecipientMessage = phoneNumbers.some((p) => p && typeof p === 'object' && (p.message || p.text));
        if (!broadcastMessage && !hasPerRecipientMessage) {
            return res.status(400).json({ error: 'Message required' });
        }
        
        if (!global.whatsappClient) {
            return res.status(503).json({ error: 'WhatsApp not connected' });
        }
        
        console.log(`\n📢 Broadcasting to ${phoneNumbers.length} contacts...`);
        console.log(`   Type: ${messageType}`);
        console.log(`   Batch Size: ${batchSize}, Message Delay: ${messageDelay}ms, Batch Delay: ${batchDelay}ms`);
        
        const results = [];
        let totalSent = 0;
        let totalFailed = 0;
        
        // Process in batches
        for (let i = 0; i < phoneNumbers.length; i += batchSize) {
            const batch = phoneNumbers.slice(i, i + batchSize);
            const batchNum = Math.floor(i / batchSize) + 1;
            const totalBatches = Math.ceil(phoneNumbers.length / batchSize);
            
            console.log(`📦 Batch ${batchNum}/${totalBatches} (${batch.length} contacts)`);
            
            for (const entry of batch) {
                try {
                    const phone = (entry && typeof entry === 'object')
                        ? (entry.phone || entry.phone_number || entry.number || entry.to || entry.to_number)
                        : entry;

                    const perRecipientMessage = (entry && typeof entry === 'object')
                        ? (entry.message || entry.text)
                        : null;

                    const effectiveMessage = String(perRecipientMessage != null ? perRecipientMessage : (broadcastMessage || ''));

                    // Normalize: digits only + add country code if user provided local 10-digit number.
                    const rawDigits = String(phone).replace(/[^0-9]/g, '');
                    const agentDigits = String(WHATSAPP_PHONE || '').replace(/[^0-9]/g, '');
                    const inferredCountryCode = agentDigits.length > 10 ? agentDigits.slice(0, agentDigits.length - 10) : '';
                    const cleanPhone = (rawDigits.length === 10 && inferredCountryCode)
                        ? `${inferredCountryCode}${rawDigits}`
                        : rawDigits;
                    const chatId = `${cleanPhone}@c.us`;

                    // Avoid false "sent" if the number isn't a WhatsApp user
                    const isRegistered = await global.whatsappClient.isRegisteredUser(chatId);
                    if (!isRegistered) {
                        throw new Error('Recipient is not registered on WhatsApp');
                    }
                    
                    // Handle image + text (1..N images) or text only
                    if (messageType === 'image' && images.length) {
                        const { MessageMedia } = require('whatsapp-web.js');

                        for (let j = 0; j < images.length; j++) {
                            const img = images[j];

                            // Extract base64 data and mime type
                            let base64Data = img;
                            let mimeType = 'image/jpeg';

                            if (typeof img === 'string' && img.includes('base64,')) {
                                const parts = img.split('base64,');
                                base64Data = parts[1];
                                const mimeMatch = parts[0].match(/data:([^;]+)/);
                                if (mimeMatch) mimeType = mimeMatch[1];
                            }

                            const media = new MessageMedia(mimeType, base64Data);
                            await global.whatsappClient.sendMessage(chatId, media, { caption: j === 0 ? effectiveMessage : '' });
                        }
                        console.log(`✅ Sent ${images.length} image(s) to ${cleanPhone}`);
                    } else {
                        await global.whatsappClient.sendMessage(chatId, effectiveMessage);
                        console.log(`✅ Sent text to ${cleanPhone}`);
                    }
                    
                    results.push({ phone: cleanPhone, status: 'sent', timestamp: new Date().toISOString() });
                    totalSent++;
                    
                    // Delay between messages
                    if (messageDelay > 0) {
                        await new Promise(resolve => setTimeout(resolve, messageDelay));
                    }
                } catch (error) {
                    console.error(`❌ Failed to send to ${phone}:`, error.message);
                    results.push({ phone: phone, status: 'failed', error: error.message, timestamp: new Date().toISOString() });
                    totalFailed++;
                }
            }
            
            // Delay between batches
            if (i + batchSize < phoneNumbers.length && batchDelay > 0) {
                console.log(`⏳ Waiting ${batchDelay}ms before next batch...`);
                await new Promise(resolve => setTimeout(resolve, batchDelay));
            }
        }
        
        console.log(`\n📊 Broadcast complete: ${totalSent} sent, ${totalFailed} failed`);
        
        res.json({ 
            ok: true, 
            totalSent,
            totalFailed,
            results,
            summary: {
                total: phoneNumbers.length,
                sent: totalSent,
                failed: totalFailed,
                successRate: ((totalSent / phoneNumbers.length) * 100).toFixed(2) + '%'
            }
        });
        
    } catch (error) {
        console.error('❌ Broadcast error:', error);
        res.status(500).json({ error: 'Broadcast failed' });
    }
});

// Authentication callback endpoint
localApp.post('/auth-callback', (req, res) => {
    const { tenantId, phone } = req.body;
    
    if (!tenantId) {
        return res.status(400).json({ error: 'Missing tenant ID' });
    }
    
    TENANT_ID = tenantId;
    isAuthenticated = true;
    
    // Save to .env file
    const envPath = path.join(__dirname, '.env');
    let envContent = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
    
    if (envContent.includes('TENANT_ID=')) {
        envContent = envContent.replace(/TENANT_ID=.*/, `TENANT_ID=${tenantId}`);
    } else {
        envContent += `\nTENANT_ID=${tenantId}`;
    }
    
    fs.writeFileSync(envPath, envContent);
    
    console.log(`\n✅ Authenticated as: ${phone}`);
    console.log(`🆔 Tenant ID: ${tenantId}`);
    
    res.json({ 
        ok: true, 
        message: 'Authentication successful. You can close this window.',
        tenantId 
    });
    
    // Initialize WhatsApp client after authentication
    setTimeout(() => {
        initializeWhatsApp();
    }, 2000);
});

// Start local server
localApp.listen(LOCAL_PORT, () => {
    console.log(`🏥 Health endpoint: http://localhost:${LOCAL_PORT}/health`);
});

console.log('🚀 Starting Desktop Agent...');
console.log(`📡 Cloud Server: ${CLOUD_SERVER_URL}`);
console.log(`📱 WhatsApp Phone: ${WHATSAPP_PHONE}`);
console.log('\n🔄 Initializing WhatsApp...');

// Auto-start WhatsApp initialization
initializeWhatsApp();

async function initializeWhatsApp() {
    console.log('\n🔍 Fetching tenant information...');
    
    try {
        // Use tenant ID from .env if provided, otherwise fetch from cloud
        if (!TENANT_ID) {
            // Fetch tenant ID from cloud server using phone number
            const response = await axios.post(`${CLOUD_SERVER_URL}/api/agent-get-tenant`, {
                phoneNumber: WHATSAPP_PHONE
            }, {
                headers: { 'x-api-key': API_KEY }
            });
            
            if (response.data && response.data.tenantId) {
                TENANT_ID = response.data.tenantId;
                console.log(`✅ Tenant ID (from cloud): ${TENANT_ID}`);
            } else {
                console.error('❌ Phone number not registered. Please register first at:');
                console.error(`   ${CLOUD_SERVER_URL}/agent-login.html`);
                process.exit(1);
            }
        } else {
            console.log(`✅ Tenant ID (from .env): ${TENANT_ID}`);
        }
    } catch (error) {
        console.error('❌ Failed to fetch tenant info:', error.message);
        console.error('   Please register at:', `${CLOUD_SERVER_URL}/agent-login.html`);
        process.exit(1);
    }
    
    console.log('\n🔄 Initializing WhatsApp client...');
    
    // Session cleanup - check for corrupted sessions
    const fs = require('fs');
    const path = require('path');
    const sessionDir = '.wwebjs_auth';
    const cacheDir = '.wwebjs_cache';
    
    // Check for lockfile (indicates crashed session)
    const lockfile = path.join(sessionDir, 'session', 'lockfile');
    if (fs.existsSync(lockfile)) {
        console.log('⚠️  Found crashed session lockfile - cleaning...');
        try {
            fs.unlinkSync(lockfile);
            console.log('✅ Lockfile removed');
        } catch (err) {
            console.log('⚠️  Could not remove lockfile:', err.message);
        }
    }
    
    // Check if session exists but is corrupted (no session-* file inside)
    const sessionPath = path.join(sessionDir, 'session');
    if (fs.existsSync(sessionPath)) {
        try {
            const files = fs.readdirSync(sessionPath);
            const hasSessionFile = files.some(f => f.startsWith('session-') && !f.includes('lockfile'));
            
            if (!hasSessionFile && files.length > 0) {
                console.log('⚠️  Detected corrupted session - deleting...');
                fs.rmSync(sessionDir, { recursive: true, force: true });
                console.log('✅ Corrupted session deleted - will show QR code');
            }
        } catch (err) {
            console.log('⚠️  Could not check session:', err.message);
        }
    }
    
    // Clean cache to save space
    if (fs.existsSync(cacheDir)) {
        try {
            fs.rmSync(cacheDir, { recursive: true, force: true });
        } catch (err) {
            // Ignore cache errors
        }
    }
    
    // WhatsApp Client with local session storage
    console.log('📦 Creating WhatsApp client...');
    const client = new Client({
    authStrategy: new LocalAuth({
        dataPath: './.wwebjs_auth'
    }),
    puppeteer: {
        headless: true,
        executablePath: executablePath,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--disable-gpu'
        ]
    }
});
console.log('✅ WhatsApp client created');

// Store client globally for broadcast access
global.whatsappClient = client;

console.log('🚀 Starting Desktop Agent...');
console.log(`📡 Cloud Server: ${CLOUD_SERVER_URL}`);
console.log(`👤 Tenant ID: ${TENANT_ID}`);
console.log(`🏥 Health endpoint: http://localhost:${LOCAL_PORT}/health`);
console.log('\n⏳ Initializing WhatsApp client...');

// Loading Event
client.on('loading_screen', (percent, message) => {
    console.log(`⏳ Loading: ${percent}% - ${message}`);
});

// Authentication events
client.on('auth_failure', msg => {
    console.error('❌ Authentication failed:', msg);
});

client.on('change_state', state => {
    console.log('🔄 State changed:', state);
});

// Disconnection events
client.on('disconnected', (reason) => {
    console.log('⚠️  Disconnected:', reason);
});

// QR Code Event
client.on('qr', (qr) => {
    console.log('\n📱 Scan this QR code with WhatsApp:');
    qrcode.generate(qr, { small: true });
    
    notifier.notify({
        title: 'WhatsApp Desktop Agent',
        message: 'Scan QR code to connect',
        sound: true
    });
});

// Remote Session Saved Event
client.on('remote_session_saved', () => {
    console.log('💾 Session saved successfully');
});

// Ready Event
client.on('ready', async () => {
    console.log('✅ WhatsApp Web connected successfully!');
    console.log('📞 Phone number:', client.info.wid.user);
    
    notifier.notify({
        title: 'WhatsApp Connected',
        message: `Connected as ${client.info.pushname}`,
        sound: true
    });
    
    // Register with cloud server
    try {
        await axios.post(`${CLOUD_SERVER_URL}/api/desktop-agent/register`, {
            tenantId: TENANT_ID,
            phoneNumber: client.info.wid.user,
            deviceName: require('os').hostname(),
            status: 'online'
        }, {
            headers: { 'x-api-key': API_KEY }
        });
        console.log('✅ Registered with cloud server');
    } catch (error) {
        console.error('❌ Failed to register with cloud server:', error.message);
    }
});

// Authenticated Event
client.on('authenticated', () => {
    console.log('🔐 Authentication successful');
});

// Authentication Failure Event
client.on('auth_failure', (msg) => {
    console.error('❌ Authentication failed:', msg);
    notifier.notify({
        title: 'WhatsApp Authentication Failed',
        message: 'Please restart the agent',
        sound: true
    });
});

// Disconnected Event
client.on('disconnected', (reason) => {
    console.log('❌ WhatsApp disconnected:', reason);
    notifier.notify({
        title: 'WhatsApp Disconnected',
        message: reason,
        sound: true
    });
});

// Message Received Event
client.on('message', async (message) => {
    try {
        const from = message.from;
        const body = message.body;
        const isGroup = from.endsWith('@g.us');
        const isStatus = from === 'status@broadcast';
        
        // Ignore group messages and status updates
        if (isGroup || isStatus) return;
        
        // 🛡️ BOT DETECTION - Prevent bot-to-bot infinite loops
        const botSignatures = [
            'sorry, i cannot process',
            'sorry i cannot process',
            'i am temporarily unable to process',
            'temporarily unable to process your message',
            'cannot help',
            'auto-reply',
            'automated message',
            'bot response',
            'cannot understand your request'
        ];
        
        const lowerBody = body.toLowerCase().trim();
        const isBotMessage = botSignatures.some(sig => lowerBody.includes(sig));
        
        // Ignore messages from other bots
        if (isBotMessage) {
            console.log(`🤖 Ignoring bot message from ${from}: ${body.substring(0, 50)}...`);
            return;
        }
        
        console.log(`\n📨 Message from ${from}: ${body}`);
        console.log(`📤 Sending to cloud server: ${CLOUD_SERVER_URL}/api/desktop-agent/process-message`);
        console.log(`🔑 Tenant ID: ${TENANT_ID}`);
        
        // Send to cloud server for AI processing
        const response = await axios.post(
            `${CLOUD_SERVER_URL}/api/desktop-agent/process-message`,
            {
                tenantId: TENANT_ID,
                from: from,
                message: body,
                timestamp: new Date().toISOString(),
                messageId: message.id._serialized
            },
            {
                headers: { 'x-api-key': API_KEY },
                timeout: 60000 // Increased to 60 seconds
            }
        );
        
        console.log(`📥 Received response from cloud:`, response.data);
        const aiResponse = response.data.reply;
        
        if (aiResponse) {
            console.log(`🤖 AI Response: ${aiResponse.substring(0, 100)}...`);
            
            // Send reply via WhatsApp
            await message.reply(aiResponse);
            console.log('✅ Reply sent');
            
            // Optional: Notify cloud that message was sent
            await axios.post(
                `${CLOUD_SERVER_URL}/api/desktop-agent/message-sent`,
                {
                    tenantId: TENANT_ID,
                    messageId: message.id._serialized,
                    sentAt: new Date().toISOString()
                },
                {
                    headers: { 'x-api-key': API_KEY }
                }
            ).catch(() => {}); // Silent fail
        }
        
    } catch (error) {
        console.error('❌ Error processing message:');
        console.error('  Message:', error.message);
        if (error.response) {
            console.error('  Status:', error.response.status);
            console.error('  Data:', JSON.stringify(error.response.data, null, 2));
        } else if (error.code === 'ECONNABORTED') {
            console.error('  Reason: Request timed out (exceeded 60 seconds)');
        } else if (error.code) {
            console.error('  Code:', error.code);
        }
        console.error('  Stack:', error.stack);
        
        // Fallback response if cloud is down
        try {
            await message.reply('Sorry, I am temporarily unable to process your message. Please try again in a moment.');
        } catch (e) {
            console.error('❌ Failed to send fallback message:', e.message);
        }
    }
});

// Message Create Event (for sent messages)
client.on('message_create', async (message) => {
    // Track outgoing messages if needed
    if (message.fromMe) {
        console.log(`📤 Sent message to ${message.to}: ${message.body}`);
    }
});

// Error handling
process.on('unhandledRejection', (error) => {
    console.error('❌ Unhandled rejection:', error);
});

process.on('SIGINT', async () => {
    console.log('\n👋 Shutting down gracefully...');
    
    // Notify cloud server
    try {
        await axios.post(`${CLOUD_SERVER_URL}/api/desktop-agent/disconnect`, {
            tenantId: TENANT_ID
        }, {
            headers: { 'x-api-key': API_KEY }
        });
    } catch (error) {
        // Silent fail
    }
    
    if (client) {
        await client.destroy();
    }
    process.exit(0);
});

// Initialize WhatsApp client
console.log('⏳ Initializing WhatsApp client...');

// Set a hard timeout for initialization (90 seconds)
const initTimeout = setTimeout(() => {
    console.log('\n⚠️  Initialization timeout - forcing restart...');
    console.log('💡 If this happens repeatedly, delete .wwebjs_auth folder');
    process.exit(1);
}, 90000); // 90 seconds - hard kill

// Set a warning timeout (30 seconds)
const warningTimeout = setTimeout(() => {
    console.log('\n⏳ Still initializing... (this can take 1-2 minutes for first time)');
    console.log('💡 Make sure you have a stable internet connection');
}, 30000);

client.initialize().then(() => {
    clearTimeout(initTimeout);
    clearTimeout(warningTimeout);
    console.log('✅ WhatsApp client initialized successfully');
}).catch(err => {
    clearTimeout(initTimeout);
    clearTimeout(warningTimeout);
    console.error('\n❌ Failed to initialize WhatsApp client:', err.message);
    console.error('💡 Try these steps:');
    console.error('   1. Check your internet connection');
    console.error('   2. Delete .wwebjs_auth and .wwebjs_cache folders');
    console.error('   3. Restart the agent');
    process.exit(1);
});
}
