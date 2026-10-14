#!/usr/bin/env bash
# Boot a git worktree from zero to running.
# Runs the standard setup steps in order — install deps, generate this worktree's
# .env.local (+ .env.keys), start Postgres and run migrations + catalog restore —
# then hands off to the long-running dev server.
#
# Stops at the first failed setup step with a clear message. Each setup step is
# idempotent, so re-running after a fix is safe.
set -euo pipefail

root="$(git rev-parse --show-toplevel)"
cd "$root"

worktree="$(basename "$root")"

# Select the Node version this repo wants (.nvmrc -> 24, matching package.json
# "engines"). Next, vite, tsc, and drizzle-kit still run on Node, so we switch BEFORE any
# step runs. nvm is a shell
# function, not a binary, so we have to source it; if it (or the pinned Node) is
# missing we print the exact fix instead of silently continuing on the wrong Node.
select_node_version() {
  echo ""
  echo "▶ Selecting Node version (.nvmrc)"

  local nvm_sh="${NVM_DIR:-$HOME/.nvm}/nvm.sh"
  if [ ! -s "$nvm_sh" ]; then
    echo "  ⚠ nvm not found — skipping auto-switch."
    echo "    This repo needs Node $(cat .nvmrc) (package.json engines: >=24 <27)."
    echo "    Install nvm and the pinned Node, then re-run 'bun run boot':"
    echo "      brew install nvm   # then follow its shell-setup notes"
    echo "      nvm install        # reads .nvmrc"
    echo "    (or use any manager / system install that puts Node >=24 <27 on PATH.)"
    return
  fi

  # shellcheck disable=SC1090
  \. "$nvm_sh"
  if ! nvm use >/dev/null 2>&1; then
    echo "  ⚠ Node $(cat .nvmrc) is not installed under nvm. Installing it:"
    echo "    \$ nvm install"
    if ! nvm install >/dev/null 2>&1; then
      echo "  ✗ 'nvm install' failed. Run it manually, then re-run 'bun run boot'." >&2
      exit 1
    fi
    nvm use >/dev/null 2>&1 || true
  fi
  echo "  ✓ Using $(node --version)"
}

select_node_version

# Declarative step list: each step is a label + the command that runs it.
# Add a step by adding a row; nothing else changes.
run_step() {
  local label="$1"
  shift
  echo ""
  echo "▶ ${label}"
  echo "  \$ $*"
  if ! "$@"; then
    echo ""
    echo "✗ Step failed: ${label}" >&2
    echo "  Fix the error above, then re-run 'bun run boot' (every step is idempotent)." >&2
    exit 1
  fi
}

echo "Bootstrapping worktree '${worktree}'…"

run_step "Install dependencies"        bun install
run_step "Set up this worktree's env"  bun run setup:worktree
run_step "Start Postgres + migrate"    bun run db:setup

echo ""
echo "✓ Worktree '${worktree}' is set up. Starting the dev server…"
echo "  api :3001 / app :3000  (Ctrl-C to stop; marketing is opt-in on :3002)"
echo "  For friendly per-worktree URLs instead: 'bun run dev:proxy' once, then 'bun run dev:portless'."
echo ""

# Hand the terminal to the long-running dev server. `exec` replaces this script
# so Ctrl-C goes straight to dev and no wrapper process lingers.
exec bun run dev
