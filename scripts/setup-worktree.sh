#!/usr/bin/env bash
# Set up THIS git worktree's gitignored .env.local.
# It starts from decrypted .env.development values, applies non-empty LOCAL_* shadow
# values as gitignored local defaults, then applies a small declarative list of
# per-worktree overrides for local ports/URLs/Postgres.
#
# Safe to run anytime: .env.local is regenerated atomically from current inputs.
set -euo pipefail

root="$(git rev-parse --show-toplevel)"
cd "$root"

env_local="$root/.env.local"
worktree="$(basename "$root")"

# dotenvx decrypts the committed, encrypted .env.development / .env.production using a private
# key per env. dotenvx REQUIRES those keys to be named DOTENV_PRIVATE_KEY_DEVELOPMENT /
# DOTENV_PRIVATE_KEY_PRODUCTION (the suffix matches the file). To keep them scoped to THIS
# project (instead of a global shell var that every dotenvx project would inherit), you store
# them ONCE in a project config file under COWORKER_-prefixed names; this script translates them
# into the worktree's gitignored .env.keys with the names dotenvx reads.
keys="$root/.env.keys"
config_keys="${COWORKER_KEYS_FILE:-${XDG_CONFIG_HOME:-$HOME/.config}/coworker/dotenv.keys}"
local_slack_env="${COWORKER_LOCAL_SLACK_FILE:-${XDG_CONFIG_HOME:-$HOME/.config}/coworker/local-slack.env}"
# General machine-local overrides (gitignored, outside the repo). Every non-empty key here is
# copied into each generated .env.local, so per-developer config that must not live in the shared
# encrypted .env.development — ngrok domain/token, slack app-config token, etc. — survives every
# new worktree. Per-worktree ports/URLs still win over it (see local_overrides below).
local_env="${COWORKER_LOCAL_ENV_FILE:-${XDG_CONFIG_HOME:-$HOME/.config}/coworker/local.env}"

print_config_keys_help() {
  echo "  Create it ONCE (fill in your real decryption keys):"
  echo "      mkdir -p \"$(dirname "$config_keys")\" && cat > \"$config_keys\" <<'KEYS'"
  echo "      COWORKER_DOTENV_PRIVATE_KEY_DEVELOPMENT=<dev decryption key>"
  echo "      COWORKER_DOTENV_PRIVATE_KEY_PRODUCTION=<prod decryption key, optional>"
  echo "      KEYS"
  echo "  Then re-run 'bun run setup:worktree'. (This file is your single source of truth.)"
}

ensure_env_keys() {
  if [ -f "$keys" ]; then
    echo "✓ .env.keys already present in this worktree."
    return
  fi
  if [ ! -f "$config_keys" ]; then
    echo "⚠ No project key file at $config_keys — encrypted .env.* won't decrypt here."
    print_config_keys_help
    return
  fi

  # Translate COWORKER_DOTENV_PRIVATE_KEY_* (your scoped names) into the DOTENV_PRIVATE_KEY_*
  # names dotenvx reads, written to this worktree's .env.keys (gitignored).
  local wrote=0 line name value
  : > "$keys"
  chmod 600 "$keys"
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in
      COWORKER_DOTENV_PRIVATE_KEY_*=*)
        name="${line%%=*}"
        value="${line#*=}"
        printf '%s=%s\n' "${name#COWORKER_}" "$value" >> "$keys"
        wrote=$((wrote + 1))
        ;;
    esac
  done < "$config_keys"

  if [ "$wrote" -gt 0 ]; then
    echo "✓ Wrote $wrote key(s) into .env.keys from $config_keys (COWORKER_ prefix stripped for dotenvx)."
  else
    rm -f "$keys"
    echo "⚠ $config_keys has no COWORKER_DOTENV_PRIVATE_KEY_* lines."
    print_config_keys_help
  fi
}

ensure_env_keys

print_dotenvx_status() {
  if [ ! -f "$env_local" ]; then
    return
  fi

  echo "  dotenvx runtime env check (.env.keys + .env.local + encrypted .env.development):"
  bun run dotenvx run -f .env.keys -f .env.local -f .env.development -- node <<'NODE' \
    | sed -E 's/^/    /'
const fs = require('node:fs');

function read_keys(file) {
  return fs.readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.match(/^([A-Za-z_][A-Za-z0-9_]*)=/)?.[1])
    .filter(Boolean)
    .filter((name) => !name.startsWith('DOTENV_'));
}

const keys = read_keys('.env.local');
for (const name of keys) {
  const value = process.env[name];
  console.log(`${name}=${value ? 'set' : 'missing'}`);
}
NODE
}

