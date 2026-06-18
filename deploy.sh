#!/usr/bin/env bash
# =============================================================================
#  deploy.sh — S2D Online Programmer  |  MVIIS © 2021
#  Usage:
#    sudo bash deploy.sh        # smart deploy — skip if no new commits
#    sudo bash deploy.sh -f     # force deploy — skip commit check, hard reset
# =============================================================================
set -euo pipefail

# ── Configurable variables ────────────────────────────────────────────────────
SECRETS_FILE="/etc/s2d_programmer/secrets"
if [[ ! -f "$SECRETS_FILE" ]]; then
    err "Secrets file not found: ${SECRETS_FILE}\nCreate it with:\n  sudo mkdir -p /etc/s2d_programmer\n  echo 'GIT_PAT=ghp_yourtoken' | sudo tee ${SECRETS_FILE}\n  sudo chmod 600 ${SECRETS_FILE}"
fi
# shellcheck source=/dev/null
source "$SECRETS_FILE"
[[ -z "${GIT_PAT:-}" ]] && err "GIT_PAT not set in ${SECRETS_FILE}"

GIT_USER="melvin-da-venceslass"
GIT_REPO="s2d_online_programmer"
AUTHENTICATED_URL="https://${GIT_USER}:${GIT_PAT}@github.com/${GIT_USER}/${GIT_REPO}.git"
APP_NAME="s2d_programmer"
INSTALL_DIR="/opt/${APP_NAME}"
VENV_DIR="${INSTALL_DIR}/venv"
SERVICE_FILE="/etc/systemd/system/${APP_NAME}.service"
SERVICE_USER="mviis"                         # Linux user that runs the service
APP_HOST="0.0.0.0"
APP_PORT="8000"
APP_WORKERS="2"                              # gunicorn worker count
PROGRAMS_DIR="/home/mviis/programs"
COMMIT_TRACE_FILE="${INSTALL_DIR}/.last_deployed_commit"

# ── Parse flags ───────────────────────────────────────────────────────────────
FORCE=0
for arg in "$@"; do
  [[ "$arg" == "-f" ]] && FORCE=1
done

# ── Colour helpers ────────────────────────────────────────────────────────────
RED='\033[0;31m'; ORANGE='\033[0;33m'; NC='\033[0m'; BOLD='\033[1m'
info()  { echo -e "${ORANGE}${BOLD}[INFO]${NC}  $*"; }
ok()    { echo -e "\033[0;32m${BOLD}[ OK ]${NC}  $*"; }
skip()  { echo -e "\033[0;36m${BOLD}[SKIP]${NC}  $*"; }
err()   { echo -e "${RED}${BOLD}[ERR ]${NC}  $*" >&2; exit 1; }

# ── Root check ────────────────────────────────────────────────────────────────
[[ $EUID -ne 0 ]] && err "Run this script as root: sudo bash deploy.sh [-f]"

# ── 1. Pull / clone latest code ───────────────────────────────────────────────
info "Step 1 — Pulling latest code from Git..."
mkdir -p "$INSTALL_DIR"
if [[ -d "${INSTALL_DIR}/.git" ]]; then
    cd "$INSTALL_DIR"
    git remote set-url origin "$AUTHENTICATED_URL"
    git fetch --all --prune

    REMOTE_COMMIT=$(git rev-parse "origin/$(git rev-parse --abbrev-ref HEAD)")
    LOCAL_COMMIT=$(git rev-parse HEAD)

    if [[ $FORCE -eq 1 ]]; then
        info "Force flag set — skipping commit check, hard resetting to ${REMOTE_COMMIT:0:10}..."
        git reset --hard "$REMOTE_COMMIT"
        ok "Force-updated to commit ${REMOTE_COMMIT:0:10}."
    else
        # Check last deployed commit vs remote
        LAST_DEPLOYED=""
        [[ -f "$COMMIT_TRACE_FILE" ]] && LAST_DEPLOYED=$(cat "$COMMIT_TRACE_FILE")

        if [[ "$REMOTE_COMMIT" == "$LAST_DEPLOYED" ]]; then
            skip "No new commits since last deploy (${REMOTE_COMMIT:0:10}). Nothing to do."
            exit 0
        fi

        info "New commit detected: ${LAST_DEPLOYED:0:10} → ${REMOTE_COMMIT:0:10}"
        git reset --hard "$REMOTE_COMMIT"
        ok "Code updated to commit ${REMOTE_COMMIT:0:10}."
    fi
else
    git clone "$AUTHENTICATED_URL" "$INSTALL_DIR"
    cd "$INSTALL_DIR"
    REMOTE_COMMIT=$(git rev-parse HEAD)
    ok "Repository cloned to ${INSTALL_DIR} at commit ${REMOTE_COMMIT:0:10}."
