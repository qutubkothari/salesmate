#!/bin/bash

DOMAIN="sak-ai.saksolution.ae"
REPO_PATH="/var/www/salesmate-ai"
EMAIL="sales@saksolution.com"

echo "Setting up Nginx for $DOMAIN..."

# Ensure we are sudo
if [ "$EUID" -ne 0 ]; then
  echo "Please run as root"
  exit 1
fi

# Check if certificates already exist
if [ -d "/etc/letsencrypt/live/$DOMAIN" ]; then
    echo "SSL certs found. Applying full configuration..."
    cp "$REPO_PATH/nginx-sak-ai-ae.conf" "/etc/nginx/sites-available/$DOMAIN"
else
    echo "SSL certs missing. Starting fresh setup..."
    
    # 1. Create simple Port 80 config for verification
    cat > "/etc/nginx/sites-available/$DOMAIN" <<EOF
server {
    listen 80;
    server_name $DOMAIN;
    location / {
        proxy_pass http://localhost:8055;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
    }
}
EOF

    # 2. Enable site
    ln -sf "/etc/nginx/sites-available/$DOMAIN" "/etc/nginx/sites-enabled/"
    
    # 3. Reload Nginx
    nginx -t && systemctl reload nginx
    
    # 4. Run Certbot
    echo "Running Certbot..."
    certbot --nginx -d $DOMAIN --non-interactive --agree-tos -m $EMAIL --redirect
    
    if [ $? -eq 0 ]; then
        echo "Certbot succeeded. Applying clean custom config..."
        # 5. Overwrite with our robust config (which has SSL paths hardcoded)
        # Note: We assume Certbot used the standard path /etc/letsencrypt/live/$DOMAIN/
        cp "$REPO_PATH/nginx-sak-ai-ae.conf" "/etc/nginx/sites-available/$DOMAIN"
    else
        echo "Certbot failed. Please check logs."
        exit 1
    fi
fi

# Final reload
echo "Testing Nginx configuration..."
nginx -t

if [ $? -eq 0 ]; then
    systemctl reload nginx
    echo "Nginx reloaded successfully. $DOMAIN is live!"
else
    echo "Nginx configuration test failed. Reverting to port 80 config..."
    # Fallback to simple http if strict config fails (safety net)
       cat > "/etc/nginx/sites-available/$DOMAIN" <<EOF
server {
    listen 80;
    server_name $DOMAIN;
    location / {
        proxy_pass http://localhost:8055;
    }
}
EOF
    systemctl reload nginx
    echo "Reverted to unsecured HTTP due to config error."
fi