write_env_local() {
  local tmp raw
  tmp="$(mktemp "$root/.env.local.tmp.XXXXXX")"
  # Capture the generator's stdout to a RAW temp first. bun/dotenvx can emit
  # non-env noise to stdout here (e.g. an "Unsupported engine" WARN on the wrong
  # Node), and that text would otherwise become line 1 of .env.local and break
  # every later `--env-file .env.local` reader (docker compose, etc.). We filter
  # the raw output down to real env lines below before writing the real file.
  raw="$(mktemp "$root/.env.local.raw.XXXXXX")"
  SETUP_ROOT="$root" \
  SETUP_WORKTREE="$worktree" \
  SETUP_MARKETING_PORT="$marketing_port" \
  SETUP_APP_PORT="$app_port" \
  SETUP_API_PORT="$api_port" \
  SETUP_DB_PORT="$db_port" \
  SETUP_RIVET_ENGINE_PORT="$rivet_engine_port" \
  SETUP_RIVET_TOKEN="$rivet_token" \
  SETUP_LOCAL_SLACK_FILE="$local_slack_env" \
  SETUP_LOCAL_ENV_FILE="$local_env" \
  SETUP_ENV_LOCAL="$env_local" \
    bun run dotenvx run -q -f .env.keys -f .env.development -- node > "$raw" <<'NODE'
const fs = require('node:fs');
const path = require('node:path');

const root = process.env.SETUP_ROOT;
const worktree = process.env.SETUP_WORKTREE;
const marketing_port = process.env.SETUP_MARKETING_PORT;
const app_port = process.env.SETUP_APP_PORT;
const api_port = process.env.SETUP_API_PORT;
const db_port = process.env.SETUP_DB_PORT;
const rivet_engine_port = process.env.SETUP_RIVET_ENGINE_PORT;
const rivet_endpoint = `http://127.0.0.1:${rivet_engine_port}`;
const local_slack_file = process.env.SETUP_LOCAL_SLACK_FILE;
const local_env_file = process.env.SETUP_LOCAL_ENV_FILE;
const current_env_local = process.env.SETUP_ENV_LOCAL;
// The lines `bun run worker:local` writes (scripts/rivet_mode.ts).
const rivet_cloud_keys = [
  'EVENT_JOB_DISPATCH_MODE',
  'RIVET_ENDPOINT',
  'RIVET_PUBLIC_ENDPOINT',
  'RIVET_NAMESPACE',
  'RIVET_TOKEN',
  'RIVET_CONNECTION_TOKEN',
  'RIVET_REGION',
  'RIVET_POOL',
];

const local_overrides = {
  MARKETING_PORT: marketing_port,
  API_PORT: api_port,
  APP_PORT: app_port,
  DB_PORT: db_port,
  API_URL: `http://localhost:${api_port}`,
  NEXT_PUBLIC_API_URL: `http://localhost:${api_port}`,
  NEXT_PUBLIC_MARKETING_URL: `http://localhost:${marketing_port}`,
  NEXT_PUBLIC_APP_URL: `http://app.localhost:${app_port}`,
  NEXT_PUBLIC_WORKOS_REDIRECT_URI: `http://app.localhost:${app_port}/auth/callback`,
  // The marketing CTA hint cookie is the only cross-subdomain cookie, and browsers reject
  // `Domain=.localhost` (the localhost TLD must use host-only cookies), so it stays empty in dev.
  // Deployed env files set AUTH_HINT_COOKIE_DOMAIN=.alfera.ai. Session cookies are host-only
  // everywhere — see apps/app/src/lib/auth_cookie_scope.ts.
  AUTH_HINT_COOKIE_DOMAIN: '',
  DATABASE_URL: `postgres://coworker:coworker@localhost:${db_port}/coworker`,
  // Local dev runs jobs on the queue worker (apps/worker) through a Rivet Engine that
  // scripts/dev-server.sh starts on this worktree's own port. No cloud token ever lands here.
  EVENT_JOB_DISPATCH_MODE: 'rivet',
  RIVET_ENGINE_PORT: rivet_engine_port,
  RIVET_ENDPOINT: rivet_endpoint,
  RIVET_PUBLIC_ENDPOINT: rivet_endpoint,
  RIVET_NAMESPACE: 'default',
  RIVET_TOKEN: process.env.SETUP_RIVET_TOKEN,
  // The local engine accepts only its admin token, so the chat's live socket uses it locally. The
  // engine listens on 127.0.0.1 and the token exists only in this worktree. Cloud env files set a
  // browser-safe connection token (ck_) instead.
  RIVET_CONNECTION_TOKEN: process.env.SETUP_RIVET_TOKEN,
  RIVET_REGION: '',
  ALLOWED_ORIGINS: `http://localhost:${marketing_port},http://app.localhost:${app_port},http://localhost:${app_port}`,
};

function read_env_entries(file) {
  return read_env_entries_from_path(path.join(root, file));
}

function read_env_entries_from_path(full_path) {
  if (!fs.existsSync(full_path)) return [];

  return fs.readFileSync(full_path, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/))
    .filter(Boolean)
    .map((match) => [match[1], parse_env_literal(match[2])])
    .filter(([name]) => !name.startsWith('DOTENV_'));
}

