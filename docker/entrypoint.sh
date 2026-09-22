#!/usr/bin/env bash
set -euo pipefail

COMPONENTS_RAW="${ORGOPS_COMPONENTS:-api,runner,user-ui}"
PROXY_PORT="${ORGOPS_PROXY_PORT:-8787}"
API_INTERNAL_PORT="${ORGOPS_INTERNAL_API_PORT:-8788}"
ADMIN_UI_PORT="${ORGOPS_INTERNAL_ADMIN_UI_PORT:-4173}"
USER_UI_PORT="${ORGOPS_INTERNAL_USER_UI_PORT:-4190}"

declare -A ENABLED=(
  ["api"]=0
  ["runner"]=0
  ["admin-ui"]=0
  ["user-ui"]=0
)
NORMALIZED_COMPONENTS=()

normalize_component() {
  local token="$1"
  case "${token}" in
    api) echo "api" ;;
    runner) echo "runner" ;;
    admin|admin-ui) echo "admin-ui" ;;
    user|user-ui) echo "user-ui" ;;
    *)
      echo "Unknown component \"${token}\". Allowed: api, runner, admin-ui, user-ui." >&2
      exit 1
      ;;
  esac
}

IFS=',' read -r -a COMPONENT_TOKENS <<< "${COMPONENTS_RAW}"
for token in "${COMPONENT_TOKENS[@]}"; do
  trimmed="$(echo "${token}" | tr -d '[:space:]' | tr '[:upper:]' '[:lower:]')"
  [[ -z "${trimmed}" ]] && continue
  normalized="$(normalize_component "${trimmed}")"
  if [[ "${ENABLED[$normalized]}" -eq 0 ]]; then
    ENABLED["${normalized}"]=1
    NORMALIZED_COMPONENTS+=("${normalized}")
  fi
done

if [[ "${#NORMALIZED_COMPONENTS[@]}" -eq 0 ]]; then
  echo "No components enabled. Set ORGOPS_COMPONENTS to at least one component." >&2
  exit 1
fi

echo "Starting OrgOps components: ${NORMALIZED_COMPONENTS[*]}"

PIDS=()
NAMES=()

start_process() {
  local name="$1"
  shift
  echo "Launching ${name}: $*"
  "$@" &
  local pid=$!
  PIDS+=("${pid}")
  NAMES+=("${name}")
}

wait_for_local_api() {
  local attempts=120
  local sleep_seconds=0.5
  local url="http://127.0.0.1:${API_INTERNAL_PORT}/health"
  for _ in $(seq 1 "${attempts}"); do
    if curl -fsS "${url}" >/dev/null 2>&1; then
      return 0
    fi
    sleep "${sleep_seconds}"
  done
  echo "API did not become ready at ${url}." >&2
  return 1
}

