# WhatsApp Leads Integration - Salesman App

## Implementation Guide

### Changes Made:

1. **Navigation Item Added** ✅
   - Added "WhatsApp Leads" menu item in sidebar
   - Icon: fab fa-whatsapp
   - Between Customers and Targets

2. **Backend APIs Created** ✅
   - `/api/salesman-whatsapp/connect` - Connect salesman WhatsApp
   - `/api/salesman-whatsapp/qr/:salesmanId` - Get QR code
   - `/api/salesman-whatsapp/status/:salesmanId` - Check connection status
   - `/api/salesman-whatsapp/disconnect` - Disconnect WhatsApp
   - `/api/salesman-whatsapp/messages/:salesmanId` - Get WhatsApp leads

3. **Lead Auto-Creation Service** ✅
   - `services/leadAutoCreateService.js`
   - Automatically converts WhatsApp messages to leads
   - Auto-dedupe by phone number
   - Assigns to salesman if from their WhatsApp
   - Routes to triage if from central bot

4. **Webhook Integration** ✅
   - Updated `routes/webhook.js`
   - Auto-creates leads from every WhatsApp message
   - Detects salesman vs central bot based on session name
   - Auto-assigns based on tenant settings

### Still Need to Add to salesman-app.html:

Add this code to complete the integration:

