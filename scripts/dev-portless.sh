#!/usr/bin/env bash
# Run this worktree's app and API dev servers behind the portless proxy: friendly,
# stable https://<worktree>.app.localhost / .api.localhost URLs with local HTTPS and
# no port juggling across worktrees.
#
# portless serves each process on its own auto-assigned port and routes by hostname.
# marketing and app are now separate hosts; the app's /api proxy and the API's CORS
# need to know each OTHER's URL, and the app still needs the marketing URL for links.
# We resolve them up front with `portless get` (deterministic per worktree, derived
# without anything running) and export them.
# dotenvx leaves already-set env vars untouched, so these win over the localhost
# values in .env.local.
#
# One-time per machine: `bun run dev:proxy` (starts + trusts the proxy). After that the
# app/API auto-register. To bypass portless entirely: `PORTLESS=0 bun run dev`.
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

if ! command -v portless >/dev/null 2>&1; then
  echo "portless not found. Run 'bun run dev:proxy' once to install + trust it." >&2
  exit 1
fi

# Each process registers as `portless run --name app|api ...`, which in a git
# worktree prepends the branch (e.g. rebuild-web.app.localhost). `portless get`
# derives the same URL with nothing running, so we resolve them up front and wire
# them in.
marketing_url="$(portless get marketing)"
app_url="$(portless get app)"
api_url="$(portless get api)"
workos_redirect_url="$app_url/auth/callback"

# The browser hits each app's own origin; the app proxies /api/* server-side to the API.
# turbo passes these through (globalPassThroughEnv); dotenvx leaves already-set vars untouched,
# so they win over .env.local's localhost values.
export API_URL="$api_url"
export NEXT_PUBLIC_API_URL="$api_url"
export NEXT_PUBLIC_MARKETING_URL="$marketing_url"
export NEXT_PUBLIC_APP_URL="$app_url"
export NEXT_PUBLIC_WORKOS_REDIRECT_URI="$workos_redirect_url"
# The marketing CTA hint cookie is the only cross-subdomain cookie, and Domain=.localhost is
# rejected by browsers, so it stays host-only here. Session cookies are host-only everywhere.
export AUTH_HINT_COOKIE_DOMAIN=""
export ALLOWED_ORIGINS="$marketing_url,$app_url"

echo "▶ app → $app_url"
echo "▶ api → $api_url  (app proxies /api/* here)"
echo "▶ auth callback → $workos_redirect_url"
echo "▶ marketing link → $marketing_url  (not started by default)"
echo

# Run app + API dev:portless in parallel. Each calls `portless run --name ...`,
# which injects an auto-assigned PORT and registers its worktree-prefixed URL with the proxy.
exec turbo dev:portless --filter @coworker/app --filter @coworker/api
