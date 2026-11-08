#!/usr/bin/env bash
# Update the API on the server to the latest main (pushing to GitHub no longer deploys the backend):
#   sudo bash /opt/experts/backend/deploy/deploy.sh
set -euo pipefail
cd /opt/experts
sudo -u ubuntu git pull --ff-only
cd backend && sudo -u ubuntu npm ci --omit=dev
systemctl restart experts-api
sleep 3
curl -fsS localhost:4000/api/health && echo && echo "API is up."
