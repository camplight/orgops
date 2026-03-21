#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  install-linux-bundle.sh <bundle-tar-gz-url-or-local-path> [install-dir]

Examples:
  install-linux-bundle.sh https://example.com/orgops-linux-x64-bundle.tar.gz
  install-linux-bundle.sh ./orgops-linux-x64-bundle.tar.gz /opt/orgops

Environment variables:
  ORGOPS_SYSTEMD_SERVICE=1   Install and start a systemd service (default: 0)
  ORGOPS_SERVICE_NAME        Service name when ORGOPS_SYSTEMD_SERVICE=1 (default: orgops)
EOF
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

BUNDLE_SOURCE="${1:-}"
INSTALL_DIR="${2:-$HOME/orgops}"
ENABLE_SYSTEMD="${ORGOPS_SYSTEMD_SERVICE:-0}"
SERVICE_NAME="${ORGOPS_SERVICE_NAME:-orgops}"

if [[ -z "${BUNDLE_SOURCE}" ]]; then
  usage
  exit 1
fi

WORK_DIR="$(mktemp -d)"
trap 'rm -rf "${WORK_DIR}"' EXIT

BUNDLE_ARCHIVE="${WORK_DIR}/orgops-bundle.tar.gz"
EXTRACT_DIR="${WORK_DIR}/extract"
mkdir -p "${EXTRACT_DIR}"

echo "Resolving bundle source: ${BUNDLE_SOURCE}"
if [[ -f "${BUNDLE_SOURCE}" ]]; then
  cp "${BUNDLE_SOURCE}" "${BUNDLE_ARCHIVE}"
elif [[ "${BUNDLE_SOURCE}" =~ ^https?:// ]]; then
  curl -fsSL "${BUNDLE_SOURCE}" -o "${BUNDLE_ARCHIVE}"
else
  echo "Invalid bundle source: provide a local file path or http(s) URL." >&2
  exit 1
fi

echo "Extracting bundle archive"
tar -xzf "${BUNDLE_ARCHIVE}" -C "${EXTRACT_DIR}"

BUNDLE_ROOT="$(find "${EXTRACT_DIR}" -mindepth 1 -maxdepth 1 -type d | head -n 1)"
if [[ -z "${BUNDLE_ROOT}" || ! -d "${BUNDLE_ROOT}" ]]; then
  echo "Bundle archive does not contain a valid top-level directory." >&2
  exit 1
fi

echo "Installing OrgOps into ${INSTALL_DIR}"
mkdir -p "$(dirname "${INSTALL_DIR}")"
mkdir -p "${INSTALL_DIR}"
if ! command -v rsync >/dev/null 2>&1; then
  echo "rsync is required for idempotent install updates." >&2
  exit 1
fi
rsync -a --delete \
  --exclude ".orgops-data" \
  --exclude "files" \
  --exclude ".env" \
  "${BUNDLE_ROOT}/" "${INSTALL_DIR}/"

if [[ ! -f "${INSTALL_DIR}/.env" && -f "${INSTALL_DIR}/.env.example" ]]; then
  cp "${INSTALL_DIR}/.env.example" "${INSTALL_DIR}/.env"
fi

if [[ ! -x "${INSTALL_DIR}/start-orgops.sh" ]]; then
  chmod +x "${INSTALL_DIR}/start-orgops.sh"
fi

if [[ "${ENABLE_SYSTEMD}" == "1" ]]; then
  if ! command -v systemctl >/dev/null 2>&1; then
    echo "systemd requested but systemctl was not found." >&2
    exit 1
  fi
  if [[ "${EUID}" -ne 0 ]]; then
    echo "systemd install requires root. Re-run with sudo and ORGOPS_SYSTEMD_SERVICE=1." >&2
    exit 1
  fi

  SERVICE_PATH="/etc/systemd/system/${SERVICE_NAME}.service"
  cat > "${SERVICE_PATH}" <<EOF
[Unit]
Description=OrgOps Service
After=network.target

[Service]
Type=simple
WorkingDirectory=${INSTALL_DIR}
ExecStart=${INSTALL_DIR}/start-orgops.sh
Restart=always
RestartSec=3
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOF

  systemctl daemon-reload
  systemctl enable --now "${SERVICE_NAME}.service"
  echo "Installed and started systemd service: ${SERVICE_NAME}.service"
else
  echo "OrgOps installed (idempotent update applied; data directory preserved)."
  echo "Start manually with:"
  echo "  cd \"${INSTALL_DIR}\" && ./start-orgops.sh"
fi

echo "Note: DB migrations are applied automatically when the API starts."
