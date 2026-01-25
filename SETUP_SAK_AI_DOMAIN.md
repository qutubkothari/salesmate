# 🎯 Setup sak-ai.saksolution.com with HTTPS

## Server Information
- **IP Address:** 72.62.192.228
- **Domain:** sak-ai.saksolution.com
- **Current Domain:** salesmate.saksolution.com (already configured)
- **Application Port:** 8080 (Node.js on PM2)

---

## 📋 Step 1: Configure DNS (Do this FIRST)

### Go to your domain registrar
(Where you registered saksolution.com - GoDaddy, Namecheap, Cloudflare, etc.)

### Add an A Record:

```
Type:  A
Name:  sak-ai
Value: 72.62.192.228
TTL:   300 (or 5 minutes)
```

### Visual Guide by Provider:

**For GoDaddy:**
1. Log in → My Products → DNS
2. Click "Add" under Records
3. Select Type: A
4. Name: `sak-ai`
5. Value: `72.62.192.228`
6. TTL: 5 minutes
7. Click Save

**For Namecheap:**
1. Dashboard → Domain List → Manage
2. Advanced DNS tab
3. Add New Record
4. Type: A Record
5. Host: `sak-ai`
6. Value: `72.62.192.228`
7. TTL: 5 min
8. Save

**For Cloudflare:**
1. Select your domain (saksolution.com)
2. DNS → Records → Add record
3. Type: A
4. Name: `sak-ai`
5. IPv4 address: `72.62.192.228`
6. TTL: Auto or 300s
7. Proxy status: DNS only (turn off orange cloud)
8. Save

---

## 🔧 Step 2: SSH into Hostinger VPS

```powershell
# Connect to the server
ssh root@72.62.192.228
```

---

## 🌐 Step 3: Configure Nginx for sak-ai.saksolution.com

### Create new Nginx server block:

```bash
# Create nginx configuration for sak-ai.saksolution.com
sudo tee /etc/nginx/sites-available/sak-ai.saksolution.com << 'EOF'
server {
    listen 80;
    server_name sak-ai.saksolution.com;

    # Force HTTPS redirect (will be enabled after SSL setup)
    # return 301 https://$server_name$request_uri;

    location / {
        proxy_pass http://localhost:8080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        
        # Increased timeouts for long operations
        proxy_connect_timeout 600;
        proxy_send_timeout 600;
        proxy_read_timeout 600;
        send_timeout 600;
    }

    # WebSocket support
    location /socket.io/ {
        proxy_pass http://localhost:8080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Security headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;

    # Max upload size for file uploads
    client_max_body_size 50M;
}
EOF

# Enable the site
sudo ln -sf /etc/nginx/sites-available/sak-ai.saksolution.com /etc/nginx/sites-enabled/

# Test nginx configuration
sudo nginx -t

# If test passes, reload nginx
sudo systemctl reload nginx
```

---

## 🔒 Step 4: Install SSL Certificate with Let's Encrypt

### Install Certbot (if not already installed):

```bash
# Install certbot
sudo apt update
sudo apt install -y certbot python3-certbot-nginx

# Verify installation
certbot --version
```

### Obtain SSL Certificate:

```bash
# Get SSL certificate for sak-ai.saksolution.com
sudo certbot --nginx -d sak-ai.saksolution.com

# Follow the prompts:
# 1. Enter your email address (for renewal notifications)
# 2. Agree to Terms of Service (Y)
# 3. Share email with EFF (optional - Y or N)
# 4. Choose redirect option: 2 (Redirect HTTP to HTTPS - Recommended)
```

**What Certbot Does Automatically:**
- Obtains SSL certificate from Let's Encrypt
- Updates Nginx configuration to use HTTPS
- Adds automatic HTTP to HTTPS redirect
- Sets up auto-renewal (certificates renew every 90 days)

---

## ✅ Step 5: Verify Setup

### Test DNS Resolution:

