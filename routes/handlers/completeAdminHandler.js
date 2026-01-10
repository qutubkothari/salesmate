// routes/handlers/completeAdminHandler.js
// This contains ALL the missing admin commands from your original webhook

const { sendMessage } = require('../../services/whatsappService');
const { dbClient } = require('../../services/config');
const menuService = require('../../services/menuService');

// Import all the services that were missing
const { 
  createSegment, deleteSegment, listSegments, 
  segmentConversation, listConversationSegments 
} = require('../../services/segmentationService');

const { 
  createDripCampaign, addMessageToDripCampaign, 
  subscribeUsersFromSheet, listDripCampaigns, 
  viewDripCampaign, deleteDripCampaign, unsubscribeUser 
} = require('../../services/dripCampaignService');

const { 
  addKeyword, deleteKeyword, listKeywords,
  addQuickReply, deleteQuickReply, listQuickReplies,
  addFaq, deleteFaq, listFaqs
} = require('../../services/keywordService');

const { 
  getLeadSummary, exportLeadsToExcel 
} = require('../../services/leadService');

const { 
  getCampaignAnalytics,
  getUsageStats 
} = require('../../services/analyticsService');

const { 
  processReferral 
} = require('../../services/referralService');

const { 
  createDiscount, 
  listDiscounts, 
  applyDiscount: applyDiscountToCart,
  removeDiscount: removeDiscountFromCart
} = require('../../services/discountService');

const { 
  setupCartonPricing, 
  bulkSetupNFFCartonPricing, 
  testCartonPricing 
} = require('../../services/cartonPricingService');

const { 
    createProductWithVariants, 
    addVariantAttributes, 
    getVariantAttributes 
} = require('../../services/enhancedProductService');

const { 
  createSupportTicket 
} = require('../../services/supportTicketService');

const { 
  updateOrderStatus 
} = require('../../services/orderService');

const { 
  getFeedbackReport 
} = require('../../services/feedbackService');

const { 
  setManualReminder 
} = require('../../services/reminderService');

const { 
  getFollowUpSuggestion 
} = require('../../services/followUpSuggestionService');

const { 
  generateSalesInsights 
} = require('../../services/salesInsightService');

const { 
  getCustomerSnapshot 
} = require('../../services/customerSnapshotService');

const { 
  scheduleBroadcastToSegment, 
  scheduleBroadcast 
} = require('../../services/broadcastService');

const { 
  syncInvoiceFromZoho, 
  syncAllInvoicesFromZoho 
} = require('../../services/zohoInvoiceSyncService');

const { 
  handleShipmentsCommand, 
  handleCheckShipmentsCommand, 
  handleTrackShipmentCommand 
} = require('../../commands/shipments');

/**
 * Parses commands that have arguments in quotes.
 */
const parseQuotedArgs = (text) => {
  const regex = /"([^"]+)"/g;
  const matches = [];
  let match;
  while ((match = regex.exec(text)) !== null) {
    matches.push(match[1]);
  }
  return matches;
};

/**
 * Complete admin command handler with ALL missing commands
 */
