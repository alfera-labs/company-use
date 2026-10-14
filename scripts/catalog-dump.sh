#!/usr/bin/env bash
# Dump the global tool catalog (apps + nodes) from this worktree's Postgres into a machine-local
# cache, so any other worktree's fresh DB can restore it instantly instead of re-running the slow
# Composio sync. Pairs with catalog-restore.sh (auto-run by `bun run db:setup`).
#
# The cache is shared across every worktree on this machine:
#   ${COWORKER_CATALOG_CACHE_DIR:-${XDG_CACHE_HOME:-$HOME/.cache}/coworker/catalog}
#
# Snapshots are tied to the current migration schema (the CSV column order must match the table),
# so re-dump after schema changes.
set -euo pipefail

root="$(git rev-parse --show-toplevel)"
cd "$root"

cache_dir="${COWORKER_CATALOG_CACHE_DIR:-${XDG_CACHE_HOME:-$HOME/.cache}/coworker/catalog}"
mkdir -p "$cache_dir"

psql() { docker compose --env-file .env.local exec -T postgres psql -U coworker -d coworker "$@"; }

if ! psql -tAc 'select 1' >/dev/null 2>&1; then
  echo "Postgres is not reachable. Run 'bun run db:start' first." >&2
  exit 1
fi

apps_count="$(psql -tAc "select count(*) from apps where catalog_scope = 'global'" 2>/dev/null | tr -d '[:space:]')"
composio_count="$(psql -tAc "select count(*) from apps where catalog_scope = 'global' and metadata->'sourced_from'->>'provider' = 'composio'" 2>/dev/null | tr -d '[:space:]')"
nodes_count="$(psql -tAc "select count(*) from nodes where catalog_scope = 'global'" 2>/dev/null | tr -d '[:space:]')"

# Guard against non-numeric output (a stray warning on stdout) corrupting the manifest JSON.
case "$apps_count-$nodes_count-$composio_count" in
  *[!0-9-]* | -* | *-)
    echo "Could not read catalog counts (apps='$apps_count' nodes='$nodes_count')." >&2
    exit 1
    ;;
esac

if [ "$apps_count" = "0" ]; then
  echo "Global catalog is empty — nothing to dump. Run 'bun run catalog:apply local --skip-field-choices' first." >&2
  exit 1
fi

echo "Dumping global catalog (apps=$apps_count nodes=$nodes_count) → $cache_dir"

# Stream each table out as gzipped CSV. SELECT * preserves table column order; restore COPYs
# positionally against the same schema. Write to .tmp then move so a crash never leaves a
# half-written snapshot in place.
psql -c "\copy (select * from apps where catalog_scope = 'global' order by app_id) to stdout with (format csv, header true)" \
  | gzip > "$cache_dir/apps.csv.gz.tmp"
mv "$cache_dir/apps.csv.gz.tmp" "$cache_dir/apps.csv.gz"

psql -c "\copy (select * from nodes where catalog_scope = 'global' order by node_id) to stdout with (format csv, header true)" \
  | gzip > "$cache_dir/nodes.csv.gz.tmp"
mv "$cache_dir/nodes.csv.gz.tmp" "$cache_dir/nodes.csv.gz"

# The custom migrate runner records only id/created_at/hash (no migration name), so the schema
# version signal is the applied-migration count + the latest migration hash.
migrations_applied="$(psql -tAc "select count(*) from drizzle.__drizzle_migrations" 2>/dev/null | tr -d '[:space:]' || true)"
migration_hash="$(psql -tAc "select substr(hash, 1, 16) from drizzle.__drizzle_migrations order by created_at desc limit 1" 2>/dev/null | tr -d '[:space:]' || true)"

cat > "$cache_dir/manifest.json" <<EOF
{
  "created_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "apps": $apps_count,
  "composio_apps": $composio_count,
  "nodes": $nodes_count,
  "scope": "global",
  "tables": ["apps", "nodes"],
  "migrations_applied": ${migrations_applied:-0},
  "latest_migration_hash": "${migration_hash:-unknown}"
}
EOF

echo "✓ Catalog snapshot written to $cache_dir:"
ls -lh "$cache_dir/apps.csv.gz" "$cache_dir/nodes.csv.gz" "$cache_dir/manifest.json"
