#!/usr/bin/env bash
set -euo pipefail

# Installs Lightpanda locally for the current user if missing.
# Target path: ~/.local/bin/lightpanda

TARGET_DIR="${HOME}/.local/bin"
TARGET_BIN="${TARGET_DIR}/lightpanda"

if command -v lightpanda >/dev/null 2>&1; then
  echo "lightpanda already available at $(command -v lightpanda)"
  exit 0
fi

if [[ -x "${TARGET_BIN}" ]]; then
  echo "lightpanda already installed at ${TARGET_BIN}"
  exit 0
fi

OS="$(uname -s)"
ARCH="$(uname -m)"

URL=""
case "${OS}:${ARCH}" in
  Linux:x86_64)
    URL="https://github.com/lightpanda-io/browser/releases/download/nightly/lightpanda-x86_64-linux"
    ;;
  Darwin:arm64)
    URL="https://github.com/lightpanda-io/browser/releases/download/nightly/lightpanda-aarch64-macos"
    ;;
  *)
    echo "Unsupported platform ${OS}/${ARCH}."
    echo "Install manually from https://github.com/lightpanda-io/browser/releases/tag/nightly"
    exit 1
    ;;
esac

mkdir -p "${TARGET_DIR}"
curl -fL "${URL}" -o "${TARGET_BIN}"
chmod +x "${TARGET_BIN}"

echo "Installed lightpanda to ${TARGET_BIN}"
echo "If needed, add ${TARGET_DIR} to PATH."
echo "Verify with: ${TARGET_BIN} --help"
