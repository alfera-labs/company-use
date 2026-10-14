#!/usr/bin/env bash
# Start this worktree's Postgres using the same DB_PORT that DATABASE_URL uses.
# Raw `docker compose up` does not read .env.local; this script does.
#
# A container can be healthy while the host port DATABASE_URL points at is dead.
# If anything owns DB_PORT for the moment the container starts, the container
# runtime fails to publish the port, keeps the container running, and never
# retries. Every host process then gets ECONNREFUSED even though the container
# reports healthy. So readiness here means "the host can open DB_PORT", and a
# lost publish is repaired by recreating the container.
set -euo pipefail

root="$(git rev-parse --show-toplevel)"
cd "$root"

if [ ! -f .env.local ]; then
  bash scripts/setup-worktree.sh
fi

db_port="$(grep -E '^DB_PORT=' .env.local | tail -1 | cut -d= -f2- | tr -d '"'\''[:space:]')"
if [ -z "$db_port" ]; then
  echo "DB_PORT is missing from .env.local. Run 'bun run setup:worktree'." >&2
  exit 1
fi

compose() {
  docker compose --env-file .env.local "$@"
}

container_is_up() {
  local status
  status="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$1")"
  [ "$status" = "healthy" ] || [ "$status" = "running" ]
}

host_port_is_open() {
  (exec 3<>"/dev/tcp/127.0.0.1/${db_port}") 2>/dev/null
}

wait_for() {
  local seconds="$1"; shift
  for _ in $(seq 1 "$seconds"); do
    if "$@"; then
      return 0
    fi
    sleep 1
  done
  return 1
}

start_container() {
  compose up -d "$@" postgres
  container_id="$(compose ps -q postgres)"
  if [ -z "$container_id" ]; then
    echo "Postgres container did not start." >&2
    exit 1
  fi
  if ! wait_for 30 container_is_up "$container_id"; then
    compose ps postgres
    echo "Postgres did not become ready in time." >&2
    exit 1
  fi
}

start_container
if wait_for 10 host_port_is_open; then
  echo "✓ Postgres is ready for this worktree on port ${db_port}."
  exit 0
fi

# The container is healthy but its published port never reached the host.
# Recreating the container publishes it again.
echo "Port ${db_port} is closed on the host; recreating the container to publish it again."
start_container --force-recreate
if wait_for 10 host_port_is_open; then
  echo "✓ Postgres is ready for this worktree on port ${db_port}."
  exit 0
fi

compose ps postgres
echo "Postgres is running but port ${db_port} stays closed on the host." >&2
echo "Another process on this machine owns ${db_port}. Free it, or delete .env.local" >&2
echo "and run 'bun run setup:worktree' to pick a different port." >&2
exit 1