```bash
# From your local machine (PowerShell)
nslookup sak-ai.saksolution.com
# Should return: 72.62.192.228
```

### Test HTTP Access:

```bash
# From PowerShell
curl http://sak-ai.saksolution.com
# Should redirect to HTTPS or return HTML
```

### Test HTTPS Access:

```bash
# From PowerShell
curl https://sak-ai.saksolution.com
# Should return your application's homepage
```

### Test in Browser:

1. Open: https://sak-ai.saksolution.com
2. Check for:
   - ✅ Green padlock icon (secure connection)
   - ✅ Application loads correctly
   - ✅ No certificate warnings
   - ✅ HTTP redirects to HTTPS

---

## 🔄 Step 6: Auto-Renewal Setup (Certbot does this automatically)

Certbot installs a systemd timer that checks twice daily for expiring certificates:

```bash
# Check renewal timer status
sudo systemctl status certbot.timer

# Test renewal (dry run - doesn't actually renew)
sudo certbot renew --dry-run

# Manual renewal (if needed)
sudo certbot renew
```

---

## 🚨 Troubleshooting

### Issue: DNS not resolving

**Check DNS propagation:**
```powershell
# From your machine
nslookup sak-ai.saksolution.com

# Or use online tool:
# https://www.whatsmydns.net/#A/sak-ai.saksolution.com
```

**Wait:** DNS can take 5-60 minutes to propagate globally

### Issue: "Connection refused" error

**Check if Nginx is running:**
```bash
sudo systemctl status nginx
sudo systemctl start nginx
```

**Check if Node.js app is running:**
```bash
pm2 status
pm2 restart salesmate
```

### Issue: "502 Bad Gateway"

**Check Node.js is listening on port 8080:**
```bash
sudo netstat -tulpn | grep 8080
# Should show: node ... LISTEN on 8080
```

**Check PM2 logs:**
```bash
pm2 logs salesmate --lines 100
```

### Issue: Certbot fails

**Common causes:**
1. DNS not pointing to server yet (wait for propagation)
2. Port 80/443 blocked by firewall
3. Nginx not running

**Check ports:**
```bash
sudo ufw status
# Port 80 and 443 should be ALLOW

# If not:
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw reload
```

**Check Nginx:**
```bash
sudo nginx -t
sudo systemctl status nginx
```

---

## 📝 Quick Reference Commands

```bash
# Reload Nginx after config changes
sudo systemctl reload nginx

# Test Nginx configuration
sudo nginx -t

# View Nginx error logs
sudo tail -f /var/log/nginx/error.log

# View Nginx access logs
sudo tail -f /var/log/nginx/access.log

# Check SSL certificate expiry
sudo certbot certificates

# Force certificate renewal
sudo certbot renew --force-renewal

# PM2 app status
pm2 status

# PM2 app logs
pm2 logs salesmate --lines 50
```

---

## 🎉 Expected Result

After completing all steps:

✅ **HTTP Access:** http://sak-ai.saksolution.com → Redirects to HTTPS  
✅ **HTTPS Access:** https://sak-ai.saksolution.com → Secure connection, application loads  
✅ **Certificate:** Valid Let's Encrypt SSL certificate  
✅ **Auto-Renewal:** Automatic renewal every 90 days  
✅ **Both Domains Work:**
   - https://salesmate.saksolution.com (existing)
   - https://sak-ai.saksolution.com (new)

Both domains point to the same Node.js application on port 8080.

---

## 🔍 Additional Notes

### Multiple Domain Names
Both `salesmate.saksolution.com` and `sak-ai.saksolution.com` can point to the same application. Nginx will route both domains to `localhost:8080`.

### SSL Certificates
Each domain needs its own SSL certificate. You can also use a single wildcard certificate for `*.saksolution.com` if you have many subdomains.

### Firewall Rules
Ensure Hostinger firewall allows:
- Port 22 (SSH)
- Port 80 (HTTP)
- Port 443 (HTTPS)
- Port 8080 (Node.js - internal only, not exposed)
