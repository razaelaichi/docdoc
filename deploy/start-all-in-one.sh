#!/bin/bash
# One container, three processes: nginx (serves the app, proxies /api), the API and the worker.
# For hosts that run a single service (e.g. Render). If any process stops, the container stops too,
# so the host restarts it instead of leaving a half-working app running.
set -uo pipefail

APP_DIR="${APP_DIR:-/app/server}"
TEMPLATE="${NGINX_TEMPLATE:-/etc/nginx/templates/default.conf.template}"
SITE_CONF="${NGINX_SITE_CONF:-/etc/nginx/conf.d/default.conf}"

# nginx listens where the host routes traffic (Render sets PORT); the API stays on an internal port,
# and in this container it is always local, whatever API_UPSTREAM the host environment holds.
export NGINX_PORT="${PORT:-${NGINX_PORT:-80}}"
API_PORT="${API_PORT:-4000}"
export API_UPSTREAM="http://127.0.0.1:${API_PORT}"
envsubst '${API_UPSTREAM} ${NGINX_PORT}' < "$TEMPLATE" > "$SITE_CONF"

cd "$APP_DIR"
PORT="$API_PORT" node src/index.js &
api=$!
node src/worker.js &
worker=$!
# shellcheck disable=SC2086 -- NGINX_ARGS is for local testing only
nginx -g 'daemon off;' ${NGINX_ARGS:-} &
web=$!

stop() {
  kill -TERM "$api" "$worker" "$web" 2>/dev/null
  wait
  exit "${1:-0}"
}
trap 'stop 0' TERM INT

# supervise: all three must stay up. The job table is checked (not `kill -0`, which still
# sees a crashed process as alive until it is reaped); portable, no bash-5-only `wait -n`.
alive() {
  local running
  running=$(jobs -rp)
  for pid in "$api" "$worker" "$web"; do
    grep -qx "$pid" <<<"$running" || return 1
  done
}
while alive; do
  sleep 2 &
  wait $!
done
echo "start-all-in-one: a process exited, stopping the container" >&2
stop 1
