#!/usr/bin/env bash
# Start, stop, and inspect this worktree's dev servers WITHOUT holding a terminal open.
#
# Why this exists
#
#   `bun run dev` runs in the foreground forever. Anything that launches it and keeps the handle
#   — an agent's background task, a detached subshell, a CI step — is still "running" hours
#   later with nothing to report, and killing the wrapper is not enough: the real tree is
#   dotenvx -> turbo -> vite, and a `pkill -f "vite dev"` matches only the leaf.
#   The supervisors survive, keep the port, and the next start finds the port taken.
#   Do that five times and you have five zombie stacks.
#
#   So: `start` launches the tree in its own process group, waits until it actually answers,
#   prints the URL, and EXITS. The pid file records the process groups the script started.
#   `stop` and `start` kill only those groups, so a server someone else started survives.
#
#   Jobs run on the queue worker (apps/worker, part of `bun run dev`) through a local Rivet
#   Engine. When RIVET_ENDPOINT is local, `start` starts that engine first, in its own process
#   group, on this worktree's RIVET_ENGINE_PORT with private storage under .cache/rivet-engine.
#   With a cloud endpoint it starts no engine. Either way it waits for the worker to register.
#   `stop` stops the dev tree, then the engine. With RIVET_WORKER=compute (`bun run worker:cloud`)
#   the worker runs on Rivet Compute: the tree is only the app and the API, and nothing waits for a
#   local worker.
#
# Usage
#
#   scripts/dev-server.sh start [port]   # idempotent; reuses a healthy server
#   scripts/dev-server.sh stop
#   scripts/dev-server.sh restart [port]
#   scripts/dev-server.sh status [port]
#   scripts/dev-server.sh logs [lines]
#   scripts/dev-server.sh dev            # the foreground tree itself (`bun run dev`)
#
# Wired up as `bun run dev:start`, `bun run dev:stop`, `bun run dev:status`, `bun run dev:logs`.
set -uo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repository_root"

pid_file="$repository_root/.dev-server.pid"
log_file="$repository_root/.dev-server.log"
engine_pid_file="$repository_root/.rivet-engine.pid"
engine_log_file="$repository_root/.rivet-engine.log"
engine_storage="$repository_root/.cache/rivet-engine"
# 3000 and 3003 are the ports registered with WorkOS, so sign-in only works on those.
default_port=3003
readiness_timeout_seconds=120

app_port="${2:-$default_port}"

health_url() { echo "http://localhost:$1/design-system"; }

is_port_answering() {
  local status
  status="$(curl -s -o /dev/null -w '%{http_code}' -m 5 "$(health_url "$1")" 2>/dev/null)"
  [ "$status" != "000" ]
}

list_owned_group_ids() {
  [ -f "$pid_file" ] || return 0
  ps -A -o pid=,ppid=,pgid= | awk -v recorded="$(tr '\n' ' ' < "$pid_file")" '
    BEGIN {
      split(recorded, groups, " ")
      for (i in groups) if (groups[i] ~ /^[0-9]+$/ && groups[i] + 0 > 1) owned_group[groups[i]] = 1
    }
    { parent[$1] = $2; group[$1] = $3 }
    END {
      do {
        changed = 0
        for (pid in parent) {
          if (pid in owned) continue
          if ((group[pid] in owned_group) || (parent[pid] in owned)) {
            owned[pid] = 1; owned_group[group[pid]] = 1; changed = 1
          }
        }
      } while (changed)
      for (pid in owned) live_group[group[pid]] = 1
      for (id in live_group) print id
    }'
}

record_owned_groups() {
  local owned_groups
  owned_groups="$(list_owned_group_ids)"
  [ -n "$owned_groups" ] && echo "$owned_groups" > "$pid_file"
}

list_port_listener_pids() { lsof -nP -tiTCP:"$app_port" -sTCP:LISTEN 2>/dev/null; }

