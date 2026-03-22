#!/usr/bin/env bash
set -euo pipefail

SOURCE_DIR="${1:-}"
INSTALL_DIR="${2:-$HOME/orgops}"

if [[ -z "${SOURCE_DIR}" ]]; then
  SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
fi

if [[ ! -d "${SOURCE_DIR}" ]]; then
  echo "Source directory does not exist: ${SOURCE_DIR}" >&2
  exit 1
fi

if ! command -v rsync >/dev/null 2>&1; then
  echo "rsync is required for idempotent install updates." >&2
  exit 1
fi

echo "Installing OrgOps from extracted bundle: ${SOURCE_DIR}"
echo "Target install dir: ${INSTALL_DIR}"

mkdir -p "${INSTALL_DIR}"
rsync -a --delete \
  --exclude ".orgops-data" \
  --exclude "files" \
  --exclude ".env" \
  "${SOURCE_DIR}/" "${INSTALL_DIR}/"

if [[ ! -f "${INSTALL_DIR}/.env" && -f "${INSTALL_DIR}/.env.example" ]]; then
  cp "${INSTALL_DIR}/.env.example" "${INSTALL_DIR}/.env"
fi

if [[ -f "${INSTALL_DIR}/start-orgops.sh" ]]; then
  chmod +x "${INSTALL_DIR}/start-orgops.sh"
fi

echo "OrgOps installed (idempotent update applied; data directory preserved)."
echo "Not started automatically."
echo "Start manually with:"
echo "  cd \"${INSTALL_DIR}\" && ./start-orgops.sh"
echo "Note: DB migrations are applied automatically when the API starts."
