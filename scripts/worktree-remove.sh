#!/usr/bin/env bash
# Remove a git worktree AND tear down its Postgres container + data volume.
#
# Git worktrees and Docker Compose don't know about each other: `git worktree remove`
# deletes the files but leaves the worktree's Postgres container running and its data
# volume on disk forever. Over time those orphans pile up (one per deleted worktree).
# This script removes both together so nothing leaks.
#
# Usage:
#   bun run worktree:remove <worktree-name-or-path>   # remove a sibling worktree
#   bun run worktree:remove                            # remove the CURRENT worktree
#
# Pass --force to skip the confirmation prompt.
set -euo pipefail

root="$(git rev-parse --show-toplevel)"
current_worktree="$(basename "$root")"

force=0
target_arg=""
for arg in "$@"; do
  case "$arg" in
    -f|--force) force=1 ;;
    *) target_arg="$arg" ;;
  esac
done

# Resolve the target worktree path. With no argument, default to the current worktree.
if [ -z "$target_arg" ]; then
  target_path="$root"
elif [ -d "$target_arg" ]; then
  target_path="$(cd "$target_arg" && pwd)"
else
  # Treat a bare name as a sibling of the current worktree directory.
  target_path="$(cd "$(dirname "$root")" && pwd)/$target_arg"
fi

if [ ! -d "$target_path" ]; then
  echo "⚠ No worktree directory found at '$target_path'." >&2
  exit 1
fi

target_name="$(basename "$target_path")"

if [ "$force" -ne 1 ]; then
  printf "Remove worktree '%s' and DELETE its Postgres data volume? [y/N] " "$target_name"
  read -r reply
  case "$reply" in
    y|Y|yes|YES) ;;
    *) echo "Aborted."; exit 0 ;;
  esac
fi

# Tear down the target's Postgres first. The compose project name is the worktree dir
# basename, so running compose from inside the target directory targets exactly its
# container + volume. We must do this BEFORE removing the files, since compose needs
# the docker-compose.yml and .env.local that live in the worktree.
if [ -f "$target_path/.env.local" ]; then
  ( cd "$target_path" && docker compose --env-file .env.local down -v )
  echo "✓ Destroyed Postgres container and data volume for '$target_name'."
else
  echo "• No .env.local in '$target_name' — no Postgres to tear down."
fi

# Removing the worktree you are standing in is not allowed by git; jump to the main
# checkout first so `git worktree remove` can proceed.
if [ "$target_path" = "$root" ]; then
  main_root="$(git worktree list --porcelain | awk '/^worktree /{print $2; exit}')"
  cd "$main_root"
fi

git worktree remove --force "$target_path"
echo "✓ Removed worktree '$target_name'. No orphaned database left behind."
