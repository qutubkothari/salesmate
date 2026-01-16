/**
 * @title Dynamic Menu Service
 * @description Provides context-aware menu options for WhatsApp bot users
 */

/**
 * Generates main menu for tenant (admin) users
 */
const getTenantMainMenu = () => {
  return `🏢 *ADMIN MENU* 🏢

📊 *ANALYTICS & REPORTS*
• /leads - View lead summary
• /stats - Bot activity statistics  
• /analytics - Campaign performance
• /customer_snapshot <phone> - 360° customer view
• /export_leads - Download Excel report

🛍️ *PRODUCTS & CONTENT*
• /products - Upload product catalog
• /add_faq "question" "answer" - Add FAQ
• /list_faqs - View all FAQs
• /add_keyword <word> <response> - Auto-replies

📢 *MARKETING*
• /broadcast - Send bulk messages
• /create_drip <name> - Automated campaigns
• /generate_copy "topic" - AI marketing copy

⚙️ *SETTINGS*
• /settings - Bot configuration menu
• /business - Business profile menu

💬 *HELP & SUPPORT*
• /help - Show this menu
• /support "subject" "description" - Get help

Type any option or /help to see this menu again.`;
};

/**
 * Generates settings submenu for tenant users
 */
const getTenantSettingsMenu = () => {
  return `⚙️ *BOT SETTINGS* ⚙️

🤖 *BOT PERSONALITY*
• /set_personality "description" - Bot's tone
• /set_language <language> - Response language
• /set_welcome "message" - Welcome message

🕐 *BUSINESS HOURS*
• /set_office_hours <start> <end> - Business hours
• /set_timezone <timezone> - Your timezone
• /set_auto_reply "message" - After-hours message

🔑 *KEYWORDS & RESPONSES*
• /add_keyword <word> <response> - Auto-replies
• /delete_keyword <word> - Remove auto-reply
• /list_keywords - View all keywords

↩️ Type /help for main menu`;
};

/**
 * Generates business profile submenu
 */
const getBusinessProfileMenu = () => {
  return `🏢 *BUSINESS PROFILE* 🏢

📝 *BASIC INFO*
• /set_business_name <name> - Your business name
• /set_business_address <address> - Full address
• /set_business_website <url> - Website URL

📊 *SUBSCRIPTION*
• /status - Check subscription status
• /activate <key> - Activate/extend subscription
• /billing - Payment portal link

🎁 *REFERRALS*
• /my_referral_code - Get your referral code
• /apply_referral_code <code> - Use referral code

↩️ Type /help for main menu`;
};

/**
 * Generates customer menu (for end users)
 */
const getCustomerMenu = () => {
  return `🛍️ *CUSTOMER MENU* 🛍️

🛒 *SHOPPING*
• /add_to_cart <product> - Add item to cart
• /view_cart - See your cart
• /checkout - Complete purchase
• /order_status - Check your order

� *CARTON PRODUCTS*
• /add_carton <qty> <product> - Add cartons to cart
• /view_carton_cart - View cart with carton pricing

�📞 *CONTACT & SUPPORT*
• /contact - Fill contact form
• /feedback - Leave feedback
• /book_appointment - Schedule meeting

🎯 *QUICK OPTIONS*
• menu - Show this menu
• help - Get assistance

Just ask me about our products naturally! 
Example: "Do you have laptops?" or "Show me phones under 30000"`;
};

/**
 * Generates marketing submenu
 */
const getMarketingMenu = () => {
  return `📢 *MARKETING TOOLS* 📢

📤 *BROADCASTS*
• /broadcast "Campaign" "Time" "Message" - Send bulk messages
• /broadcast_to_segment "Segment" - Target specific customers
• /list_broadcasts - View sent campaigns

🎯 *DRIP CAMPAIGNS*
• /create_drip <name> - New automated campaign
• /add_drip_message "camp" <seq> <hours> "msg" - Add message
• /list_drips - View all campaigns
• /subscribe_to_drip <name> - Add contacts to campaign

✍️ *CONTENT CREATION*
• /generate_copy "topic" - AI marketing copy
• /abandoned_cart_message "msg" - Cart recovery message

↩️ Type /help for main menu`;
};

/**
 * Main menu handler - determines user type and shows appropriate menu
 */
const handleMenuRequest = async (userPhone, tenantId, isAdmin = false) => {
  try {
    if (isAdmin) {
      // Admin/Tenant user
      return getTenantMainMenu();
    } else {
      // End user/Customer
      return getCustomerMenu();
    }
  } catch (error) {
    console.error('Error generating menu:', error);
    return `❌ Error loading menu. Try typing specific commands or contact support.`;
  }
};

/**
 * Context-aware menu handler for specific submenus
 */
const handleSubmenuRequest = (menuType) => {
  switch (menuType.toLowerCase()) {
    case 'settings':
      return getTenantSettingsMenu();
    case 'business':
      return getBusinessProfileMenu();
    case 'marketing':
      return getMarketingMenu();
    default:
      return getTenantMainMenu();
  }
};

/**
 * Smart menu detection - detects when user wants menu
 */
const isMenuRequest = (message) => {
  const menuKeywords = [
    'menu', 'help', 'options', 'commands', 'what can you do',
    '/help', '/menu', 'show options', 'show commands',
    'kya kar sakte ho', 'options kya hai', 'help me',
    'मेन्यू', 'विकल्प', 'सहायता'
  ];
  
  const lowerMessage = message.toLowerCase().trim();
  return menuKeywords.some(keyword => lowerMessage.includes(keyword));
};

/**
 * Quick action shortcuts for common requests
 */
const getQuickActions = (isAdmin = false) => {
  if (isAdmin) {
    return `🚀 *QUICK ACTIONS*

📊 /leads - See leads now
🛍️ /products - Upload products  
📢 /broadcast - Send campaign
⚙️ /settings - Bot settings
💬 /help - Full menu`;
  } else {
    return `🚀 *QUICK ACTIONS*

🛒 View products - "Show me products"
💬 Ask questions - "Do you have laptops?"
🛒 /view_cart - Check your cart
📞 /contact - Get in touch
💬 menu - Show full menu`;
  }
};

module.exports = {
  getTenantMainMenu,
  getTenantSettingsMenu,
  getBusinessProfileMenu,
  getCustomerMenu,
  getMarketingMenu,
  handleMenuRequest,
  handleSubmenuRequest,
  isMenuRequest,
  getQuickActions
};
