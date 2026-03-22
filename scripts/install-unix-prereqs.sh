#!/usr/bin/env bash
set -euo pipefail

INCLUDE_PYTHON="${INCLUDE_PYTHON:-0}"

log() {
  printf '==> %s\n' "$1"
}

has_cmd() {
  command -v "$1" >/dev/null 2>&1
}

need_sudo() {
  [[ "${EUID}" -ne 0 ]]
}

run_pkg_install() {
  local manager="$1"
  shift

  if need_sudo; then
    sudo "${manager}" "$@"
  else
    "${manager}" "$@"
  fi
}

install_with_apt() {
  local pkgs=(curl tar rsync git ca-certificates)
  if [[ "${INCLUDE_PYTHON}" == "1" ]]; then
    pkgs+=(python3 python3-pip)
  fi
  run_pkg_install apt-get update
  run_pkg_install apt-get install -y "${pkgs[@]}"
}

install_with_dnf() {
  local pkgs=(curl tar rsync git ca-certificates)
  if [[ "${INCLUDE_PYTHON}" == "1" ]]; then
    pkgs+=(python3 python3-pip)
  fi
  run_pkg_install dnf install -y "${pkgs[@]}"
}

install_with_yum() {
  local pkgs=(curl tar rsync git ca-certificates)
  if [[ "${INCLUDE_PYTHON}" == "1" ]]; then
    pkgs+=(python3 python3-pip)
  fi
  run_pkg_install yum install -y "${pkgs[@]}"
}

install_with_apk() {
  local pkgs=(curl tar rsync git ca-certificates bash)
  if [[ "${INCLUDE_PYTHON}" == "1" ]]; then
    pkgs+=(python3 py3-pip)
  fi
  run_pkg_install apk add --no-cache "${pkgs[@]}"
}

install_with_brew() {
  local pkgs=(curl rsync git)
  if [[ "${INCLUDE_PYTHON}" == "1" ]]; then
    pkgs+=(python@3.11)
  fi
  brew update
  brew install "${pkgs[@]}"
}

log "Installing Unix prerequisites for OrgOps"

if has_cmd apt-get; then
  install_with_apt
elif has_cmd dnf; then
  install_with_dnf
elif has_cmd yum; then
  install_with_yum
elif has_cmd apk; then
  install_with_apk
elif has_cmd brew; then
  install_with_brew
else
  echo "Unsupported package manager. Install manually: curl tar rsync git${INCLUDE_PYTHON:+ python3}" >&2
  exit 1
fi

log "Done. Detected versions:"
for cmd in bash curl tar rsync git; do
  if has_cmd "${cmd}"; then
    "${cmd}" --version 2>/dev/null | head -n 1 || true
  fi
done
if [[ "${INCLUDE_PYTHON}" == "1" ]] && has_cmd python3; then
  python3 --version
fi