fi

cd "$INSTALL_DIR"

# ── 2. Install Python system dependencies ─────────────────────────────────────
info "Step 2 — Installing Linux system dependencies..."
apt-get update -y -q
apt-get install -y -q \
    python3 \
    python3-pip \
    python3-venv \
    python3-dev \
    build-essential \
    libssl-dev \
    libffi-dev \
    libjpeg-dev \
    zlib1g-dev \
    libfreetype6-dev \
    git \
    curl
ok "System packages installed."

# ── 3. Create virtual-env and install requirements.txt ───────────────────────
info "Step 3 — Setting up Python virtual environment..."
if [[ ! -d "$VENV_DIR" ]]; then
    python3 -m venv "$VENV_DIR"
    ok "Virtual environment created at ${VENV_DIR}."
fi

"${VENV_DIR}/bin/pip" install --upgrade pip setuptools wheel -q
"${VENV_DIR}/bin/pip" install -r "${INSTALL_DIR}/requirements.txt" -q
ok "Python requirements installed."

# ── 4. Build – compile .py files to bytecode ─────────────────────────────────
info "Step 4 — Compiling Python bytecode..."
"${VENV_DIR}/bin/python" -m compileall -q "$INSTALL_DIR"
ok "Bytecode compiled (source .py files retained — required by Python import system)."

# ── Save deployed commit trace ────────────────────────────────────────────────
echo "$REMOTE_COMMIT" > "$COMMIT_TRACE_FILE"
ok "Commit trace saved: ${REMOTE_COMMIT:0:10} → ${COMMIT_TRACE_FILE}"

# ── 5. Set file permissions  (owner RWX, group RX, other R) ──────────────────
info "Step 5 — Setting file permissions..."

# Ensure service user exists
if ! id "$SERVICE_USER" &>/dev/null; then
    useradd --system --no-create-home --shell /usr/sbin/nologin "$SERVICE_USER"
    ok "System user '${SERVICE_USER}' created."
fi

# Create programs directory
mkdir -p "$PROGRAMS_DIR"

# Ownership
chown -R "${SERVICE_USER}:${SERVICE_USER}" "$INSTALL_DIR"
chown -R "${SERVICE_USER}:${SERVICE_USER}" "$PROGRAMS_DIR"

# Permissions: directories 755, files 644, scripts 755
find "$INSTALL_DIR" -type d -exec chmod 755 {} +
find "$INSTALL_DIR" -type f -exec chmod 644 {} +
find "$INSTALL_DIR" -type f -name "*.sh" -exec chmod 755 {} +
chmod 755 "${VENV_DIR}/bin"/*
chmod 755 "$PROGRAMS_DIR"
ok "Permissions applied."

# ── 6 & 7. Create / update systemd service file ─────────────────────────────
info "Step 6/7 — Writing systemd service file..."
cat > "$SERVICE_FILE" <<EOF
[Unit]
Description=S2D Online Programmer — MVIIS
Documentation=https://github.com/mviis/s2d_online_programmer
After=network.target
Wants=network-online.target

[Service]
Type=simple
User=${SERVICE_USER}
WorkingDirectory=${INSTALL_DIR}
EnvironmentFile=${INSTALL_DIR}/.env
ExecStart=${VENV_DIR}/bin/gunicorn main:app \
    --worker-class uvicorn.workers.UvicornWorker \
    --workers ${APP_WORKERS} \
    --bind ${APP_HOST}:${APP_PORT} \
    --timeout 120 \
    --access-logfile - \
    --error-logfile -
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal
SyslogIdentifier=${APP_NAME}

# Hardening
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ReadWritePaths=${PROGRAMS_DIR} ${INSTALL_DIR}

[Install]
WantedBy=multi-user.target
EOF
ok "Service file written at ${SERVICE_FILE}."

# ── 8. Enable & (re)start the service ────────────────────────────────────────
info "Step 8 — Enabling and starting service..."
systemctl daemon-reload
systemctl enable "${APP_NAME}.service"
systemctl restart "${APP_NAME}.service"

sleep 2
if systemctl is-active --quiet "${APP_NAME}.service"; then
    ok "Service '${APP_NAME}' is running."
else
    err "Service failed to start. Check logs: journalctl -u ${APP_NAME} -n 50 --no-pager"
fi

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BOLD}  S2D Online Programmer deployed successfully${NC}"
echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "  App URL   : http://<server-ip>:${APP_PORT}"
echo -e "  Install   : ${INSTALL_DIR}"
echo -e "  Programs  : ${PROGRAMS_DIR}"
echo -e "  Service   : ${APP_NAME}.service"
echo -e "  Logs      : journalctl -u ${APP_NAME} -f"
echo ""
