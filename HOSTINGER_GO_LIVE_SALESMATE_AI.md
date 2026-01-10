# Hostinger Go-Live: Salesmate AI

This repo is a Node/Express server (`index.js`) that listens on `PORT` (default `8081`) and provides `/health`.

## 1) One-time server setup (Hostinger VPS)

SSH as root:

```bash
ssh root@YOUR_VPS_IP
```

Install Node 18+ + build tools + nginx:

```bash
apt update
apt install -y curl git nginx
curl -fsSL https://deb.nodesource.com/setup_18.x | bash -
apt install -y nodejs
npm i -g pm2
```

(Optional but recommended) Firewall:

```bash
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw enable
ufw status
```

## 2) Deploy from your Windows machine (recommended)

From this repo folder on your PC, run:

```powershell
$env:HOSTINGER_IP="YOUR_VPS_IP"
$env:HOSTINGER_USER="root"
$env:HOSTINGER_KEY_PATH="$env:USERPROFILE\.ssh\hostinger_ed25519"
$env:HOSTINGER_REMOTE_PATH="/var/www/salesmate-ai"
$env:HOSTINGER_APP_PORT="8081"

.\deploy-hostinger-salesmate-ai.ps1
```

## 3) Configure Nginx + domain

On the VPS:

```bash
nano /etc/nginx/sites-available/salesmate-ai
```

Paste contents of `nginx-salesmate-ai.conf` and set your `server_name`.

Enable site:

```bash
ln -sf /etc/nginx/sites-available/salesmate-ai /etc/nginx/sites-enabled/salesmate-ai
nginx -t
systemctl restart nginx
```

## 4) SSL (Let’s Encrypt)

```bash
apt install -y certbot python3-certbot-nginx
certbot --nginx -d yourdomain.com -d www.yourdomain.com
```

## 5) Verify

- Health: `http(s)://yourdomain.com/health`
- App: `http(s)://yourdomain.com/`

PM2 commands:

```bash
pm2 status
pm2 logs salesmate-ai --lines 200
pm2 restart salesmate-ai
```