```javascript
// In the titles object (around line 1483)
const titles = {
    dashboard: 'Dashboard',
    visits: 'My Visits',
    customers: 'Customers',
    'whatsapp-leads': 'WhatsApp Leads', // ADD THIS
    targets: 'Targets',
    expenses: 'Expenses',
    reports: 'Reports'
};

// Add new page content (after reports page, around line 1130)
<div class="page" id="whatsapp-leads">
    <div class="card">
        <div class="card-header">
            <h3 class="card-title">📱 WhatsApp Connection</h3>
            <div id="whatsappConnectionStatus" style="font-size: 12px; padding: 6px 12px; border-radius: 6px; background: #f56565; color: white;">
                Disconnected
            </div>
        </div>
        <div style="padding: 20px;">
            <div id="whatsappConnectSection">
                <p style="margin-bottom: 20px; color: #718096;">Connect your personal WhatsApp number to receive and manage leads directly.</p>
                <button id="connectWhatsAppBtn" class="btn btn-primary" onclick="connectWhatsApp()">
                    <i class="fab fa-whatsapp"></i> Connect WhatsApp
                </button>
                
                <div id="qrCodeSection" style="display:none; margin-top: 20px;">
                    <p style="margin-bottom: 15px;">Scan this QR code with your WhatsApp mobile app:</p>
                    <div style="text-align: center; padding: 20px; background: white; border-radius: 12px; display: inline-block;">
                        <img id="whatsappQRCode" src="" alt="QR Code" style="max-width: 300px;">
                    </div>
                    <p style="margin-top: 15px; font-size: 13px; color: #718096;">
                        Open WhatsApp → Settings → Linked Devices → Link a Device
                    </p>
                </div>
            </div>
            
            <div id="whatsappConnected" style="display:none;">
                <div style="background: #c6f6d5; padding: 16px; border-radius: 8px; border-left: 4px solid #48bb78; margin-bottom: 20px;">
                    <div style="display: flex; align-items: center; gap: 12px;">
                        <i class="fas fa-check-circle" style="color: #48bb78; font-size: 24px;"></i>
                        <div>
                            <div style="font-weight: 600; color: #2d3748;">WhatsApp Connected</div>
                            <div style="font-size: 13px; color: #718096;">Your WhatsApp is connected and ready to receive leads</div>
                        </div>
                    </div>
                </div>
                
                <button class="btn btn-outline" onclick="disconnectWhatsApp()" style="border-color: #f56565; color: #f56565;">
                    <i class="fas fa-unlink"></i> Disconnect WhatsApp
                </button>
            </div>
        </div>
    </div>

    <div class="card" style="margin-top: 20px;">
        <div class="card-header">
            <h3 class="card-title">💬 My WhatsApp Leads</h3>
            <button class="btn btn-primary" onclick="loadWhatsAppLeads()">
                <i class="fas fa-sync"></i> Refresh
            </button>
        </div>
        <div id="whatsappLeadsContent">
            <div class="empty-state" style="padding: 40px;">
                <i class="fab fa-whatsapp fa-3x" style="color: #48bb78; margin-bottom: 15px;"></i>
                <h3>No WhatsApp Leads Yet</h3>
                <p>Connect your WhatsApp to start receiving leads</p>
            </div>
        </div>
    </div>
</div>

// Add these JavaScript functions (around line 2800, after other page load functions)

let whatsappStatusCheckInterval = null;

async function connectWhatsApp() {
    try {
        const btn = document.getElementById('connectWhatsAppBtn');
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Connecting...';

        const response = await apiFetch('/api/salesman-whatsapp/connect', {
            method: 'POST',
            body: JSON.stringify({
                salesmanId: salesmanId,
                tenantId: tenantId
            })
        });

        if (response.success) {
            // Show QR code section
            document.getElementById('qrCodeSection').style.display = 'block';
            
            // Start checking for QR code and status
            checkWhatsAppQR();
            whatsappStatusCheckInterval = setInterval(checkWhatsAppStatus, 3000);
            
        } else {
            throw new Error(response.error || 'Connection failed');
        }
    } catch (error) {
        alert('Error connecting WhatsApp: ' + error.message);
        const btn = document.getElementById('connectWhatsAppBtn');
        btn.disabled = false;
        btn.innerHTML = '<i class="fab fa-whatsapp"></i> Connect WhatsApp';
    }
}

async function checkWhatsAppQR() {
    try {
        const response = await apiFetch(`/api/salesman-whatsapp/qr/${salesmanId}?tenantId=${tenantId}`);
        
        if (response.qrCode) {
            document.getElementById('whatsappQRCode').src = response.qrCode;
        }

        if (response.status === 'authenticated') {
            // Connected successfully
            clearInterval(whatsappStatusCheckInterval);
            document.getElementById('qrCodeSection').style.display = 'none';
            document.getElementById('whatsappConnectSection').style.display = 'none';
            document.getElementById('whatsappConnected').style.display = 'block';
            document.getElementById('whatsappConnectionStatus').style.background = '#48bb78';
            document.getElementById('whatsappConnectionStatus').textContent = 'Connected';
            
            loadWhatsAppLeads();
        }
    } catch (error) {
        console.error('Error checking QR:', error);
    }
}

async function checkWhatsAppStatus() {
    try {
        const response = await apiFetch(`/api/salesman-whatsapp/status/${salesmanId}?tenantId=${tenantId}`);
        
        if (response.status === 'authenticated') {
            clearInterval(whatsappStatusCheckInterval);
            document.getElementById('qrCodeSection').style.display = 'none';
            document.getElementById('whatsappConnectSection').style.display = 'none';
            document.getElementById('whatsappConnected').style.display = 'block';
            document.getElementById('whatsappConnectionStatus').style.background = '#48bb78';
            document.getElementById('whatsappConnectionStatus').textContent = 'Connected';
            
            loadWhatsAppLeads();
        }
    } catch (error) {
        console.error('Error checking status:', error);
    }
}

async function disconnectWhatsApp() {
    if (!confirm('Are you sure you want to disconnect your WhatsApp?')) return;

    try {
        const response = await apiFetch('/api/salesman-whatsapp/disconnect', {
            method: 'POST',
            body: JSON.stringify({
                salesmanId: salesmanId,
                tenantId: tenantId
            })
        });

        if (response.success) {
            document.getElementById('whatsappConnectSection').style.display = 'block';
            document.getElementById('whatsappConnected').style.display = 'none';
            document.getElementById('qrCodeSection').style.display = 'none';
            document.getElementById('whatsappConnectionStatus').style.background = '#f56565';
            document.getElementById('whatsappConnectionStatus').textContent = 'Disconnected';
            
            alert('WhatsApp disconnected successfully');
        }
    } catch (error) {
        alert('Error disconnecting WhatsApp: ' + error.message);
    }
}

async function loadWhatsAppLeads() {
    try {
        const response = await apiFetch(`/api/salesman-whatsapp/messages/${salesmanId}?tenantId=${tenantId}`);
        
        if (!response.success) throw new Error(response.error);

        const leads = response.leads || [];

        if (leads.length === 0) {
            document.getElementById('whatsappLeadsContent').innerHTML = `
                <div class="empty-state" style="padding: 40px;">
                    <i class="fab fa-whatsapp fa-3x" style="color: #48bb78; margin-bottom: 15px;"></i>
                    <h3>No WhatsApp Leads Yet</h3>
                    <p>Leads will appear here when customers message you on WhatsApp</p>
                </div>
            `;
            return;
        }

        const leadsHTML = leads.map(lead => {
            const messages = lead.messages || [];
            const lastMessage = messages.length > 0 ? messages[messages.length - 1].body : 'No messages';
            const messagePreview = lastMessage.length > 100 ? lastMessage.substring(0, 100) + '...' : lastMessage;
            
            const heatBadge = lead.heat === 'HOT' ? 'background: #f56565; color: white;' :
                             lead.heat === 'WARM' ? 'background: #f6ad55; color: white;' :
                             'background: #4fd1c5; color: white;';

            return `
                <div class="card" style="margin-bottom: 15px; cursor: pointer;" onclick="viewWhatsAppLead('${lead.id}')">
                    <div style="padding: 16px;">
                        <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 12px;">
                            <div>
                                <div style="font-weight: 600; font-size: 16px; color: #2d3748; margin-bottom: 4px;">
                                    ${lead.name || lead.phone || 'Unknown'}
                                </div>
                                <div style="font-size: 13px; color: #718096;">
                                    <i class="fab fa-whatsapp" style="color: #48bb78;"></i> ${lead.phone}
                                </div>
                            </div>
                            <span style="padding: 4px 12px; border-radius: 12px; font-size: 11px; font-weight: 600; ${heatBadge}">
                                ${lead.heat || 'COLD'}
                            </span>
                        </div>
                        
                        <div style="background: #f7fafc; padding: 12px; border-radius: 8px; margin-bottom: 12px;">
                            <div style="font-size: 13px; color: #4a5568;">${messagePreview}</div>
                        </div>
                        
                        <div style="display: flex; justify-content: space-between; align-items: center; font-size: 12px; color: #a0aec0;">
                            <span><i class="fas fa-comments"></i> ${messages.length} messages</span>
                            <span>${new Date(lead.updated_at).toLocaleString()}</span>
                        </div>
                    </div>
                </div>
            `;
        }).join('');

        document.getElementById('whatsappLeadsContent').innerHTML = `
            <div style="padding: 20px;">
                ${leadsHTML}
            </div>
        `;

    } catch (error) {
        console.error('Error loading WhatsApp leads:', error);
        document.getElementById('whatsappLeadsContent').innerHTML = `
            <div class="empty-state" style="padding: 40px;">
                <i class="fas fa-exclamation-triangle fa-2x" style="color: #f56565; margin-bottom: 15px;"></i>
                <h3>Error Loading Leads</h3>
                <p>${error.message}</p>
            </div>
        `;
    }
}

function viewWhatsAppLead(leadId) {
    // Could open a modal or navigate to a detailed view
    alert('Lead detail view coming soon! Lead ID: ' + leadId);
    // Future: Show full conversation, add notes, change status, etc.
}

// Check WhatsApp connection status on page load
async function checkInitialWhatsAppStatus() {
    try {
        const response = await apiFetch(`/api/salesman-whatsapp/status/${salesmanId}?tenantId=${tenantId}`);
        
        if (response.status === 'authenticated') {
            document.getElementById('whatsappConnectSection').style.display = 'none';
            document.getElementById('whatsappConnected').style.display = 'block';
            document.getElementById('whatsappConnectionStatus').style.background = '#48bb78';
            document.getElementById('whatsappConnectionStatus').textContent = 'Connected';
        }
    } catch (error) {
        console.error('Error checking initial WhatsApp status:', error);
    }
}
```

