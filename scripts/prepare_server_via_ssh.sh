#!/usr/bin/env bash
set -euo pipefail

SERVER_IP="185.219.7.21"
SERVER_USER="root"
APP_DIR="/opt/selective-conference"

if [[ "${1:-}" == "--help" ]]; then
  echo "Usage: $0 [repo_url]"
  echo "Example: $0 git@github.com:your-org/your-repo.git"
  exit 0
fi

REPO_URL="${1:-}"

echo "==> Preparing Debian 12 server ${SERVER_USER}@${SERVER_IP}"

ssh "${SERVER_USER}@${SERVER_IP}" bash -s <<REMOTE
set -euo pipefail
apt update
apt install -y ca-certificates curl gnupg lsb-release git ufw

install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/debian/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
chmod a+r /etc/apt/keyrings/docker.gpg

echo \
  "deb [arch=\$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/debian \
  \$(. /etc/os-release && echo \$VERSION_CODENAME) stable" > /etc/apt/sources.list.d/docker.list

apt update
apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

mkdir -p "${APP_DIR}"
cd "${APP_DIR}"
REMOTE

if [[ -n "${REPO_URL}" ]]; then
  ssh "${SERVER_USER}@${SERVER_IP}" "cd ${APP_DIR} && if [ ! -d .git ]; then git clone '${REPO_URL}' .; else git pull; fi"
fi

cat <<'NEXT'
==> Base server preparation complete.
Next:
1) Copy project files to /opt/selective-conference (if repo_url not provided)
2) Create /opt/selective-conference/.env with LIVEKIT_API_KEY/LIVEKIT_API_SECRET
3) Run:
   cd /opt/selective-conference
   docker compose up -d --build
4) Open firewall ports:
   ufw allow 22/tcp
   ufw allow 8000/tcp
   ufw allow 8080/tcp
   ufw --force enable
NEXT
