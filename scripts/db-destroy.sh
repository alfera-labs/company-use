#!/usr/bin/env bash
# Destroy THIS worktree's Postgres: stop the container AND delete its data volume.
# Use when you are done with a worktree's database. This is the mirror of db-start.sh.
#
# `db:stop` keeps the volume (fast restart). `db:destroy` removes it (reclaims disk).
# Raw `docker compose down -v` does not read .env.local; this script does.
set -euo pipefail

root="$(git rev-parse --show-toplevel)"
cd "$root"
worktree="$(basename "$root")"

if [ ! -f .env.local ]; then
  echo "⚠ No .env.local in '$worktree' — nothing for compose to target. Skipping." >&2
  exit 0
fi

docker compose --env-file .env.local down -v
echo "✓ Destroyed Postgres container and data volume for worktree '$worktree'."
