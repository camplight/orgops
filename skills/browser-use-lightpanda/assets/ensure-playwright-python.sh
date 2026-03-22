#!/usr/bin/env bash
set -euo pipefail

# Ensures a local Python env with Playwright package only.
# Lightpanda-only mode: Playwright connects over CDP; do not install Chromium.

VENV_DIR=".venv-playwright"

if ! command -v python3 >/dev/null 2>&1; then
  echo "python3 not found. Install Python 3.11+ first."
  exit 1
fi

if ! python3 -m uv --version >/dev/null 2>&1; then
  echo "uv not found in python environment; installing with pip."
  python3 -m pip install --user uv
fi

if [[ ! -d "${VENV_DIR}" ]]; then
  python3 -m uv venv "${VENV_DIR}"
fi

# shellcheck disable=SC1090
source "${VENV_DIR}/bin/activate"

python -m uv pip install --upgrade playwright

echo "playwright ready in ${VENV_DIR}"
echo "Use: source ${VENV_DIR}/bin/activate"
