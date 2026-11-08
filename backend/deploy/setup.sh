#!/usr/bin/env bash
# One-time setup of the salon API on a fresh Ubuntu server (AWS Lightsail, Mumbai), off Vercel because the
# backend was ~77% of the Hobby plan's Fluid Active CPU. Safe to run again.
#
#   curl -fsSL https://raw.githubusercontent.com/maheshaggarwal21/HAIR-SALON-WEBSITE/main/backend/deploy/setup.sh | sudo bash
#
# Then put the backend's environment variables in /etc/experts-api.env and run: sudo systemctl restart experts-api
# DOMAINS (default api.thexpertshair.com) can list a test name too: ... | sudo DOMAINS="api.thexpertshair.com, api2.thexpertshair.com" bash
set -euo pipefail
DOMAINS="${DOMAINS:-api.thexpertshair.com}"
APP=/opt/experts

# 1 GB of RAM: swap so a spike (Excel export, AI call) slows the API down instead of killing it.
if ! swapon --show | grep -q /swapfile; then
  fallocate -l 1G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  grep -q /swapfile /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

apt-get update
apt-get install -y ca-certificates curl git gnupg debian-keyring debian-archive-keyring apt-transport-https

# Node 24 LTS.
command -v node >/dev/null || { curl -fsSL https://deb.nodesource.com/setup_24.x | bash -; apt-get install -y nodejs; }

# Caddy: HTTPS certificates are fetched and renewed by itself.
if ! command -v caddy >/dev/null; then
  curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/gpg.key | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt > /etc/apt/sources.list.d/caddy-stable.list
  chmod o+r /usr/share/keyrings/caddy-stable-archive-keyring.gpg /etc/apt/sources.list.d/caddy-stable.list
  apt-get update && apt-get install -y caddy
fi

[ -d "$APP/.git" ] || git clone --depth 1 https://github.com/maheshaggarwal21/HAIR-SALON-WEBSITE.git "$APP"
chown -R ubuntu:ubuntu "$APP"
sudo -u ubuntu bash -c "cd $APP/backend && npm ci --omit=dev"

# Secrets live here, readable by root only (systemd reads it before starting the API as "ubuntu").
[ -f /etc/experts-api.env ] || printf 'NODE_ENV=production\nPORT=4000\n' > /etc/experts-api.env
chmod 600 /etc/experts-api.env

cat > /etc/systemd/system/experts-api.service <<UNIT
[Unit]
Description=The Experts salon API
After=network-online.target
Wants=network-online.target

[Service]
User=ubuntu
WorkingDirectory=$APP/backend
EnvironmentFile=/etc/experts-api.env
ExecStart=/usr/bin/node index.js
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
UNIT

# The site's /api/public/* calls arrive through Vercel's rewrite, so the customer's IP is in X-Forwarded-For.
# Caddy ignores that header by default, which would put every customer under a few Vercel IPs for rate limits.
# shortcut: trusts X-Forwarded-For from anyone, so a direct caller can fake its IP for rate limits; restrict to
# the proxy's ranges if public endpoints get abused.
cat > /etc/caddy/Caddyfile <<CADDY
{
	servers {
		trusted_proxies static 0.0.0.0/0 ::/0
	}
}

$DOMAINS {
	encode gzip
	reverse_proxy localhost:4000
}
CADDY

systemctl daemon-reload
systemctl enable --now experts-api
systemctl reload caddy || systemctl restart caddy
echo
echo "Done. Next: sudo nano /etc/experts-api.env  (paste the backend's variables), then: sudo systemctl restart experts-api"
echo "Check:     curl -s localhost:4000/api/health"