is_in_worktree() {
  local cwd
  cwd="$(lsof -a -p "$1" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p')"
  [ "$cwd" = "$repository_root" ] || [[ "$cwd" == "$repository_root"/* ]]
}

stop_dev_tree() {
  local owned_groups
  owned_groups="$(list_owned_group_ids | tr '\n' ' ')"
  rm -f "$pid_file"
  if [ -z "${owned_groups// /}" ]; then
    echo "nothing this script started is running"
    return 0
  fi
  for group_id in $owned_groups; do kill -TERM -- "-$group_id" 2>/dev/null; done
  sleep 2
  for group_id in $owned_groups; do kill -KILL -- "-$group_id" 2>/dev/null; done
  echo "stopped the dev server this script started (process groups: $owned_groups)"
}

clear_hung_port_listener() {
  for pid in $(list_port_listener_pids); do
    if is_in_worktree "$pid"; then
      echo "port $app_port is held by hung process $pid from this worktree; stopping it"
      kill -KILL "$pid" 2>/dev/null
    fi
  done
}


# --- Local Rivet Engine -----------------------------------------------------------------------
# The engine binary lives under this worktree's node_modules, so its path identifies it.

read_env_local() {
  grep -E "^$1=" "$repository_root/.env.local" 2>/dev/null | tail -1 | cut -d= -f2-
}

engine_port() { read_env_local RIVET_ENGINE_PORT; }
engine_url() { echo "http://127.0.0.1:$(engine_port)"; }

find_worktree_engine_pids() {
  ps -eo pid,command | grep -F "$repository_root" | grep "rivet-engine start" | grep -v grep \
    | awk '{print $1}'
}

# Upserting the pool's `normal` runner config is also the health check: it answers only once the
# engine serves its API. A self-hosted engine refuses a runner until its pool has this config.
upsert_engine_runner_config() {
  curl -s -f -o /dev/null -m 3 -X PUT \
    -H "authorization: Bearer $(read_env_local RIVET_TOKEN)" \
    -H 'content-type: application/json' \
    -d '{"datacenters":{"default":{"normal":{}}}}' \
    "$(engine_url)/runner-configs/default?namespace=default"
}

resolve_engine_binary() {
  (cd "$repository_root/apps/worker" && bun --no-env-file -e \
    "const { createRequire } = require('node:module'); console.log(createRequire(require.resolve('rivetkit'))('@rivetkit/engine-cli').getEnginePath())")
}

start_rivet_engine() {
  local port token binary
  port="$(engine_port)"
  token="$(read_env_local RIVET_TOKEN)"
  if [ -z "$port" ] || [ -z "$token" ]; then
    echo "RIVET_ENGINE_PORT or RIVET_TOKEN is missing from .env.local. Run: bun run setup:worktree" >&2
    return 1
  fi
  if upsert_engine_runner_config; then
    echo "rivet engine already running: $(engine_url)"
    return 0
  fi
  if [ -n "$(find_worktree_engine_pids)" ]; then stop_rivet_engine >/dev/null; fi
  binary="$(resolve_engine_binary)" || { echo "could not find the rivet-engine binary; run bun install" >&2; return 1; }

  mkdir -p "$engine_storage"
  : > "$engine_log_file"
  set -m
  RIVET__GUARD__HOST=127.0.0.1 RIVET__GUARD__PORT="$port" \
    RIVET__API_PEER__HOST=127.0.0.1 RIVET__API_PEER__PORT="$((port + 1))" \
    RIVET__METRICS__HOST=127.0.0.1 RIVET__METRICS__PORT="$((port + 10))" \
    RIVET__FILE_SYSTEM__PATH="$engine_storage/db" RIVET__AUTH__ADMIN_TOKEN="$token" \
    nohup "$binary" start >>"$engine_log_file" 2>&1 &
  local launched_pid=$!
  disown 2>/dev/null
  set +m
  ps -o pgid= -p "$launched_pid" 2>/dev/null | tr -d ' ' > "$engine_pid_file"

  local waited=0
  while [ "$waited" -lt 60 ]; do
    if upsert_engine_runner_config; then
      echo "rivet engine ready: $(engine_url)  (log: $engine_log_file)"
      return 0
    fi
    if ! kill -0 "$launched_pid" 2>/dev/null; then
      echo "rivet engine exited during startup. Last 20 log lines:" >&2
      tail -20 "$engine_log_file" >&2
      return 1
    fi
    sleep 1
    waited=$((waited + 1))
  done
  echo "rivet engine did not answer within 60s. Last 20 log lines:" >&2
  tail -20 "$engine_log_file" >&2
  return 1
}

stop_rivet_engine() {
  local group_id=""
  [ -f "$engine_pid_file" ] && group_id="$(cat "$engine_pid_file" 2>/dev/null)"
  rm -f "$engine_pid_file"
  if [ -z "$group_id" ] || ! kill -0 -- "-$group_id" 2>/dev/null; then
    echo "no rivet engine this script started is running"
    return 0
  fi
  kill -TERM -- "-$group_id" 2>/dev/null
  sleep 2
  kill -KILL -- "-$group_id" 2>/dev/null
  echo "rivet engine stopped"
}

# The worker prints this line once it registered with the engine and created the scheduler.
wait_for_worker() {
  local waited=0
  while [ "$waited" -lt 90 ]; do
    if grep -q "worker ready: registered with Rivet" "$log_file" 2>/dev/null; then
      echo "queue worker ready: registered with $(read_env_local RIVET_ENDPOINT)"
      return 0
    fi
    sleep 2
    waited=$((waited + 2))
  done
  echo "the queue worker did not register within 90s. Worker log lines:" >&2
  grep -E "@coworker/worker" "$log_file" | tail -20 >&2
  return 1
}

# The engine goes last, so the worker never waits on an engine that is already gone.
stop_dev_server() {
  stop_dev_tree
  stop_rivet_engine
}

warn_when_composio_catalog_is_empty() {
  local composio_apps
  composio_apps="$(docker compose --env-file .env.local exec -T postgres psql -U coworker -d coworker -tAc \
    "select count(*) from apps where catalog_scope = 'global' and metadata->'sourced_from'->>'provider' = 'composio'" \
    2>/dev/null | tr -d '[:space:]')"
  if [ "$composio_apps" = "0" ]; then
    echo "WARNING: the app catalog has no Composio apps, so the add-source dialog falls back to native apps. Run: bun run catalog:apply local (check with bun run catalog:doctor)"
  fi
}

start_dev_server() {
  warn_when_composio_catalog_is_empty
  start_local_engine_if_needed || return 1

  if is_port_answering "$app_port"; then
    echo "already running: $(health_url "$app_port")"
    return 0
  fi

  if [ -n "$(list_owned_group_ids)" ]; then
    echo "clearing the stale dev server this script started…"
    stop_dev_tree >/dev/null
  fi
  clear_hung_port_listener

  : > "$log_file"
  # The tree needs its own process group, because that group id is the handle `stop` uses to
  # kill dotenvx, turbo, and vite together instead of chasing the leaf.
  #
  # `set -m` (job control) is what puts a background job in a fresh group. It is the portable
  # way: `setsid` is Linux-only and simply does not exist on macOS, which is where this repo is
  # developed. `nohup` detaches it from the terminal so it survives this script exiting.
  set -m
  APP_PORT="$app_port" nohup bun run dev >>"$log_file" 2>&1 &
  local launched_pid=$!
  disown 2>/dev/null
  set +m

  local group_id
  group_id="$(ps -o pgid= -p "$launched_pid" 2>/dev/null | tr -d ' ')"
  # `$!` always names the launched process, so no group means it already exited.
  if [ -z "$group_id" ]; then
    echo "dev server exited during startup. Last 20 log lines:" >&2
    tail -20 "$log_file" >&2
    return 1
  fi
  echo "$group_id" > "$pid_file"

  local waited=0
  while [ "$waited" -lt "$readiness_timeout_seconds" ]; do
    if is_port_answering "$app_port"; then
      record_owned_groups
      echo "ready: $(health_url "$app_port")  (logs: bun run dev:logs)"
      echo "api:   http://localhost:$(read_env_local API_PORT)"
      if worker_runs_on_compute; then
        echo "queue worker: hosted, pool $(read_env_local RIVET_POOL) (no local worker)"
      else
        wait_for_worker
      fi
      return
    fi
    if ! kill -0 -- "-$group_id" 2>/dev/null; then
      echo "dev server exited during startup. Last 20 log lines:" >&2
      tail -20 "$log_file" >&2
      rm -f "$pid_file"
      return 1
    fi
    # A launch that fails inside the tree (port taken, missing binary, bad env) prints and then
    # sits there as a live supervisor, so process liveness alone never notices. Reading the log
    # turns a 120-second timeout into a two-second answer.
    if grep -qE "error: script .* exited with code|command not found|is in use|EADDRINUSE" "$log_file" 2>/dev/null; then
      echo "dev server reported a startup error. Last 20 log lines:" >&2
      tail -20 "$log_file" >&2
      stop_dev_server >/dev/null
      return 1
    fi
    sleep 2
    waited=$((waited + 2))
  done

  echo "dev server did not answer within ${readiness_timeout_seconds}s. Last 20 log lines:" >&2
  tail -20 "$log_file" >&2
  return 1
}

report_status() {
  local owned_groups listener_pids
  owned_groups="$(list_owned_group_ids | tr '\n' ' ')"
  listener_pids="$(list_port_listener_pids | tr '\n' ' ')"
  echo "port:      $app_port"
  echo "answering: $(is_port_answering "$app_port" && echo yes || echo no)"
  echo "started by this script (process groups): ${owned_groups:-none}"
  echo "listening on the port (pids): ${listener_pids:-none}"
  echo "log:       $log_file"
  if uses_local_engine; then
    echo "engine:    $(engine_url) answering: $(upsert_engine_runner_config && echo yes || echo no)"
    echo "engine processes: $(find_worktree_engine_pids | tr '\n' ' ')"
    report_local_worker_registration
  fi
  # The mode, and in the cloud the namespace, the pool, and whether the worker registered there.
  bun --no-env-file "$repository_root/scripts/rivet_mode.ts" status
}

# The local engine's view: does the worker's pool have an envoy that pinged in the last 30 s? A
# worker can stay alive with no envoy (a dead socket, an eviction); only the engine can tell.
# `rivet_mode.ts status` answers the same question in cloud mode.
report_local_worker_registration() {
  local pool namespace envoys
  pool="$(read_env_local RIVET_POOL)"
  namespace="$(read_env_local RIVET_NAMESPACE)"
  envoys="$(curl -s -f -m 3 -H "authorization: Bearer $(read_env_local RIVET_TOKEN)" \
    "$(read_env_local RIVET_ENDPOINT)/envoys?namespace=${namespace:-default}&name=${pool:-default}")" \
    || { echo "worker:    unknown (the engine did not list its envoys)"; return; }
  echo "$envoys" | bun --no-env-file -e '
    const pool = process.argv[1];
    const { envoys } = JSON.parse(await Bun.stdin.text());
    const live = envoys.filter((e) => e.stop_ts === null && Date.now() - e.last_ping_ts < 30_000);
    const ages = live.map((e) => Math.round((Date.now() - e.last_ping_ts) / 1000));
    console.log(live.length
      ? `worker:    registered (${live.length} envoy in pool ${pool}, last ping ${Math.min(...ages)} s ago)`
      : `worker:    NOT registered (no envoy in pool ${pool} pinged in the last 30 s)`);
  ' "${pool:-default}"
}

# `bun dev` runs the tree in the foreground, but only this script starts the local engine. Start it
# first when the worker is pointed at a local engine; a cloud endpoint needs nothing here.
start_local_engine_if_needed() {
  if uses_local_engine; then start_rivet_engine; fi
}

# The foreground dev tree. The local worker joins it unless the worker runs on Rivet Compute.
run_dev_tree() {
  start_local_engine_if_needed || return 1
  local filters=(--filter @coworker/app --filter @coworker/api)
  if ! worker_runs_on_compute; then filters+=(--filter @coworker/worker); fi
  exec dotenvx run -f .env.keys -f .env.local -f .env.development -- turbo dev "${filters[@]}"
}

worker_runs_on_compute() { [ "$(read_env_local RIVET_WORKER)" = "compute" ]; }

uses_local_engine() {
  case "$(read_env_local RIVET_ENDPOINT)" in
    http://127.0.0.1:* | http://localhost:*) return 0 ;;
    *) return 1 ;;
  esac
}

case "${1:-status}" in
  start) start_dev_server ;;
  engine) start_local_engine_if_needed ;;
  dev) run_dev_tree ;;
  stop) stop_dev_server ;;
  restart) stop_dev_server && start_dev_server ;;
  status) report_status ;;
  logs) tail -"${2:-40}" "$log_file" 2>/dev/null || echo "no log yet" ;;
  *)
    echo "usage: scripts/dev-server.sh {start|stop|restart|status|logs|engine|dev} [port|lines]" >&2
    exit 2
    ;;
esac
