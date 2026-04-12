#!/bin/bash
# SSL certificate renewal script for dnd.kimse.me
# Stops the app (frees port 80), renews via certbot, restarts the app.

DOMAIN="dnd.kimse.me"
PM2_APP="dnd"
LOG_FILE="/var/log/cert-renewal.log"

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

log "---- Certificate renewal started ----"

# Check certbot is installed
if ! command -v certbot &> /dev/null; then
  log "ERROR: certbot is not installed. Run: sudo apt install certbot"
  exit 1
fi

# Check pm2 is installed
if ! command -v pm2 &> /dev/null; then
  log "ERROR: pm2 is not installed. Run: sudo npm install -g pm2"
  exit 1
fi

# Stop app to free port 80
log "Stopping $PM2_APP to free port 80..."
pm2 stop "$PM2_APP"
if [ $? -ne 0 ]; then
  log "ERROR: Failed to stop pm2 app '$PM2_APP'"
  exit 1
fi

# Renew the certificate
log "Running certbot renew for $DOMAIN..."
certbot renew --cert-name "$DOMAIN" --standalone
CERTBOT_EXIT=$?

# Always restart the app, even if certbot failed
log "Restarting $PM2_APP..."
pm2 restart "$PM2_APP"

if [ $CERTBOT_EXIT -ne 0 ]; then
  log "ERROR: certbot renewal failed (exit code $CERTBOT_EXIT). App restarted anyway."
  exit 1
fi

log "Certificate renewed successfully."
log "---- Done ----"