const handleCompleteAdminCommands = async (tenant, from, txt, raw) => {
  
  // === Zoho Invoice Sync Commands ===
  if (txt.startsWith('/sync-invoice ') || txt.startsWith('/sync_invoice ')) {
    const invoiceId = txt.split(' ')[1];
    if (!invoiceId) {
      await sendMessage(from, 'âŒ Usage: /sync-invoice <invoice_id>\n\nExample: /sync-invoice 1234567890');
      return true;
    }
    
    await sendMessage(from, `ðŸ”„ Syncing invoice ${invoiceId} from Zoho...`);
    const result = await syncInvoiceFromZoho(tenant.id, invoiceId);
    
    if (result.success) {
      const inv = result.invoice;
      const message = `âœ… *Invoice Synced Successfully*\n\n` +
        `ðŸ“„ Invoice: ${inv.invoiceNumber}\n` +
        `ðŸ’° Total: â‚¹${inv.total}\n` +
        `ðŸ“Š Status: ${inv.status}\n` +
        `ðŸ”¢ Items Updated: ${inv.updatedItems}\n\n` +
        `All changes from Zoho have been saved to your database.`;
      await sendMessage(from, message);
    } else {
      await sendMessage(from, `âŒ Sync failed: ${result.error}`);
    }
    return true;
  }

  if (txt === '/sync-all-invoices' || txt === '/sync_all_invoices' || txt === '/sync-invoices') {
    await sendMessage(from, 'ðŸ”„ Syncing all invoices from Zoho... This may take a moment.');
    
    const result = await syncAllInvoicesFromZoho(tenant.id, 30);
    
    if (result.success) {
      const message = `âœ… *Invoice Sync Complete*\n\n` +
        `ðŸ“Š Total Invoices: ${result.totalInvoices}\n` +
        `âœ… Successfully Synced: ${result.synced}\n` +
        `âŒ Errors: ${result.errors}\n\n` +
        `All invoice data has been updated in your database.`;
      await sendMessage(from, message);
    } else {
      await sendMessage(from, `âŒ Sync failed: ${result.error}`);
    }
    return true;
  }

  // ===== SHIPMENT TRACKING COMMANDS =====
  
  if (txt === '/shipments') {
    await handleShipmentsCommand(from, tenant.id);
    return true;
  }

  if (txt === '/check_shipments' || txt === '/check-shipments') {
    await handleCheckShipmentsCommand(from, tenant.id);
    return true;
  }

  if (txt.startsWith('/track ')) {
    const lrNumber = txt.replace('/track ', '').trim();
    await handleTrackShipmentCommand(from, tenant.id, lrNumber);
    return true;
  }

  // === Help/Menu Command ===
  if (txt.toLowerCase() === '/help' || txt.toLowerCase() === '/menu') {
    const menuResponse = await menuService.handleMenuRequest(from, tenant.id, true);
    await sendMessage(from, menuResponse);
    return true;
  }
  
  // === Customer Segmentation Commands ===
  if (txt.startsWith('/add_segment ')) {
    const segmentName = txt.substring('/add_segment '.length).trim();
    if (!segmentName) {
      await sendMessage(from, 'Usage: /add_segment <SegmentName>');
      return true;
    }
    const result = await createSegment(tenant.id, segmentName);
    await sendMessage(from, result);
    return true;
  }

  if (txt.startsWith('/delete_segment ')) {
    const segmentName = txt.substring('/delete_segment '.length).trim();
    if (!segmentName) {
      await sendMessage(from, 'Usage: /delete_segment <SegmentName>');
      return true;
    }
    const result = await deleteSegment(tenant.id, segmentName);
    await sendMessage(from, result);
    return true;
  }

  if (txt === '/list_segments') {
    const result = await listSegments(tenant.id);
    await sendMessage(from, result);
    return true;
  }

  if (txt.startsWith('/view_segments ')) {
    const endUserPhone = txt.split(' ')[1];
    if (!endUserPhone) {
      await sendMessage(from, 'Usage: /view_segments <customer_phone>');
      return true;
    }
    const result = await listConversationSegments(tenant.id, endUserPhone);
    await sendMessage(from, result);
    return true;
  }

  // === Drip Campaign Commands ===
  if (txt.startsWith('/create_drip ')) {
    const campaignName = txt.substring('/create_drip '.length).trim();
    if (!campaignName) {
      await sendMessage(from, 'Usage: /create_drip <CampaignName>');
      return true;
    }
    const result = await createDripCampaign(tenant.id, campaignName);
    await sendMessage(from, result);
    return true;
  }

  if (txt.startsWith('/add_drip_message ')) {
    const parts = txt.replace(/"[^"]+"/g, '').trim().split(' ');
    const quotedArgs = parseQuotedArgs(txt);
    if (quotedArgs.length < 2 || parts.length < 4) {
      await sendMessage(from, 'Usage: /add_drip_message "<Campaign>" <Seq> <Hours> "<Message>"');
      return true;
    }
    const campaignName = quotedArgs[0];
    const messageBody = quotedArgs[1];
    const sequence = parseInt(parts[2], 10);
    const delayHours = parseInt(parts[3], 10);

    if (isNaN(sequence) || isNaN(delayHours)) {
      await sendMessage(from, 'Invalid sequence or delay. They must be numbers.');
      return true;
    }
    const result = await addMessageToDripCampaign(tenant.id, campaignName, sequence, delayHours, messageBody);
    await sendMessage(from, result);
    return true;
  }

  if (txt.startsWith('/subscribe_to_drip ')) {
    const campaignName = txt.substring('/subscribe_to_drip '.length).trim();
    if (!campaignName) {
      await sendMessage(from, 'Usage: /subscribe_to_drip <CampaignName>');
      return true;
    }

    const context = { type: 'awaiting_drip_subscribers', campaignName };
    await dbClient.from('tenants').update({ last_command_context: JSON.stringify(context) }).eq('id', tenant.id);
    await sendMessage(from, `Ready to subscribe users to "${campaignName}". Please upload the Excel file with contact numbers now.`);
    return true;
  }

  if (txt === '/list_drips') {
    const result = await listDripCampaigns(tenant.id);
    await sendMessage(from, result);
    return true;
  }

  if (txt.startsWith('/view_drip ')) {
    const campaignName = txt.substring('/view_drip '.length).trim();
    if (!campaignName) await sendMessage(from, 'Usage: /view_drip <CampaignName>');
    return true;
    const result = await viewDripCampaign(tenant.id, campaignName);
    await sendMessage(from, result);
    return true;
  }

  if (txt.startsWith('/delete_drip ')) {
    const campaignName = txt.substring('/delete_drip '.length).trim();
    if (!campaignName) await sendMessage(from, 'Usage: /delete_drip <CampaignName>');
    return true;
    const result = await deleteDripCampaign(tenant.id, campaignName);
    await sendMessage(from, result);
    return true;
  }

  // === Keyword Management Commands ===
  if (txt.startsWith('/add_keyword ')) {
    const parts = txt.split(' ');
    const keyword = parts[1];
    const response = parts.slice(2).join(' ');
    if (!keyword || !response) {
      await sendMessage(from, 'Usage: /add_keyword <keyword> <response text>');
    return true;
    }
    const result = await addKeyword(tenant.id, keyword, response);
    await sendMessage(from, result);
    return true;
  }

  if (txt.startsWith('/delete_keyword ')) {
    const keyword = txt.split(' ')[1];
    if (!keyword) {
      await sendMessage(from, 'Usage: /delete_keyword <keyword>');
    return true;
    }
    const result = await deleteKeyword(tenant.id, keyword);
    await sendMessage(from, result);
    return true;
  }

  if (txt === '/list_keywords') {
    const result = await listKeywords(tenant.id);
    await sendMessage(from, result);
    return true;
  }

  // === Quick Reply Management Commands ===
  if (txt.startsWith('/add_qr ')) {
    const parts = txt.split(' ');
    const trigger = parts[1];
    const response = parts.slice(2).join(' ');
    if (!trigger || !response) {
      await sendMessage(from, 'Usage: /add_qr <trigger_phrase> <response_text>');
    return true;
    }
    const result = await addQuickReply(tenant.id, trigger, response);
    await sendMessage(from, result);
    return true;
  }

  if (txt.startsWith('/delete_qr ')) {
    const trigger = txt.split(' ')[1];
    if (!trigger) {
      await sendMessage(from, 'Usage: /delete_qr <trigger_phrase>');
    return true;
    }
    const result = await deleteQuickReply(tenant.id, trigger);
    await sendMessage(from, result);
    return true;
  }

  if (txt === '/list_qr') {
    const result = await listQuickReplies(tenant.id);
    await sendMessage(from, result);
    return true;
  }

  // === Business Profile Commands ===
  if (txt.startsWith('/set_business_name ')) {
    const name = txt.substring('/set_business_name '.length).trim();
    if (!name) await sendMessage(from, 'Usage: /set_business_name <Your Business Name>');
    return true;
    await dbClient.from('tenants').update({ business_name: name }).eq('id', tenant.id);
    await sendMessage(from, 'Business name updated successfully.');
    return true;
  }

  if (txt.startsWith('/set_business_address ')) {
    const address = txt.substring('/set_business_address '.length).trim();
    if (!address) await sendMessage(from, 'Usage: /set_business_address <Your Full Address>');
    return true;
    await dbClient.from('tenants').update({ business_address: address }).eq('id', tenant.id);
    await sendMessage(from, 'Business address updated successfully.');
    return true;
  }

  if (txt.startsWith('/set_business_website ')) {
    const website = txt.substring('/set_business_website '.length).trim();
    if (!website) await sendMessage(from, 'Usage: /set_business_website <https://yourwebsite.com>');
    return true;
    await dbClient.from('tenants').update({ business_website: website }).eq('id', tenant.id);
    await sendMessage(from, 'Business website updated successfully.');
    return true;
  }

  // === Office Hours Commands ===
  if (txt.startsWith('/set_office_hours ')) {
    const parts = txt.split(' ');
    const startTime = parts[1];
    const endTime = parts[2];
    if (!startTime || !endTime || !/^\d{2}:\d{2}$/.test(startTime) || !/^\d{2}:\d{2}$/.test(endTime)) {
      await sendMessage(from, 'Invalid format. Usage: /set_office_hours HH:MM HH:MM (e.g., /set_office_hours 09:00 17:00)');
      return true;
    }
    await dbClient.from('tenants').update({ office_hours_start: startTime, office_hours_end: endTime }).eq('id', tenant.id);
    await sendMessage(from, `Office hours have been set from ${startTime} to ${endTime}.`);
    return true;
  }

  if (txt.startsWith('/set_timezone ')) {
    const timezone = txt.split(' ')[1];
    if (!timezone) {
      await sendMessage(from, 'Please provide a timezone. Usage: /set_timezone America/New_York');
    return true;
    }
    await dbClient.from('tenants').update({ office_hours_timezone: timezone }).eq('id', tenant.id);
    await sendMessage(from, `Your timezone has been set to ${timezone}.`);
    return true;
  }

  if (txt.startsWith('/set_auto_reply ')) {
    const replyMsg = txt.substring('/set_auto_reply '.length).trim();
    if (!replyMsg) {
      await sendMessage(from, 'Please provide a message. Usage: /set_auto_reply We are currently closed...');
    return true;
    }
    await dbClient.from('tenants').update({ auto_reply_message: replyMsg }).eq('id', tenant.id);
    await sendMessage(from, 'Your auto-reply message for closed hours has been saved.');
    return true;
  }

  // === Advanced Settings Commands ===
  if (txt.startsWith('/set_language ')) {
    const language = txt.substring('/set_language '.length).trim();
    if (!language) {
      await sendMessage(from, 'Please provide a language. Usage: /set_language Spanish');
    return true;
    }
    await dbClient.from('tenants').update({ bot_language: language }).eq('id', tenant.id);
    await sendMessage(from, `Your bot's language has been set to ${language}.`);
    return true;
  }

  if (txt.startsWith('/personality ')) {
    const personality = txt.substring('/personality '.length).trim();
    if (!personality) {
      await sendMessage(from, 'Please provide a personality description. Usage: /personality You are a helpful bot.');
    return true;
    }
    await dbClient.from('tenants').update({ bot_personality: personality }).eq('id', tenant.id);
    await sendMessage(from, 'Your bot personality has been updated successfully!');
    return true;
  }

  if (txt.startsWith('/welcome ')) {
    const welcomeMessage = txt.substring('/welcome '.length).trim();
    if (!welcomeMessage) {
      await sendMessage(from, 'Please provide a welcome message. Usage: /welcome Hello! How can I help you?');
    return true;
    }
    await dbClient.from('tenants').update({ welcome_message: welcomeMessage }).eq('id', tenant.id);
    await sendMessage(from, 'Your custom welcome message has been saved successfully!');
    return true;
  }

  // === Referral Program Commands ===
  if (txt === '/my_referral_code') {
    const referralMessage = `Your unique referral code is: *${tenant.referral_code}*\n\nShare this with a friend! When they sign up and apply it, you'll both get a subscription bonus.`;
    await sendMessage(from, referralMessage);
    return true;
  }

  if (txt.startsWith('/apply_referral_code ')) {
    const code = txt.split(' ')[1];
    if (!code) {
      await sendMessage(from, 'Usage: /apply_referral_code <CODE>');
    return true;
    }
    const result = await processReferral(tenant.id, code);
    await sendMessage(from, result.message);
    return true;
  }

  // === Support & Order Management ===
  if (txt.startsWith('/support ')) {
    const args = parseQuotedArgs(txt);
    if (args.length !== 2) {
      await sendMessage(from, 'Usage: /support "<subject>" "<description>"');
    return true;
    }
    const [subject, description] = args;
    const result = await createSupportTicket(tenant.id, subject, description);
    await sendMessage(from, result);
    return true;
  }

  if (txt.startsWith('/update_order_status ')) {
    const parts = txt.split(' ');
    const endUserPhone = parts[1];
    const newStatus = parts[2];
    if (!endUserPhone || !newStatus) {
      await sendMessage(from, 'Usage: /update_order_status <customer_phone> <new_status>');
    return true;
    }
    const result = await updateOrderStatus(tenant.id, endUserPhone, newStatus);
    await sendMessage(from, result);
    return true;
  }

  // === Reporting & Analytics Commands ===
  if (txt === '/leads') {
    const leadSummary = await getLeadSummary(tenant.id);
    await sendMessage(from, leadSummary);
    return true;
  }

  if (txt === '/export_leads') {
    await sendMessage(from, 'Generating your lead export. This may take a moment...');
    const exportResult = await exportLeadsToExcel(tenant.id);
    await sendMessage(from, exportResult);
    return true;
  }

  if (txt === '/analytics') {
    const analyticsReport = await getCampaignAnalytics(tenant.id);
    await sendMessage(from, analyticsReport);
    return true;
  }

  if (txt === '/stats') {
    const statsReport = await getUsageStats(tenant.id);
    await sendMessage(from, statsReport);
    return true;
  }

  if (txt === '/feedback_report') {
    const report = await getFeedbackReport(tenant.id);
    await sendMessage(from, report);
    return true;
  }

  // === AI-Powered Commands ===
  if (txt === '/sales_insights') {
    await sendMessage(from, 'Generating your AI-powered sales insights for the last 30 days. This may take a moment...');
    const insights = await generateSalesInsights(tenant.id);
    await sendMessage(from, insights);
    return true;
  }

  if (txt.startsWith('/get_suggestion ')) {
    const endUserPhone = txt.split(' ')[1];
    if (!endUserPhone) {
      await sendMessage(from, 'Usage: /get_suggestion <customer_phone_number>');
    return true;
    }
    const suggestion = await getFollowUpSuggestion(tenant.id, endUserPhone);
    await sendMessage(from, suggestion);
    return true;
  }

  if (txt.startsWith('/customer_snapshot ')) {
    const endUserPhone = txt.split(' ')[1];
    if (!endUserPhone) await sendMessage(from, 'Usage: /customer_snapshot <customer_phone>');
    return true;
    const snapshot = await getCustomerSnapshot(tenant.id, endUserPhone);
    await sendMessage(from, snapshot);
    return true;
  }

  // === Reminder & Follow-up Commands ===
  if (txt.startsWith('/remind ')) {
    const parts = txt.split(' ');
    const endUserPhone = parts[1];
    const reminderText = parts.slice(2).join(' ');
    if (!endUserPhone || !reminderText) {
      await sendMessage(from, 'Usage: /remind <customer_phone> <reminder text>');
    return true;
    }
    const resultMessage = await setManualReminder(tenant.id, endUserPhone, reminderText);
    await sendMessage(from, resultMessage);
    return true;
  }

  // === Cart & Loyalty Commands ===
  if (txt.startsWith('/set_abandoned_cart_delay ')) {
    const hours = parseInt(txt.split(' ')[1], 10);
    if (isNaN(hours) || hours < 1) {
      await sendMessage(from, 'Usage: /set_abandoned_cart_delay <hours> (must be at least 1).');
      return true;
    }
    await dbClient.from('tenants').update({ abandoned_cart_delay_hours: hours }).eq('id', tenant.id);
    await sendMessage(from, `Abandoned cart reminder delay set to ${hours} hour(s).`);
    return true;
  }

  if (txt.startsWith('/set_abandoned_cart_message ')) {
    const cartMessage = txt.substring('/set_abandoned_cart_message '.length).trim();
    if (!cartMessage) await sendMessage(from, 'Usage: /set_abandoned_cart_message <Your reminder message>');
    return true;
    await dbClient.from('tenants').update({ abandoned_cart_message: cartMessage }).eq('id', tenant.id);
    await sendMessage(from, 'Abandoned cart reminder message has been updated.');
    return true;
  }

  // === Summary Settings ===
  if (txt.startsWith('/toggle_summary ')) {
    const option = txt.split(' ')[1]?.toLowerCase();
    if (option !== 'on' && option !== 'off') {
      await sendMessage(from, 'Usage: /toggle_summary <on|off>');
    return true;
    }
    const isEnabled = option === 'on';
    await dbClient.from('tenants').update({ daily_summary_enabled: isEnabled }).eq('id', tenant.id);
    await sendMessage(from, `Daily summary notifications have been turned ${option}.`);
    return true;
  }

  // === History Command ===
  if (txt.startsWith('/history ')) {
    const endUserPhone = txt.split(' ')[1];
    if (!endUserPhone) {
      await sendMessage(from, 'Usage: /history <customer_phone_number>');
    return true;
    }
    const { getConversationHistory } = require('../../services/historyService');
    const history = await getConversationHistory(tenant.id, endUserPhone);
    await sendMessage(from, history);
    return true;
  }

  // === Products Command ===
  if (txt.startsWith('/products')) {
    await dbClient.from('tenants').update({ last_command_context: 'upload_products' }).eq('id', tenant.id);
    await sendMessage(from, 'You have selected to upload products. Please upload your Excel file now.');
    return true;
  }

  // === Advanced Broadcast Commands ===
  if (txt.startsWith('/broadcast_to_segment ')) {
    const args = parseQuotedArgs(txt);
    if (args.length !== 4) {
      await sendMessage(from, 'Usage: /broadcast_to_segment "<Segment>" "<Campaign>" "<Time>" "<Message>"');
    return true;
    }
    const [segmentName, campaignName, timeString, messageContent] = args;
    const result = await scheduleBroadcastToSegment(tenant.id, segmentName, campaignName, messageContent, timeString);
    await sendMessage(from, result);
    return true;
  }

  // === Discount Management Commands ===
  if (txt.startsWith('/create_discount ')) {
    const args = parseQuotedArgs(txt);
    if (args.length < 3) {
      await sendMessage(from, 
        'Usage: /create_discount "CODE" "type" "value" ["min_order"] ["max_discount"] ["description"]\n\n' +
        'Types: percentage, fixed, buy_x_get_y\n' +
        'Examples:\n' +
        'â€¢ /create_discount "SAVE10" "percentage" "10" "500" "200" "10% off orders above â‚¹500"\n' +
        'â€¢ /create_discount "FLAT500" "fixed" "500" "2000" "" "â‚¹500 off on orders above â‚¹2000"'
      );
      return true;
    }

    const [code, type, value, minOrder = '0', maxDiscount = '', description = ''] = args;
    
    const discountData = {
      code,
      type,
      value: parseFloat(value),
      minOrderValue: parseFloat(minOrder || '0'),
      maxDiscount: maxDiscount ? parseFloat(maxDiscount) : null,
      description
    };

    const result = await createDiscount(tenant.id, discountData);
    await sendMessage(from, result);
    return true;
  }

  if (txt === '/list_discounts') {
    const result = await listDiscounts(tenant.id);
    await sendMessage(from, result);
    return true;
  }

  if (txt.startsWith('/create_auto_discount ')) {
    const args = parseQuotedArgs(txt);
    if (args.length < 3) {
      await sendMessage(from, 
        'Usage: /create_auto_discount "CODE" "type" "value" ["min_order"]\n' +
        'Creates automatic discount that applies when conditions are met'
      );
      return true;
    }

    const [code, type, value, minOrder = '0'] = args;
    
    const discountData = {
      code,
      type,
      value: parseFloat(value),
      minOrderValue: parseFloat(minOrder || '0'),
      isAutomatic: true,
      description: 'Automatic discount'
    };

    const result = await createDiscount(tenant.id, discountData);
    await sendMessage(from, result);
    return true;
  }

  if (txt.startsWith('/bulk_discount ')) {
    const parts = txt.split(' ');
    const quantity = parseInt(parts[1]);
    const discountPercent = parseFloat(parts[2]);
    
    if (!quantity || !discountPercent) {
      await sendMessage(from, 'Usage: /bulk_discount <quantity> <discount_percent>\nExample: /bulk_discount 10 15');
      return true;
    }

    const code = `BULK${quantity}`;
    const discountData = {
      code,
      type: 'percentage',
      value: discountPercent,
      minOrderValue: 0,
      description: `${discountPercent}% off when buying ${quantity}+ items`,
      isAutomatic: true
    };

    const result = await createDiscount(tenant.id, discountData);
    await sendMessage(from, result);
    return true;
  }

  if (txt.startsWith('/apply_discount_to_customer ')) {
    const parts = txt.split(' ');
    const customerPhone = parts[1];
    const discountCode = parts[2];
    
    if (!customerPhone || !discountCode) {
      await sendMessage(from, 'Usage: /apply_discount_to_customer <customer_phone> <discount_code>');
      return true;
    }

    const result = await applyDiscountToCart(tenant.id, customerPhone, discountCode);
    if (result.success) {
      await sendMessage(from, `âœ… Applied discount "${discountCode}" to ${customerPhone}'s cart`);
    } else {
      await sendMessage(from, `âŒ Failed: ${result.message}`);
    }
    return true;
  }

  if (txt.startsWith('/deactivate_discount ')) {
    const discountCode = txt.substring('/deactivate_discount '.length).trim();
    if (!discountCode) {
      await sendMessage(from, 'Usage: /deactivate_discount <discount_code>');
      return true;
    }

    try {
      const { error } = await dbClient
        .from('discount_codes')
        .update({ is_active: false })
        .eq('tenant_id', tenant.id)
        .eq('code', discountCode.toUpperCase());

      if (error) throw error;

      await sendMessage(from, `âœ… Discount code "${discountCode}" has been deactivated.`);
    } catch (error) {
      console.error('Error deactivating discount:', error.message);
      await sendMessage(from, 'Failed to deactivate discount code.');
    }
    return true;
  }

  if (txt.startsWith('/discount_stats ')) {
    const discountCode = txt.substring('/discount_stats '.length).trim();
    if (!discountCode) {
      await sendMessage(from, 'Usage: /discount_stats <discount_code>');
      return true;
    }

    try {
      const { data: discount } = await dbClient
        .from('discount_codes')
        .select(`
          *,
          discount_usage_history (
            discount_amount,
            used_at
          )
        `)
        .eq('tenant_id', tenant.id)
        .eq('code', discountCode.toUpperCase())
        .single();

      if (!discount) {
        await sendMessage(from, `Discount code "${discountCode}" not found.`);
        return true;
      }

      const totalSavings = discount.discount_usage_history.reduce((sum, usage) => sum + parseFloat(usage.discount_amount), 0);
      const usageCount = discount.usage_count || 0;
      const usageLimit = discount.usage_limit || 'Unlimited';

      const statsMessage = `ðŸ“Š **Discount Stats: ${discountCode}**\n\n` +
                          `ðŸ’° Total Savings Given: â‚¹${totalSavings.toFixed(2)}\n` +
                          `ðŸ“ˆ Times Used: ${usageCount}/${usageLimit}\n` +
                          `ðŸ“… Created: ${new Date(discount.created_at).toLocaleDateString()}\n` +
                          `âš¡ Status: ${discount.is_active ? 'Active' : 'Inactive'}`;

      await sendMessage(from, statsMessage);
    } catch (error) {
      console.error('Error fetching discount stats:', error.message);
      await sendMessage(from, 'Failed to retrieve discount statistics.');
    }
    return true;
  }

  // === Carton Pricing Setup Commands ===

  if (txt.startsWith('/setup_carton_pricing ')) {
    const parts = txt.split(' ');
    if (parts.length < 4) {
      await sendMessage(from, 
        'Usage: /setup_carton_pricing "<product_name>" <units_per_carton> <carton_price>\n' +
        'Example: /setup_carton_pricing "NFF 10x100" 70 2408.7'
      );
      return true;
    }

    const args = parseQuotedArgs(txt);
    const productName = args[0];
    const unitsPerCarton = parseInt(parts[parts.length - 2]);
    const cartonPrice = parseFloat(parts[parts.length - 1]);

    if (!productName || !unitsPerCarton || !cartonPrice) {
      await sendMessage(from, 'Invalid parameters. Please provide product name, units per carton, and carton price.');
      return true;
    }

    const cartonConfig = {
      unitsPerCarton,
      cartonPrice,
      minCartonQty: 1
    };

    const result = await setupCartonPricing(tenant.id, productName, cartonConfig);
    await sendMessage(from, result);
    return true;
  }

  if (txt.startsWith('/add_quantity_breaks ')) {
    const args = parseQuotedArgs(txt);
    if (args.length < 2) {
      await sendMessage(from, 
        'Usage: /add_quantity_breaks "<product_name>" "<breaks>"\n' +
        'Breaks format: "min_qty:price,min_qty:price"\n' +
        'Example: /add_quantity_breaks "NFF 10x100" "5:2300,10:2200,20:2100"'
      );
      return true;
    }

    const [productName, breaksString] = args;

    try {
      // Parse quantity breaks
      const quantityBreaks = breaksString.split(',').map(breakStr => {
        const [minQty, price] = breakStr.split(':');
        return {
          minQuantity: parseInt(minQty),
          unitPrice: parseFloat(price),
          discountPercentage: 0
        };
      });

      // Find product
      const { data: product } = await dbClient
        .from('products')
        .select('id, name, price')
        .eq('tenant_id', tenant.id)
        .ilike('name', `%${productName}%`)
        .single();

      if (!product) {
        await sendMessage(from, `Product "${productName}" not found.`);
        return true;
      }

      // Delete existing breaks
      await dbClient
        .from('product_quantity_breaks')
        .delete()
        .eq('product_id', product.id);

      // Insert new breaks
      const breaksToInsert = quantityBreaks.map(qb => ({
        product_id: product.id,
        min_quantity: qb.minQuantity,
        unit_price: qb.unitPrice,
        break_type: 'carton'
      }));

      await dbClient
        .from('product_quantity_breaks')
        .insert(breaksToInsert);

      let message = `Quantity breaks updated for "${product.name}":\n\n`;
      quantityBreaks.forEach(qb => {
        const savings = product.price - qb.unitPrice;
        const savingsPercent = ((savings / product.price) * 100).toFixed(1);
        message += `${qb.minQuantity}+ cartons: â‚¹${qb.unitPrice}/carton (Save â‚¹${savings.toFixed(2)} or ${savingsPercent}%)\n`;
      });

      await sendMessage(from, message);

    } catch (error) {
      console.error('Error adding quantity breaks:', error.message);
      await sendMessage(from, 'Failed to add quantity breaks. Check your format.');
    }
    return true;
  }

  if (txt.startsWith('/bulk_setup_nff')) {
    // Quick setup for all NFF products with standard carton structure
    const standardBreaks = [
      { minQuantity: 5, discountPercentage: 5 },
      { minQuantity: 10, discountPercentage: 8 },
      { minQuantity: 20, discountPercentage: 12 },
      { minQuantity: 50, discountPercentage: 15 }
    ];

    try {
      // Get all NFF products
      const { data: nffProducts } = await dbClient
        .from('products')
        .select('*')
        .eq('tenant_id', tenant.id)
        .ilike('name', 'NFF%');

      if (!nffProducts || nffProducts.length === 0) {
        await sendMessage(from, 'No NFF products found.');
        return true;
      }

      let setupCount = 0;
      for (const product of nffProducts) {
        // Extract units per carton from description (assuming format like "70 pcs x 10 Pkts")
        const unitsMatch = product.description.match(/(\d+)\s*pcs\s*x\s*(\d+)\s*Pkts/i);
        if (unitsMatch) {
          const unitsPerCarton = parseInt(unitsMatch[1]);
          
          // Update product
          await dbClient
            .from('products')
            .update({
              packaging_unit: 'carton',
              units_per_carton: unitsPerCarton,
              min_carton_qty: 1
            })
            .eq('id', product.id);

          // Add quantity breaks
          const breaksToInsert = standardBreaks.map(qb => {
            const discountedPrice = product.price * (1 - qb.discountPercentage / 100);
            return {
              product_id: product.id,
              min_quantity: qb.minQuantity,
              unit_price: discountedPrice,
              discount_percentage: qb.discountPercentage,
              break_type: 'carton'
            };
          });

          await dbClient
            .from('product_quantity_breaks')
            .insert(breaksToInsert);

          setupCount++;
        }
      }

      await sendMessage(from, 
        `Bulk setup completed for ${setupCount} NFF products!\n\n` +
        `Standard quantity breaks applied:\n` +
        `5-9 cartons: 5% off\n` +
        `10-19 cartons: 8% off\n` +
        `20-49 cartons: 12% off\n` +
        `50+ cartons: 15% off`
      );

    } catch (error) {
      console.error('Error in bulk NFF setup:', error.message);
      await sendMessage(from, 'Failed to setup bulk NFF pricing.');
    }
    return true;
  }

  if (txt.startsWith('/carton_pricing_info ')) {
    const productName = txt.substring('/carton_pricing_info '.length).trim();
    if (!productName) {
      await sendMessage(from, 'Usage: /carton_pricing_info <product_name>');
      return true;
    }

    try {
      // Find product with quantity breaks
      const { data: product } = await dbClient
        .from('products')
        .select(`
          *,
          product_quantity_breaks (*)
        `)
        .eq('tenant_id', tenant.id)
        .ilike('name', `%${productName}%`)
        .single();

      if (!product) {
        await sendMessage(from, `Product "${productName}" not found.`);
        return true;
      }

      let message = `Carton Pricing Info: ${product.name}\n\n`;
      message += `Base price: â‚¹${product.price}/carton\n`;
      message += `Units per carton: ${product.units_per_carton || 'Not set'}\n`;
      message += `Packaging: ${product.packaging_unit || 'piece'}\n\n`;

      if (product.product_quantity_breaks && product.product_quantity_breaks.length > 0) {
        message += `Quantity Breaks:\n`;
        product.product_quantity_breaks
          .sort((a, b) => a.min_quantity - b.min_quantity)
          .forEach(qb => {
            const savings = product.price - qb.unit_price;
            const savingsPercent = ((savings / product.price) * 100).toFixed(1);
            message += `${qb.min_quantity}+ cartons: â‚¹${qb.unit_price}/carton (${savingsPercent}% off)\n`;
          });
      } else {
        message += `No quantity breaks configured.`;
      }

      await sendMessage(from, message);

    } catch (error) {
      console.error('Error getting carton pricing info:', error.message);
      await sendMessage(from, 'Failed to retrieve carton pricing information.');
    }
    return true;
  }

  // === Enhanced Carton Testing Command ===
  if (txt.startsWith('/test_carton_pricing ')) {
    const parts = txt.split(' ');
    const productName = parts[1];
    const quantity = parseInt(parts[2]) || 1;
    
    if (!productName) {
      await sendMessage(from, 'Usage: /test_carton_pricing <product_name> <quantity>');
      return true;
    }

    try {
      const pricing = await testCartonPricing(tenant.id, productName, quantity);
      
      let message = `ðŸ§ª **Carton Pricing Test**\n\n`;
      message += `Product: ${pricing.product.name}\n`;
      message += `Requested: ${quantity} cartons\n`;
      message += `Total pieces: ${pricing.pieceQuantity}\n`;
      message += `Base price: â‚¹${pricing.baseUnitPrice}/carton\n`;
      message += `Final price: â‚¹${pricing.finalUnitPrice}/carton\n`;
      message += `Total: â‚¹${pricing.totalPrice.toFixed(2)}\n`;
      
      if (pricing.discountAmount > 0) {
        message += `Savings: â‚¹${pricing.discountAmount.toFixed(2)} (${pricing.discountPercentage.toFixed(1)}%)\n`;
      }
      
      await sendMessage(from, message);
    } catch (error) {
      await sendMessage(from, `Error: ${error.message}`);
    }
    return true;
  }

  // === Enhanced Product Management Commands ===

  if (txt.startsWith('/create_product ')) {
    const args = parseQuotedArgs(txt);
    if (args.length < 4) {
        await sendMessage(from, 
            'Usage: /create_product "Name" "Category" "Base Price" "Units per Packet" ["Packets per Carton"]\n\n' +
            'Example: /create_product "NFF 8x80 Anchor" "hardware" "2511" "150" "1"'
        );
        return true;
    }

    const [name, category, basePrice, unitsPerPacket, packetsPerCarton = '1'] = args;
    
    const productData = {
        name,
        category,
        base_price: parseFloat(basePrice),
        units_per_packet: parseInt(unitsPerPacket),
        packets_per_carton: parseInt(packetsPerCarton),
        packaging_unit: 'carton'
    };

    const result = await createProductWithVariants(tenant.id, productData);
    
    if (result.success) {
        await sendMessage(from, 
            `âœ… Product "${name}" created successfully!\n\n` +
            `Category: ${category}\n` +
            `Base Price: â‚¹${basePrice}/carton\n` +
            `Packaging: ${unitsPerPacket} pcs/packet, ${packetsPerCarton} packet(s)/carton\n` +
            `Total: ${unitsPerPacket * parseInt(packetsPerCarton)} pieces per carton`
        );
    } else {
        await sendMessage(from, `Failed to create product: ${result.message}`);
    }
    return true;
  }

  if (txt.startsWith('/add_variant ')) {
    const args = parseQuotedArgs(txt);
    if (args.length < 4) {
        await sendMessage(from, 
            'Usage: /add_variant "Product Name" "Variant Name" "Price" "Attributes"\n\n' +
            'Attributes format: {"color": "Red", "size": "Large"}\n' +
            'Example: /add_variant "NFF 8x80 Anchor" "Red Medium" "2600" "{\\"color\\": \\"Red\\", \\"size\\": \\"Medium\\"}"'
        );
        return true;
    }

    const [productName, variantName, price, attributesJson] = args;
    
    try {
        // Find product
        const { data: product } = await dbClient
            .from('products')
            .select('id, name')
            .eq('tenant_id', tenant.id)
            .ilike('name', `%${productName}%`)
            .single();

        if (!product) {
            await sendMessage(from, `Product "${productName}" not found.`);
            return true;
        }

        // Parse attributes
        let attributes = {};
        try {
            attributes = JSON.parse(attributesJson);
        } catch (e) {
            await sendMessage(from, 'Invalid attributes format. Use JSON format: {"color": "Red", "size": "Large"}');
            return true;
        }

        // Create variant
        const { data: variant, error } = await dbClient
            .from('product_variants')
            .insert({
                product_id: product.id,
                tenant_id: tenant.id,
                variant_name: variantName,
                variant_attributes: attributes,
                carton_price: parseFloat(price)
            })
            .select()
            .single();

        if (error) throw error;

        let message = `âœ… Variant "${variantName}" added to "${product.name}"!\n\n`;
        message += `Price: â‚¹${price}/carton\n`;
        message += `Attributes:\n`;
        Object.entries(attributes).forEach(([key, value]) => {
            message += `- ${key}: ${value}\n`;
        });

        await sendMessage(from, message);
    } catch (error) {
        console.error('Error adding variant:', error.message);
        await sendMessage(from, 'Failed to add variant. Please try again.');
    }
    return true;
  }

  if (txt.startsWith('/setup_attributes ')) {
    const args = parseQuotedArgs(txt);
    if (args.length < 2) {
        await sendMessage(from, 
            'Usage: /setup_attributes "Category" "Attribute Definitions"\n\n' +
            'Attribute format: [{"name": "color", "type": "select", "values": ["Red", "Blue"]}, {"name": "size", "type": "select", "values": ["S", "M", "L"]}]\n' +
            'Example: /setup_attributes "clothing" "[{\\"name\\": \\"size\\", \\"type\\": \\"select\\", \\"values\\": [\\"S\\", \\"M\\", \\"L\\", \\"XL\\"]}]"'
        );
        return true;
    }

    const [category, attributesJson] = args;
    
    try {
        const attributes = JSON.parse(attributesJson);
        const success = await addVariantAttributes(tenant.id, category, attributes);
        
        if (success) {
            let message = `âœ… Variant attributes setup for "${category}" category:\n\n`;
            attributes.forEach(attr => {
                message += `**${attr.name}** (${attr.type})\n`;
                if (attr.values && attr.values.length > 0) {
                    message += `Values: ${attr.values.join(', ')}\n`;
                }
                message += '\n';
            });
            await sendMessage(from, message);
        } else {
            await sendMessage(from, 'Failed to setup variant attributes.');
        }
    } catch (error) {
        console.error('Error setting up attributes:', error.message);
        await sendMessage(from, 'Invalid attribute format. Please check the JSON structure.');
    }
    return true;
  }

  if (txt.startsWith('/list_attributes ')) {
    const category = txt.substring('/list_attributes '.length).trim();
    if (!category) {
        await sendMessage(from, 'Usage: /list_attributes <category>');
        return true;
    }

    try {
        const attributes = await getVariantAttributes(tenant.id, category);
        
        if (attributes.length === 0) {
            await sendMessage(from, `No variant attributes found for category "${category}".`);
            return true;
        }

        let message = `ðŸ“‹ **Variant Attributes for "${category}":**\n\n`;
        attributes.forEach(attr => {
            message += `**${attr.attribute_name}** (${attr.attribute_type})\n`;
            if (attr.possible_values && attr.possible_values.length > 0) {
                message += `Values: ${attr.possible_values.join(', ')}\n`;
            }
            message += `Required: ${attr.is_required ? 'Yes' : 'No'}\n\n`;
        });

        await sendMessage(from, message);
    } catch (error) {
        console.error('Error listing attributes:', error.message);
        await sendMessage(from, 'Failed to retrieve variant attributes.');
    }
    return true;
  }

  if (txt.startsWith('/bulk_create_variants ')) {
    const args = parseQuotedArgs(txt);
    if (args.length < 2) {
        await sendMessage(from, 
            'Usage: /bulk_create_variants "Product Name" "Variant Data"\n\n' +
            'Variant Data format: [{"name": "Red Small", "attributes": {"color": "Red", "size": "Small"}, "price": 2600}, {"name": "Blue Large", "attributes": {"color": "Blue", "size": "Large"}, "price": 2700}]\n' +
            'Example: /bulk_create_variants "T-Shirt Basic" "[{\\"name\\": \\"Red Small\\", \\"attributes\\": {\\"color\\": \\"Red\\", \\"size\\": \\"Small\\"}, \\"price\\": 500}]"'
        );
        return true;
    }

    const [productName, variantsJson] = args;
    
    try {
        // Find product
        const { data: product } = await dbClient
            .from('products')
            .select('id, name')
            .eq('tenant_id', tenant.id)
            .ilike('name', `%${productName}%`)
            .single();

        if (!product) {
            await sendMessage(from, `Product "${productName}" not found.`);
            return true;
        }

        const variants = JSON.parse(variantsJson);
        let successCount = 0;
        let errorCount = 0;

        for (const variant of variants) {
            try {
                const { error } = await dbClient
                    .from('product_variants')
                    .insert({
                        product_id: product.id,
                        tenant_id: tenant.id,
                        variant_name: variant.name,
                        variant_attributes: variant.attributes || {},
                        carton_price: variant.price || product.price
                    });

                if (error) throw error;
                successCount++;
            } catch (variantError) {
                console.error(`Error creating variant ${variant.name}:`, variantError.message);
                errorCount++;
            }
        }

        let message = `ðŸ“¦ **Bulk Variant Creation Complete:**\n\n`;
        message += `Product: ${product.name}\n`;
        message += `âœ… Successfully created: ${successCount} variants\n`;
        if (errorCount > 0) {
            message += `âŒ Errors: ${errorCount} variants\n`;
        }

        await sendMessage(from, message);
    } catch (error) {
        console.error('Error in bulk variant creation:', error.message);
        await sendMessage(from, 'Failed to create variants. Please check the JSON format.');
    }
    return true;
  }

  if (txt.startsWith('/product_info ')) {
    const productName = txt.substring('/product_info '.length).trim();
    if (!productName) {
        await sendMessage(from, 'Usage: /product_info <product_name>');
        return true;
    }

    try {
        const { data: product } = await dbClient
            .from('products')
            .select(`
                *,
                product_variants (*)
            `)
            .eq('tenant_id', tenant.id)
            .ilike('name', `%${productName}%`)
            .single();

        if (!product) {
            await sendMessage(from, `Product "${productName}" not found.`);
            return true;
        }

        let message = `ðŸ“¦ **Product Information**\n\n`;
        message += `**Name:** ${product.name}\n`;
        message += `**Category:** ${product.category || 'Not set'}\n`;
        message += `**Base Price:** â‚¹${product.price}/carton\n\n`;

        message += `**Packaging:**\n`;
        message += `- Units per packet: ${product.units_per_packet || 1}\n`;
        message += `- Packets per carton: ${product.packets_per_carton || 1}\n`;
        message += `- Total units per carton: ${(product.units_per_packet || 1) * (product.packets_per_carton || 1)}\n\n`;

        if (product.unit_price) {
            message += `**Pricing Breakdown:**\n`;
            message += `- Per unit: â‚¹${product.unit_price}\n`;
            if (product.packet_price) {
                message += `- Per packet: â‚¹${product.packet_price}\n`;
            }
            message += `- Per carton: â‚¹${product.carton_price || product.price}\n\n`;
        }

        if (product.product_variants && product.product_variants.length > 0) {
            message += `**Variants (${product.product_variants.length}):**\n`;
            product.product_variants.forEach(variant => {
                message += `- ${variant.variant_name}: â‚¹${variant.carton_price || product.price}\n`;
                if (variant.variant_attributes && Object.keys(variant.variant_attributes).length > 0) {
                    Object.entries(variant.variant_attributes).forEach(([key, value]) => {
                        message += `  ${key}: ${value}\n`;
                    });
                }
                message += '\n';
            });
        }

        await sendMessage(from, message);
    } catch (error) {
        console.error('Error getting product info:', error.message);
        await sendMessage(from, 'Failed to retrieve product information.');
    }
    return true;
  }

  // Return null if no command matched (let main handler continue)
  return null;
};

module.exports = {
  handleCompleteAdminCommands,
  parseQuotedArgs
};

