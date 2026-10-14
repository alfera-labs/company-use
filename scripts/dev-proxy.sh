#!/usr/bin/env bash
# One-time local setup for the portless dev proxy: friendly *.localhost URLs with
# local HTTPS, automatic per-worktree subdomains, and auto-assigned ports (no manual
# port juggling). Safe to re-run. Requires Node 24+.
#
# After this, start a worktree's dev with `bun run dev:portless`; portless serves the web
# app at <worktree>.app.localhost and the API at <worktree>.api.localhost, each on its
# own auto-assigned port, so several worktrees run side by side.
set -euo pipefail

if ! command -v portless >/dev/null 2>&1; then
  echo "Installing portless globally (vercel-labs/portless, needs Node 24+)..."
  bun add -g portless
fi

# Trust the local CA so HTTPS works without browser warnings (needed for secure
# cookies on the app host). Idempotent.
portless trust || true

# Start the HTTPS proxy daemon on :443. Binds a privileged port, so it auto-elevates
# with sudo once (the daemon then survives across worktrees and reboots). Already
# running is fine. If you can't grant sudo, run on an unprivileged port instead:
#   portless proxy start -p 1355   (URLs become https://<name>.localhost:1355)
portless proxy start || true

echo
echo "✓ portless ready. Start this worktree:  bun run dev:portless"
echo "  Open the printed https://<worktree>.app.localhost URL (the app surface)."
echo "  Inspect active routes/ports across worktrees:  portless list"