function parse_env_literal(raw_value) {
  if (raw_value.startsWith('"') && raw_value.endsWith('"')) {
    try {
      return JSON.parse(raw_value);
    } catch {
      return raw_value.slice(1, -1);
    }
  }

  if (raw_value.startsWith("'") && raw_value.endsWith("'")) {
    return raw_value.slice(1, -1);
  }

  return raw_value;
}

function read_runtime_value(name, fallback) {
  return Object.prototype.hasOwnProperty.call(process.env, name) ? process.env[name] : fallback;
}

function format_env_value(value) {
  const text = String(value ?? '');
  if (text === '') return '';
  if (/^[A-Za-z0-9_./:@%+=,\-]+$/.test(text)) return text;
  return JSON.stringify(text);
}

const values = new Map();

for (const [name, value] of read_env_entries('.env.example')) {
  values.set(name, value);
}

for (const [name, fallback] of read_env_entries('.env.development')) {
  values.set(name, read_runtime_value(name, fallback));
}

apply_local_shadow_values(values);
apply_local_slack_values(values);
apply_local_env_overrides(values);

for (const [name, value] of Object.entries(local_overrides)) {
  values.set(name, value);
}
keep_rivet_cloud_values(values);

console.log(`# Generated by bun run setup:worktree for '${worktree}'.`);
console.log('# Gitignored local runtime env: decrypted .env.development + per-worktree overrides.');
console.log('# Re-run bun run setup:worktree after changing .env.development or switching worktrees.');

for (const [name, value] of values) {
  console.log(`${name}=${format_env_value(value)}`);
}

function apply_local_shadow_values(values) {
  for (const [name, value] of [...values]) {
    if (!name.startsWith('LOCAL_')) continue;

    // Keep an empty sentinel so dotenvx's later .env.development fallback cannot re-inject the
    // encrypted LOCAL_* secret into process.env after .env.local is loaded first.
    values.set(name, '');
    if (value === '') continue;

    const target_name = name.slice('LOCAL_'.length);
    if (!target_name) continue;

    values.set(target_name, value);
  }
}

function apply_local_slack_values(values) {
  if (!local_slack_file) return;

  for (const [name, value] of read_env_entries_from_path(local_slack_file)) {
    if (!name.startsWith('SLACK_')) continue;
    if (value === '') continue;
    values.set(name, value);
  }
}

// A worktree that `bun run worker:local` or `worker:cloud` pointed at Rivet Cloud stays there: its Rivet lines are kept
// as they are, and it has no local engine port. `bun run rivet:local` switches it back.
function keep_rivet_cloud_values(values) {
  const current = new Map(read_env_entries_from_path(current_env_local));
  const endpoint = current.get('RIVET_ENDPOINT') ?? '';
  if (!endpoint || ['127.0.0.1', 'localhost'].includes(read_hostname(endpoint))) return;
  // `bun run worker:cloud` also points the API at the hosted worker's database.
  const kept = current.get('RIVET_WORKER') === 'compute' ? [...rivet_cloud_keys, 'RIVET_WORKER', 'DATABASE_URL', 'BILLING_ENABLED'] : rivet_cloud_keys;
  for (const name of kept) {
    if (current.has(name)) values.set(name, current.get(name));
    else values.delete(name);
  }
  values.delete('RIVET_ENGINE_PORT');
}

function read_hostname(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

function apply_local_env_overrides(values) {
  if (!local_env_file) return;

  // Copy every non-empty key from the general machine-local overrides file. read_env_entries_from_path
  // already drops DOTENV_* keys, so decryption keys can never leak in here. Runs after the slack file
  // so a key set in both wins from local.env; per-worktree local_overrides still apply last.
  for (const [name, value] of read_env_entries_from_path(local_env_file)) {
    if (value === '') continue;
    values.set(name, value);
  }
}
NODE

  # Keep only generator output that is a comment (`# ...`) or a real KEY=value
  # assignment. Anything else (tool warnings, banners) is dropped, so .env.local
  # is always a clean env file regardless of what bun/dotenvx printed.
  grep -E '^[[:space:]]*#|^[A-Za-z_][A-Za-z0-9_]*=' "$raw" > "$tmp"
  rm -f "$raw"

  if ! grep -qE '^DATABASE_URL=' "$tmp"; then
    rm -f "$tmp"
    echo "✗ Generated .env.local is missing DATABASE_URL — refusing to write a broken env file." >&2
    echo "  Check that .env.keys decrypts .env.development (see 'bun run setup:worktree' output above)." >&2
    exit 1
  fi

  mv "$tmp" "$env_local"
  chmod 600 "$env_local"
}

