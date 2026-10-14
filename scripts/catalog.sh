#!/usr/bin/env bash
# The tool catalog admin commands, one entry point for every environment. The API never writes
# catalog rows; these four commands do.
#
#   bun run catalog:seed local                      # the native catalogs shipped in code
#   bun run catalog:inventory dev                   # read-only provider usage table
#   bun run catalog:plan prod                       # the Composio plan, writes nothing
#   bun run catalog:plan prod --toolkit gmail       # the plan for one toolkit
#   bun run catalog:apply prod                       # apply the plan you just read
#
# A dev or prod run prints the database it targets (user, host and name, never the password) before
# it does anything, so the wrong environment is caught by reading one line.
set -euo pipefail

root="$(git rev-parse --show-toplevel)"
cd "$root"

usage() {
  cat >&2 <<'TEXT'
Usage: scripts/catalog.sh <seed|inventory|check-recipes|doctor|plan|apply> <local|dev|prod> [extra flags]

  seed       write the native runtime app, native tools, and connector apps (seed-native-catalog.ts)
  inventory  print which provider apps production uses (inventory-app-providers.ts), read-only
  check-recipes  check every sync recipe node key against the catalog (check-composio-recipes.ts), read-only
  doctor     print catalog counts by provider and the source provider each recipe gets, read-only
  plan       print the Composio catalog plan (sync-composio-catalog.ts), writes nothing
  apply      apply that plan (sync-composio-catalog.ts --confirm)

Extra flags reach the script unchanged: --toolkit <slug>,
--max-toolkits <n>, --concurrency <n>, --db-concurrency <n>, --with-triggers.

--concurrency bounds the provider reads (toolkit details, default 12) and --db-concurrency the
toolkit write transactions (default 6, keep it under DATABASE_POOL_MAX). --delay is still
accepted and does nothing: the client retries with backoff instead of pacing every call.
TEXT
  exit 64
}

command_name="${1:-}"
environment="${2:-}"
if [ -z "$command_name" ] || [ -z "$environment" ]; then usage; fi
shift 2

# `bun run catalog:apply local -- --toolkit gmail` appends a standalone `--`. Everything after it is
# for the script, so only the terminator itself is dropped.
extra_flags=()
for arg in "$@"; do
  if [ "$arg" = "--" ]; then continue; fi
  extra_flags+=("$arg")
done

case "$environment" in
  local) env_files=(-f .env.keys -f .env.local -f .env.development) ;;
  dev) env_files=(-f .env.keys -f .env.development) ;;
  prod) env_files=(-f .env.keys -f .env.production) ;;
  *)
    echo "Unknown environment '$environment'." >&2
    usage
    ;;
esac

case "$command_name" in
  seed) catalog_script=(scripts/seed-native-catalog.ts) ;;
  inventory) catalog_script=(scripts/inventory-app-providers.ts) ;;
  check-recipes) catalog_script=(scripts/check-composio-recipes.ts) ;;
  doctor) catalog_script=(scripts/catalog-doctor.ts) ;;
  plan)
    for flag in ${extra_flags[@]+"${extra_flags[@]}"}; do
      if [ "$flag" = "--confirm" ]; then
        echo "plan never writes. Read the plan, then run: bun run catalog:apply $environment" >&2
        exit 64
      fi
    done
    catalog_script=(scripts/sync-composio-catalog.ts)
    ;;
  apply) catalog_script=(scripts/sync-composio-catalog.ts --confirm) ;;
  *)
    echo "Unknown command '$command_name'." >&2
    usage
    ;;
esac

if [ "$environment" != "local" ]; then
  printf 'Target database (%s): ' "$environment"
  bun run --silent dotenvx run "${env_files[@]}" -- \
    node -e 'const u = new URL(process.env.DATABASE_URL); console.log(`${u.username}@${u.hostname}/${u.pathname.slice(1)}`)'
fi

exec bun run dotenvx run "${env_files[@]}" -- \
  bun --no-env-file "${catalog_script[@]}" ${extra_flags[@]+"${extra_flags[@]}"}
