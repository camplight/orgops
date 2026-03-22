#!/usr/bin/env bash
set -euo pipefail

OUTPUT_DIR="${1:-dist}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

raw_platform="$(uname -s)"
case "${raw_platform}" in
  Linux) platform="linux" ;;
  Darwin) platform="darwin" ;;
  *)
    echo "Unsupported platform: ${raw_platform}" >&2
    exit 1
    ;;
esac

raw_arch="$(uname -m)"
case "${raw_arch}" in
  x86_64) arch="x64" ;;
  arm64|aarch64) arch="arm64" ;;
  *)
    echo "Unsupported architecture: ${raw_arch}" >&2
    exit 1
    ;;
esac

output_root="${REPO_ROOT}/${OUTPUT_DIR}"
bundle_name="orgops-${platform}-${arch}-bundle"
bundle_root="${output_root}/${bundle_name}"
archive_path="${output_root}/${bundle_name}.tar.gz"

echo "Preparing output directory at ${output_root}"
rm -rf "${output_root}"
mkdir -p "${output_root}"

echo "Copying repository files into staging bundle"
rsync -a \
  --exclude ".git" \
  --exclude ".github" \
  --exclude ".cursor" \
  --exclude "node_modules" \
  --exclude "dist" \
  --exclude ".orgops-data" \
  --exclude "files" \
  "${REPO_ROOT}/" "${bundle_root}/"

pushd "${bundle_root}" >/dev/null
echo "Installing workspace dependencies in bundle"
npm ci

echo "Building UI assets"
npm run build

node_version="$(node -p 'process.version')"
node_dist="node-${node_version}-${platform}-${arch}"
node_url_xz="https://nodejs.org/dist/${node_version}/${node_dist}.tar.xz"
node_url_gz="https://nodejs.org/dist/${node_version}/${node_dist}.tar.gz"
node_archive="${TMPDIR:-/tmp}/${node_dist}.tar"
extract_root="${TMPDIR:-/tmp}/orgops-node-extract-${platform}-${arch}"
runtime_node_root="${bundle_root}/runtime/node"

echo "Downloading portable Node runtime"
rm -f "${node_archive}.xz" "${node_archive}.gz"
if curl -fsSL "${node_url_xz}" -o "${node_archive}.xz"; then
  downloaded_archive="${node_archive}.xz"
else
  curl -fsSL "${node_url_gz}" -o "${node_archive}.gz"
  downloaded_archive="${node_archive}.gz"
fi

rm -rf "${extract_root}"
mkdir -p "${extract_root}" "${runtime_node_root}"
tar -xf "${downloaded_archive}" -C "${extract_root}"

extracted_node_dir="$(find "${extract_root}" -mindepth 1 -maxdepth 1 -type d | head -n 1)"
cp -R "${extracted_node_dir}/." "${runtime_node_root}/"

cat > "${bundle_root}/start-orgops.sh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export PATH="${ROOT}/runtime/node/bin:${PATH}"

if [[ ! -f "${ROOT}/.env" && -f "${ROOT}/.env.example" ]]; then
  cp "${ROOT}/.env.example" "${ROOT}/.env"
fi

echo "Starting OrgOps..."
"${ROOT}/runtime/node/bin/npm" run prod:all
EOF

chmod +x "${bundle_root}/start-orgops.sh"

cat > "${bundle_root}/install-prereqs.sh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

SCRIPT_PATH="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/scripts/install-unix-prereqs.sh"
if [[ ! -f "${SCRIPT_PATH}" ]]; then
  echo "Cannot find prerequisite installer at ${SCRIPT_PATH}" >&2
  exit 1
fi

bash "${SCRIPT_PATH}"
EOF

cat > "${bundle_root}/install-orgops.sh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALL_DIR="${1:-$HOME/orgops}"

bash "${ROOT}/install-prereqs.sh"
bash "${ROOT}/scripts/install-unix-extracted-bundle.sh" "${ROOT}" "${INSTALL_DIR}"
EOF

chmod +x "${bundle_root}/install-prereqs.sh" "${bundle_root}/install-orgops.sh"
popd >/dev/null

echo "Creating archive at ${archive_path}"
tar -czf "${archive_path}" -C "${output_root}" "${bundle_name}"

echo "Bundle ready:"
echo "  Folder: ${bundle_root}"
echo "  Archive: ${archive_path}"
