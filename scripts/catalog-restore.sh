#!/usr/bin/env bash
# Restore the cached global tool catalog (apps + nodes) into this worktree's Postgres so a fresh
# DB has the Composio catalog without re-running the slow sync. Auto-run by `bun run db:setup`.
#
# The decision is made on Composio rows, because the add-source picker needs them:
#   - the database already has Composio apps           -> skip (use --force to reload)
#   - a usable snapshot (has every recipe's Composio row) -> restore it
#   - no usable snapshot, COMPOSIO_API_KEY set          -> run catalog:apply local, then cache it
#   - no usable snapshot, COMPOSIO_API_KEY missing      -> restore a partial snapshot if there is
#                                                          one, and print one loud warning line
# Rows of other providers never count: a catalog with only those is treated as missing Composio.
# Workspace-scoped catalog rows (catalog_scope = 'workspace') are never touched.
#
# The reload (DELETE + both COPYs) runs in ONE transaction, so a mid-load failure rolls back
# and leaves the existing catalog untouched — never wiped or half-loaded.
set -euo pipefail

root="$(git rev-parse --show-toplevel)"
cd "$root"

cache_dir="${COWORKER_CATALOG_CACHE_DIR:-${XDG_CACHE_HOME:-$HOME/.cache}/coworker/catalog}"
force=0
[ "${1:-}" = "--force" ] && force=1
missing_composio_warning="WARNING: The app catalog is missing Composio apps on this server (no usable snapshot and no COMPOSIO_API_KEY). The add-source dialog falls back to native apps and marks the rest unavailable. Set COMPOSIO_API_KEY and run 'bun run catalog:apply local' (or 'bun run db:setup'), then check with 'bun run catalog:doctor'."

read_composio_key_present() {
  bun run --silent dotenvx run -f .env.keys -f .env.local -f .env.development -- node -e 'console.log(process.env.COMPOSIO_API_KEY ? "yes" : "no")' 2>/dev/null | tail -n1 || echo no
}

list_recipe_toolkit_slugs() {
  bun --no-env-file -e "import { list_composio_recipes } from '@coworker/connectors'; for (const recipe of list_composio_recipes()) console.log(recipe.toolkit_slug.toLowerCase())"
}

list_snapshot_composio_slugs() {
  gunzip -c "$cache_dir/apps.csv.gz" \
    | grep -E 'provider""?: ?""?composio' \
    | grep -oE 'provider_app_slug""?: ?""?[A-Za-z0-9_-]+' \
    | sed -E 's/.*[" ]//' | tr '[:upper:]' '[:lower:]' | sort -u || true
}

snapshot_state() {
  if [ ! -f "$cache_dir/apps.csv.gz" ] || [ ! -f "$cache_dir/nodes.csv.gz" ]; then
    echo absent
    return
  fi
  if ! snapshot_matches_schema; then
    echo schema_mismatch
    return
  fi
  local snapshot_slugs missing_slugs
  snapshot_slugs="$(list_snapshot_composio_slugs)"
  if [ -z "$snapshot_slugs" ]; then
    echo no_composio
    return
  fi
  missing_slugs="$(comm -23 <(list_recipe_toolkit_slugs | sort -u) <(echo "$snapshot_slugs"))"
  if [ -n "$missing_slugs" ]; then
    echo "older than the recipe set (missing: $(echo "$missing_slugs" | tr '\n' ' '))" >&2
    echo stale
    return
  fi
  echo usable
}

build_catalog_from_composio() {
  echo "Running 'catalog:apply local' to build the Composio catalog (COMPOSIO_API_KEY is set)…"
  bash scripts/catalog.sh apply local
  bash scripts/catalog-dump.sh
}

compose_exec() { docker compose --env-file .env.local exec -T postgres "$@"; }
psql() { compose_exec psql -U coworker -d coworker "$@"; }

if ! psql -tAc 'select 1' >/dev/null 2>&1; then
  echo "Postgres is not reachable. Run 'bun run db:start' first." >&2
  exit 1
fi

count_composio_apps() {
  local count
  count="$(psql -tAc "select count(*) from apps where catalog_scope = 'global' and metadata->'sourced_from'->>'provider' = 'composio'" 2>/dev/null | tr -d '[:space:]')"
  case "$count" in
    '' | *[!0-9]*)
      echo "Could not read catalog state (got '${count:-empty}'). Is Postgres healthy?" >&2
      exit 1
      ;;
  esac
  echo "$count"
}

snapshot_header() {
  gunzip -c "$1" | sed -n '1p'
}
database_header() {
  psql -tAc "select string_agg(column_name, ',' order by ordinal_position) from information_schema.columns where table_schema = 'public' and table_name = '$1'" 2>/dev/null | tr -d '[:space:]'
}

snapshot_matches_schema() {
  local table snapshot_columns database_columns
  for table in apps nodes; do
    snapshot_columns="$(snapshot_header "$cache_dir/$table.csv.gz")"
    database_columns="$(database_header "$table")"
    if [ -z "$snapshot_columns" ] || [ "$snapshot_columns" != "$database_columns" ]; then
      echo "Catalog snapshot schema for $table does not match this database." >&2
      return 1
    fi
  done
}

composio_existing="$(count_composio_apps)"
if [ "$composio_existing" != "0" ] && [ "$force" != "1" ]; then
  echo "Global catalog already has $composio_existing Composio apps — skipping restore (pass --force to reload)."
  exit 0
fi

state="$(snapshot_state)"
if [ "$state" != "usable" ]; then
  echo "Catalog snapshot at $cache_dir is not usable ($state)."
  if [ "$(read_composio_key_present)" = "yes" ]; then
    build_catalog_from_composio
    exit 0
  fi
  if [ "$state" != "stale" ]; then
    echo "$missing_composio_warning"
    exit 0
  fi
  echo "$missing_composio_warning"
  echo "Restoring the stale snapshot anyway, so the apps it has are available."
fi

echo "Restoring global catalog from $cache_dir (force=$force, existing Composio apps=$composio_existing)…"

# Stage the decompressed CSVs inside the container so a single transactional psql session can
# \copy them from disk (two `from stdin` copies can't share one session). Cleaned up on exit.
stage="/tmp/coworker-catalog-restore.$$"
cleanup() { compose_exec sh -c "rm -rf '$stage'" >/dev/null 2>&1 || true; }
trap cleanup EXIT

compose_exec sh -c "mkdir -p '$stage'"
gunzip -c "$cache_dir/apps.csv.gz" | compose_exec sh -c "cat > '$stage/apps.csv'"
gunzip -c "$cache_dir/nodes.csv.gz" | compose_exec sh -c "cat > '$stage/nodes.csv'"

# --single-transaction + ON_ERROR_STOP: all four statements commit together or not at all.
psql --single-transaction -v ON_ERROR_STOP=1 \
  -c "delete from nodes where catalog_scope = 'global'" \
  -c "delete from apps where catalog_scope = 'global'" \
  -c "\copy apps from '$stage/apps.csv' with (format csv, header true)" \
  -c "\copy nodes from '$stage/nodes.csv' with (format csv, header true)"

apps_now="$(psql -tAc "select count(*) from apps where catalog_scope = 'global'" 2>/dev/null | tr -d '[:space:]')"
nodes_now="$(psql -tAc "select count(*) from nodes where catalog_scope = 'global'" 2>/dev/null | tr -d '[:space:]')"
composio_now="$(count_composio_apps)"
echo "✓ Catalog restored: apps=$apps_now nodes=$nodes_now composio_apps=$composio_now"
if [ "$composio_now" = "0" ]; then echo "$missing_composio_warning"; fi