build_haproxy_config() {
  local config_path="/tmp/orgops-haproxy.cfg"
  local default_backend=""
  if [[ "${ENABLED["user-ui"]}" -eq 1 ]]; then
    default_backend="user_ui_backend"
  elif [[ "${ENABLED["admin-ui"]}" -eq 1 ]]; then
    default_backend="admin_ui_backend"
  elif [[ "${ENABLED["api"]}" -eq 1 ]]; then
    default_backend="api_backend"
  else
    default_backend="blackhole_backend"
  fi

  cat > "${config_path}" <<EOF
global
  log stdout format raw local0

defaults
  mode http
  log global
  option httplog
  option forwardfor
  timeout connect 5s
  timeout client 60s
  timeout server 60s
  timeout tunnel 1h

frontend orgops_frontend
  bind *:${PROXY_PORT}
  acl is_health path -i /health
  acl is_api path_beg /api
  acl is_ws path_beg /ws
  acl is_admin path_beg /admin
EOF

  if [[ "${ENABLED["api"]}" -eq 1 ]]; then
    cat >> "${config_path}" <<EOF
  use_backend api_backend if is_health || is_api || is_ws
EOF
  fi

  if [[ "${ENABLED["admin-ui"]}" -eq 1 ]]; then
    cat >> "${config_path}" <<EOF
  use_backend admin_ui_backend if is_admin
EOF
  fi

  cat >> "${config_path}" <<EOF
  default_backend ${default_backend}
EOF

  if [[ "${ENABLED["api"]}" -eq 1 ]]; then
    cat >> "${config_path}" <<EOF

backend api_backend
  option httpchk
  http-check send meth GET uri /health ver HTTP/1.1 hdr Host localhost
  http-check expect status 200
  server api 127.0.0.1:${API_INTERNAL_PORT} check
EOF
  fi

  if [[ "${ENABLED["admin-ui"]}" -eq 1 ]]; then
    cat >> "${config_path}" <<EOF

backend admin_ui_backend
  server admin_ui 127.0.0.1:${ADMIN_UI_PORT} check
EOF
  fi

  if [[ "${ENABLED["user-ui"]}" -eq 1 ]]; then
    cat >> "${config_path}" <<EOF

backend user_ui_backend
  server user_ui 127.0.0.1:${USER_UI_PORT} check
EOF
  fi

  cat >> "${config_path}" <<EOF

backend blackhole_backend
  http-request return status 503 content-type text/plain lf-string "No HTTP component is enabled."
EOF
}

shutdown_all() {
  local signal="${1:-TERM}"
  if [[ "${#PIDS[@]}" -eq 0 ]]; then
    return 0
  fi
  for pid in "${PIDS[@]}"; do
    kill "-${signal}" "${pid}" >/dev/null 2>&1 || true
  done
}

on_signal() {
  local signal="$1"
  echo "Received ${signal}, stopping processes..."
  shutdown_all TERM
}

trap 'on_signal SIGTERM' SIGTERM
trap 'on_signal SIGINT' SIGINT

if [[ "${ENABLED["api"]}" -eq 1 ]]; then
  start_process "api" env PORT="${API_INTERNAL_PORT}" node --import tsx apps/api/src/server.ts
fi

if [[ "${ENABLED["runner"]}" -eq 1 ]]; then
  if [[ "${ENABLED["api"]}" -eq 1 ]]; then
    RUNNER_API_URL="${ORGOPS_API_URL:-http://127.0.0.1:${API_INTERNAL_PORT}}"
    wait_for_local_api
    start_process "runner" env ORGOPS_API_URL="${RUNNER_API_URL}" node --import tsx apps/agent-runner/src/index.ts
  else
    if [[ -z "${ORGOPS_API_URL:-}" ]]; then
      echo "Runner is enabled without API. Set ORGOPS_API_URL to a reachable API endpoint." >&2
    fi
    start_process "runner" node --import tsx apps/agent-runner/src/index.ts
  fi
fi

if [[ "${ENABLED["admin-ui"]}" -eq 1 ]]; then
  start_process "admin-ui" env VITE_UI_BASE_PATH="/admin/" npm run --workspace @orgops/admin-ui preview -- --host 0.0.0.0 --port "${ADMIN_UI_PORT}"
fi

if [[ "${ENABLED["user-ui"]}" -eq 1 ]]; then
  start_process "user-ui" env VITE_UI_BASE_PATH="/" npm run --workspace @orgops/user-ui preview -- --host 0.0.0.0 --port "${USER_UI_PORT}"
fi

if [[ "${ENABLED["api"]}" -eq 1 || "${ENABLED["admin-ui"]}" -eq 1 || "${ENABLED["user-ui"]}" -eq 1 ]]; then
  build_haproxy_config
  start_process "haproxy" haproxy -W -db -f /tmp/orgops-haproxy.cfg
fi

if [[ "${#PIDS[@]}" -eq 0 ]]; then
  echo "No processes were started." >&2
  exit 1
fi

while true; do
  if ! wait -n "${PIDS[@]}"; then
    status=$?
    echo "One process exited with status ${status}, stopping remaining processes..."
    shutdown_all TERM
    wait || true
    exit "${status}"
  fi
done