### Database Requirement:

Add `salesman_id` column to `whatsapp_connections` table:

```sql
ALTER TABLE whatsapp_connections 
ADD COLUMN IF NOT EXISTS salesman_id TEXT,
ADD COLUMN IF NOT EXISTS connection_type TEXT DEFAULT 'TENANT';
```

### How It Works:

1. **Salesman Connects WhatsApp:**
   - Clicks "Connect WhatsApp" button
   - Scans QR code with their phone
   - Session name format: `salesman_{salesmanId}`

2. **Customer Messages Salesman:**
   - Message arrives via webhook
   - Webhook detects session is salesman-specific
   - Creates lead with `created_by_user_id` and `assigned_user_id` = salesmanId
   - Lead appears in salesman's WhatsApp Leads tab

3. **Customer Messages Central Bot:**
   - Message arrives via default session
   - Webhook creates lead with no assignment
   - Creates triage item
   - Admin can manually assign OR auto-assign based on settings

4. **FSM Visits:**
   - Salesman logs visit with contact_type = PERSONAL_VISIT or TELEPHONE
   - Can later be synced to create lead if needed

### Benefits:

✅ Each salesman owns their WhatsApp leads
✅ Central bot captures company enquiries
✅ Automatic lead deduplication by phone
✅ Flexible assignment (manual or auto-triage)
✅ Complete audit trail in crm_lead_events
✅ Seamless integration with existing FSM system
