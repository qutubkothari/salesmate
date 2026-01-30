/**
 * Email Lead Capture Service
 * Captures leads from emails (company inbox and salesman personal inboxes)
 * Supports webhook and IMAP integration
 */

const { dbClient } = require('./config');
const { autoAssignLead } = require('./leadAutoCreateService');

function parseFromHeader(fromValue) {
  const raw = String(fromValue || '').trim();
  if (!raw) return { email: null, name: null };

  const angleMatch = raw.match(/^(.*)<([^>]+)>$/);
  if (angleMatch) {
    return {
      name: angleMatch[1].trim().replace(/^"|"$/g, '') || null,
      email: angleMatch[2].trim() || null
    };
  }

  // Fallback: if it's just an email
  if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(raw)) {
    return { email: raw, name: null };
  }

  return { email: null, name: raw };
}

/**
 * Parse email content to extract lead information
 */
function parseEmailContent(emailBody, subject) {
  const lead = {
    name: null,
    email: null,
    phone: null,
    company: null,
    message: emailBody,
    subject: subject
  };

  // Extract email from body if not in From
  const emailRegex = /([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9_-]+)/gi;
  const emails = emailBody.match(emailRegex);
  if (emails && emails.length > 0) {
    lead.email = emails[0];
  }

  // Extract phone numbers (international format)
  const phoneRegex = /(?:\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g;
  const phones = emailBody.match(phoneRegex);
  if (phones && phones.length > 0) {
    lead.phone = phones[0].replace(/\D/g, '');
  }

  // Try to extract name from signature or greeting
  const namePatterns = [
    /(?:Thanks|Regards|Best|Sincerely),?\s*\n\s*([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/i,
    /My name is\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/i,
    /I am\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/i
  ];

  for (const pattern of namePatterns) {
    const match = emailBody.match(pattern);
    if (match && match[1]) {
      lead.name = match[1].trim();
      break;
    }
  }

  return lead;
}

/**
 * Create lead from email
 */
async function createLeadFromEmail({ tenantId, fromEmail, fromName, subject, body, salesmanId = null, salesmanEmail = null }) {
  try {
    console.log('[EMAIL_LEAD] Processing email lead:', {
      tenant: tenantId,
      from: fromEmail,
      subject,
      salesmanId,
      salesmanEmail
    });

    // Parse email content for additional info
    const parsed = parseEmailContent(body, subject);

    // Parse From header if it contains name/email
    const fromParsed = parseFromHeader(fromEmail);

    // Use fromEmail if not found in body
    const leadEmail = parsed.email || fromParsed.email || fromEmail;
    const leadName = parsed.name || fromName || fromParsed.name || (leadEmail ? leadEmail.split('@')[0] : null);

    // Check if lead already exists
    const { data: existingLead } = await dbClient
      .from('crm_leads')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('email', leadEmail)
      .maybeSingle();

    let leadId;
    let isNew = false;

    if (existingLead) {
      // Update existing lead
      console.log('[EMAIL_LEAD] Updating existing lead:', existingLead.id);
      
      const updatePayload = {
        last_activity_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
      if (salesmanId && !existingLead.assigned_user_id) {
        updatePayload.assigned_user_id = salesmanId;
      }

      const { error: updateErr } = await dbClient
        .from('crm_leads')
        .update(updatePayload)
        .eq('id', existingLead.id);

      if (updateErr) throw updateErr;
      leadId = existingLead.id;

    } else {
      // Create new lead
      console.log('[EMAIL_LEAD] Creating new lead');
      isNew = true;

      const { data: newLead, error: createErr } = await dbClient
        .from('crm_leads')
        .insert({
          tenant_id: tenantId,
          name: leadName,
          email: leadEmail,
          phone: parsed.phone,
          channel: 'EMAIL',
          status: 'NEW',
          heat: 'WARM',
          score: 0,
          assigned_user_id: salesmanId, // If from salesman's email, auto-assign
          created_at: new Date().toISOString(),
          last_activity_at: new Date().toISOString()
        })
        .select()
        .single();

      if (createErr) throw createErr;
      leadId = newLead.id;
    }

    // Log the email activity
    await dbClient
      .from('crm_lead_events')
      .insert({
        tenant_id: tenantId,
        lead_id: leadId,
        event_type: 'EMAIL_RECEIVED',
        event_payload: {
          from: fromEmail,
          subject,
          body: body.substring(0, 1000), // Store first 1000 chars
          salesman_email: salesmanEmail,
          salesman_id: salesmanId
        },
        created_at: new Date().toISOString()
      });

    return {
      success: true,
      leadId,
      isNew,
      needsAssignment: isNew && !salesmanId // Needs assignment if new and not from salesman
    };

  } catch (error) {
    console.error('[EMAIL_LEAD] Error creating lead from email:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Process inbound email webhook
 * Works with SendGrid, Mailgun, Postmark, etc.
 */
async function processEmailWebhook(emailData) {
  try {
    const { to, from, subject, text, html, headers } = emailData;

    // Extract tenant from recipient email
    // Format: company@domain.com or salesman+company@domain.com
    const recipientEmail = Array.isArray(to) ? to[0] : to;
    
    // Check if this is a salesman's personal email
    const { data: salesman } = await dbClient
      .from('salesmen')
      .select('id, tenant_id, email, name')
      .eq('email', recipientEmail)
      .maybeSingle();

    let tenantId;
    let salesmanId = null;
    let salesmanEmail = null;

    if (salesman) {
      // Email sent to salesman's personal address
      tenantId = salesman.tenant_id;
      salesmanId = salesman.id;
      salesmanEmail = salesman.email;
      console.log('[EMAIL_WEBHOOK] Email to salesman:', salesman.name);
    } else {
      // Try to find tenant by company email
      const { data: tenant } = await dbClient
        .from('tenants')
        .select('id')
        .eq('company_email', recipientEmail)
        .maybeSingle();

      if (!tenant) {
        console.warn('[EMAIL_WEBHOOK] No tenant found for email:', recipientEmail);
        return { success: false, error: 'Tenant not found' };
      }

      tenantId = tenant.id;
      console.log('[EMAIL_WEBHOOK] Email to company inbox');
    }

    // Create lead from email
    const leadResult = await createLeadFromEmail({
      tenantId,
      fromEmail: from,
      fromName: emailData.fromName || null,
      subject,
      body: text || html || '',
      salesmanId,
      salesmanEmail
    });

    // If lead needs assignment (company inbox), auto-assign based on settings
    if (leadResult.success && leadResult.needsAssignment) {
      console.log('[EMAIL_WEBHOOK] Lead needs assignment...');
      const assignResult = await autoAssignLead(tenantId, leadResult.leadId);
      
      if (assignResult.success) {
        console.log('[EMAIL_WEBHOOK] Lead auto-assigned to:', assignResult.assignedTo.name);
      } else {
        console.log('[EMAIL_WEBHOOK] Lead remains in triage queue');
      }
    }

    return leadResult;

  } catch (error) {
    console.error('[EMAIL_WEBHOOK] Error processing email:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

module.exports = {
  createLeadFromEmail,
  processEmailWebhook,
  parseEmailContent
};
