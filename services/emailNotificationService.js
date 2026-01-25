const nodemailer = require('nodemailer');
const { dbClient: supabase } = require('./config');

// Email transporter configuration
const createTransporter = () => {
  const emailConfig = {
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    secure: process.env.SMTP_SECURE === 'true', // true for 465, false for other ports
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    }
  };

  return nodemailer.createTransporter(emailConfig);
};

/**
 * Send email notification for lead assignment
 */
async function sendLeadAssignmentEmail({ tenantId, leadId, assignedUserId, leadData }) {
  try {
    if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
      console.log('[EMAIL] SMTP not configured, skipping email notification');
      return { success: false, reason: 'smtp_not_configured' };
    }

    // Get assigned user details
    const { data: user, error: userError } = await supabase
      .from('crm_users')
      .select('email, name')
      .eq('tenant_id', tenantId)
      .eq('id', assignedUserId)
      .maybeSingle();

    if (userError || !user || !user.email) {
      console.log('[EMAIL] User not found or has no email:', assignedUserId);
      return { success: false, reason: 'user_no_email' };
    }

    // Get tenant details for branding
    const { data: tenant } = await supabase
      .from('tenants')
      .select('name, company_name')
      .eq('id', tenantId)
      .maybeSingle();

    const companyName = tenant?.company_name || tenant?.name || 'Your Company';

    const transporter = createTransporter();

    const mailOptions = {
      from: `"${companyName} CRM" <${process.env.SMTP_USER}>`,
      to: user.email,
      subject: `New Lead Assigned: ${leadData.name || leadData.phone || 'Unknown'}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #1976d2;">New Lead Assigned to You</h2>
          <p>Hello ${user.name || 'there'},</p>
          <p>A new lead has been assigned to you. Here are the details:</p>
          
          <div style="background-color: #f5f5f5; padding: 15px; border-radius: 5px; margin: 20px 0;">
            <table style="width: 100%; border-collapse: collapse;">
              <tr>
                <td style="padding: 8px 0;"><strong>Name:</strong></td>
                <td style="padding: 8px 0;">${leadData.name || 'N/A'}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0;"><strong>Phone:</strong></td>
                <td style="padding: 8px 0;">${leadData.phone || 'N/A'}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0;"><strong>Email:</strong></td>
                <td style="padding: 8px 0;">${leadData.email || 'N/A'}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0;"><strong>Channel:</strong></td>
                <td style="padding: 8px 0;">${leadData.channel || 'N/A'}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0;"><strong>Heat:</strong></td>
                <td style="padding: 8px 0;"><span style="background-color: ${getHeatColor(leadData.heat)}; color: white; padding: 2px 8px; border-radius: 3px;">${leadData.heat || 'COLD'}</span></td>
              </tr>
              <tr>
                <td style="padding: 8px 0;"><strong>Score:</strong></td>
                <td style="padding: 8px 0;">${leadData.score || 0}/100</td>
              </tr>
            </table>
          </div>

          <p>Please follow up with this lead as soon as possible.</p>
          
          <p style="margin-top: 30px;">
            <a href="${process.env.APP_URL || 'https://salesmate.saksolution.com'}" 
               style="background-color: #1976d2; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; display: inline-block;">
              View in CRM
            </a>
          </p>

          <hr style="margin-top: 40px; border: none; border-top: 1px solid #ddd;">
          <p style="color: #999; font-size: 12px;">
            This is an automated notification from ${companyName} CRM system.
          </p>
        </div>
      `
    };

    const info = await transporter.sendMail(mailOptions);
    console.log('[EMAIL] Lead assignment email sent:', info.messageId);

    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error('[EMAIL] Failed to send lead assignment email:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Send email notification for status change
 */
async function sendLeadStatusChangeEmail({ tenantId, leadId, assignedUserId, leadData, oldStatus, newStatus }) {
  try {
    if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
      return { success: false, reason: 'smtp_not_configured' };
    }

    if (!assignedUserId) {
      return { success: false, reason: 'no_assigned_user' };
    }

    const { data: user, error: userError } = await supabase
      .from('crm_users')
      .select('email, name')
      .eq('tenant_id', tenantId)
      .eq('id', assignedUserId)
      .maybeSingle();

    if (userError || !user || !user.email) {
      return { success: false, reason: 'user_no_email' };
    }

    const { data: tenant } = await supabase
      .from('tenants')
      .select('name, company_name')
      .eq('id', tenantId)
      .maybeSingle();

    const companyName = tenant?.company_name || tenant?.name || 'Your Company';
    const transporter = createTransporter();

    const mailOptions = {
      from: `"${companyName} CRM" <${process.env.SMTP_USER}>`,
      to: user.email,
      subject: `Lead Status Updated: ${leadData.name || leadData.phone}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #1976d2;">Lead Status Updated</h2>
          <p>Hello ${user.name || 'there'},</p>
          <p>The status of one of your leads has been updated:</p>
          
          <div style="background-color: #f5f5f5; padding: 15px; border-radius: 5px; margin: 20px 0;">
            <p><strong>Lead:</strong> ${leadData.name || leadData.phone || 'Unknown'}</p>
            <p><strong>Previous Status:</strong> <span style="text-decoration: line-through;">${oldStatus}</span></p>
            <p><strong>New Status:</strong> <span style="background-color: ${getStatusColor(newStatus)}; color: white; padding: 2px 8px; border-radius: 3px;">${newStatus}</span></p>
          </div>

          <p style="margin-top: 30px;">
            <a href="${process.env.APP_URL || 'https://salesmate.saksolution.com'}" 
               style="background-color: #1976d2; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; display: inline-block;">
              View Lead
            </a>
          </p>
        </div>
      `
    };

    const info = await transporter.sendMail(mailOptions);
    console.log('[EMAIL] Status change email sent:', info.messageId);

    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error('[EMAIL] Failed to send status change email:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Send follow-up reminder email
 */
async function sendFollowUpReminderEmail({ tenantId, assignedUserId, leads }) {
  try {
    if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
      return { success: false, reason: 'smtp_not_configured' };
    }

    const { data: user, error: userError } = await supabase
      .from('crm_users')
      .select('email, name')
      .eq('tenant_id', tenantId)
      .eq('id', assignedUserId)
      .maybeSingle();

    if (userError || !user || !user.email) {
      return { success: false, reason: 'user_no_email' };
    }

    const { data: tenant } = await supabase
      .from('tenants')
      .select('name, company_name')
      .eq('id', tenantId)
      .maybeSingle();

    const companyName = tenant?.company_name || tenant?.name || 'Your Company';
    const transporter = createTransporter();

    const leadsHtml = leads.map(lead => `
      <tr style="border-bottom: 1px solid #ddd;">
        <td style="padding: 10px;">${lead.name || lead.phone || 'Unknown'}</td>
        <td style="padding: 10px;">${lead.channel || 'N/A'}</td>
        <td style="padding: 10px;">${lead.heat || 'COLD'}</td>
        <td style="padding: 10px;">${calculateDaysSinceActivity(lead.last_activity_at)} days ago</td>
      </tr>
    `).join('');

    const mailOptions = {
      from: `"${companyName} CRM" <${process.env.SMTP_USER}>`,
      to: user.email,
      subject: `${leads.length} Lead${leads.length > 1 ? 's' : ''} Need Follow-up`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #ff9800;">⏰ Follow-up Reminder</h2>
          <p>Hello ${user.name || 'there'},</p>
          <p>You have <strong>${leads.length}</strong> lead${leads.length > 1 ? 's' : ''} that need follow-up:</p>
          
          <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
            <thead>
              <tr style="background-color: #f5f5f5;">
                <th style="padding: 10px; text-align: left;">Lead</th>
                <th style="padding: 10px; text-align: left;">Channel</th>
                <th style="padding: 10px; text-align: left;">Heat</th>
                <th style="padding: 10px; text-align: left;">Last Activity</th>
              </tr>
            </thead>
            <tbody>
              ${leadsHtml}
            </tbody>
          </table>

          <p>Please follow up with these leads to maintain engagement.</p>
          
          <p style="margin-top: 30px;">
            <a href="${process.env.APP_URL || 'https://salesmate.saksolution.com'}" 
               style="background-color: #ff9800; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; display: inline-block;">
              View Leads
            </a>
          </p>
        </div>
      `
    };

    const info = await transporter.sendMail(mailOptions);
    console.log('[EMAIL] Follow-up reminder email sent:', info.messageId);

    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error('[EMAIL] Failed to send follow-up reminder:', error);
    return { success: false, error: error.message };
  }
}

// Helper functions
function getHeatColor(heat) {
  const colors = {
    'COLD': '#2196F3',
    'WARM': '#FF9800',
    'HOT': '#FF5722',
    'ON_FIRE': '#D32F2F'
  };
  return colors[heat] || colors['COLD'];
}

function getStatusColor(status) {
  const colors = {
    'NEW': '#2196F3',
    'CONTACTED': '#FF9800',
    'QUALIFIED': '#4CAF50',
    'PROPOSAL': '#9C27B0',
    'NEGOTIATION': '#FF5722',
    'WON': '#4CAF50',
    'LOST': '#757575',
    'MERGED': '#607D8B'
  };
  return colors[status] || colors['NEW'];
}

function calculateDaysSinceActivity(lastActivityAt) {
  if (!lastActivityAt) return 0;
  const now = new Date();
  const lastActivity = new Date(lastActivityAt);
  const diffTime = Math.abs(now - lastActivity);
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  return diffDays;
}

module.exports = {
  sendLeadAssignmentEmail,
  sendLeadStatusChangeEmail,
  sendFollowUpReminderEmail
};