port_is_free() {
  ! lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1
}

# Keep the public app URL stable. WorkOS sandbox redirects are configured for
# app.localhost:3000, so plain local dev should not drift to hash ports.
marketing_port=3002
api_port=3001
app_port=3000

# Postgres is the one port that should vary by worktree: otherwise a different
# workspace's container can silently own 55432 while this worktree writes to the
# wrong database. Start from a deterministic hash, then skip ports already in use.
# A port this worktree already uses is kept: its own running Postgres holds it, so the scan below
# would see it as taken and move DATABASE_URL away from the database.
read_env_local_value() {
  [ -f "$env_local" ] && grep -E "^$1=" "$env_local" | tail -1 | cut -d= -f2-
}
port_is_this_worktrees_postgres() {
  docker ps --filter "name=^${worktree_container}$" --format '{{.Ports}}' 2>/dev/null \
    | grep -qE "[:.]$1->5432/"
}
worktree_container="$(printf '%s' "$worktree" | tr '[:upper:]' '[:lower:]')-postgres-1"
db_port="$(read_env_local_value DB_PORT || true)"
if [ -z "$db_port" ] || ! { port_is_free "$db_port" || port_is_this_worktrees_postgres "$db_port"; }; then
  db_offset=$(( 0x$(printf '%s' "$root" | shasum | cut -c1-4) % 200 ))
  db_port=55432
  for step in $(seq 0 199); do
    candidate=$(( 55432 + ((db_offset + step) % 200) ))
    if port_is_free "$candidate"; then
      db_port=$candidate
      break
    fi
  done
fi

# The local Rivet Engine binds three ports: guard (the endpoint), api-peer (+1), metrics (+10).
# Keep this worktree's port and admin token across regenerations: the engine may be running on it.
rivet_ports_are_free() {
  port_is_free "$1" && port_is_free "$(( $1 + 1 ))" && port_is_free "$(( $1 + 10 ))"
}
rivet_engine_port="$(read_env_local_value RIVET_ENGINE_PORT || true)"
if [ -z "$rivet_engine_port" ]; then
  rivet_offset=$(( 0x$(printf '%s' "$root" | shasum | cut -c5-8) % 100 ))
  rivet_engine_port=27420
  for step in $(seq 0 99); do
    candidate=$(( 27420 + ((rivet_offset + step) % 100) * 20 ))
    if rivet_ports_are_free "$candidate"; then
      rivet_engine_port=$candidate
      break
    fi
  done
fi
rivet_token="$(read_env_local_value RIVET_TOKEN || true)"
case "$rivet_token" in
  local-rivet-*) ;;
  *) rivet_token="local-rivet-$(openssl rand -hex 16)" ;;
esac

if [ -f "$env_local" ]; then
  write_env_local
  echo "✓ Regenerated .env.local for worktree '$worktree' from decrypted .env.development."
  echo "  Expected plain dev ports: marketing=$marketing_port api=$api_port app=$app_port"
  echo "  Local DB port: db=$db_port  Rivet Engine port: $rivet_engine_port"
  print_dotenvx_status
  exit 0
fi

write_env_local

echo "✓ Wrote $env_local for worktree '$worktree' (marketing=$marketing_port api=$api_port app=$app_port db=$db_port)."
# A new worktree runs its worker here, with Rivet Cloud as the engine. Without the credentials file
# (CI, a new machine) it keeps the local engine.
rivet_credentials="${RIVET_CLOUD_CREDENTIALS_FILE:-$HOME/.config/coworker/rivet-cloud.env}"
if [ -f "$rivet_credentials" ] && [ -z "${CI:-}" ]; then
  bun --no-env-file "$root/scripts/rivet_mode.ts" cloud || echo "⚠ Rivet Cloud switch failed; this worktree uses the local engine. Run: bun run worker:local"
fi
echo "  Next: 'bun run db:setup' and 'bun run dev'."
echo "  ('bun run db:setup' auto-restores the cached tool catalog if one exists — see 'bun run db:catalog:dump'.)"
print_dotenvx_status
