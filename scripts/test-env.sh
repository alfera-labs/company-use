#!/usr/bin/env bash
# Run tests with decrypted local config, but strip dev/runtime secrets that make
# unit tests talk to real providers or require proxy-auth headers.
set -euo pipefail

root="$(git rev-parse --show-toplevel)"
cd "$root"

if [ ! -f .env.local ]; then
  bash scripts/setup-worktree.sh
fi

args=()
for arg in "$@"; do
  # `bun run test -- path/to/file.test.ts` appends a standalone `--`; vitest treats
  # that as an option terminator and stops applying the path filter.
  if [ "$arg" = "--" ]; then
    continue
  fi
  args+=("$arg")
done

if [ "${#args[@]}" -eq 0 ]; then
  args=(vitest run)
fi

# Run vitest on the Bun runtime. `bunx vitest` would start it on Node, so call the entry file.
# --no-env-file stops Bun from loading .env files: dotenvx is the only env authority.
if [ "${args[0]}" = "vitest" ]; then
  args=(bun --no-env-file "$root/node_modules/vitest/vitest.mjs" "${args[@]:1}")
fi

# RIVET_POOL is removed, not blanked: rivetkit reads it itself and would take "" as the pool name.
exec "$root/node_modules/.bin/dotenvx" run -f .env.keys -f .env.local -f .env.development -- env -u RIVET_POOL \
  NODE_ENV=test \
  API_URL=http://localhost:3101 \
  NEXT_PUBLIC_API_URL=http://localhost:3101 \
  API_PUBLIC_URL= \
  COWORKER_API_PROXY_SECRET= \
  EVENT_JOB_DISPATCH_MODE=in_process \
  RIVET_ENDPOINT= \
  RIVET_NAMESPACE= \
  RIVET_TOKEN= \
  RIVET_PUBLIC_ENDPOINT= \
  RIVET_CONNECTION_TOKEN= \
  RIVET_REGION= \
  COWORKER_WORKSPACE_RUNTIME_PROVIDER=local \
  COWORKER_PERSISTENT_WORKSPACES_ENABLED=false \
  COWORKER_WORKSPACE_BASE_PATH= \
  ARCHIL_API_KEY= \
  ARCHIL_REGION= \
  R2_BUCKET_NAME= \
  R2_BUCKET_ENDPOINT= \
  R2_ACCESS_KEY_ID= \
  R2_SECRET_ACCESS_KEY= \
  COWORKER_BROWSER_STATE_ENCRYPTION_KEY= \
  COWORKER_ARCHIL_LIVE_TEST_ENABLED=false \
  OPENAI_API_KEY=test_openai_key \
  VERCEL_AI_GATEWAY_API_KEY= \
  ANTHROPIC_API_KEY= \
  TAVILY_API_KEY= \
  BRAVE_SEARCH_API_KEY= \
  FIRECRAWL_API_KEY= \
  JINA_API_KEY= \
  COMPOSIO_API_KEY= \
  SLACK_CLIENT_ID= \
  SLACK_CLIENT_SECRET= \
  SLACK_SIGNING_SECRET= \
  LOCAL_SLACK_CLIENT_ID= \
  LOCAL_SLACK_CLIENT_SECRET= \
  LOCAL_SLACK_SIGNING_SECRET= \
  GCP_PROJECT_ID= \
  GCP_SCHEDULER_TARGET_BASE_URL= \
  AWS_SCHEDULER_ROLE_ARN= \
  AWS_SCHEDULER_LAMBDA_ARN= \
  AWS_AUTH_ROLE_ARN= \
  GCP_OIDC_AUDIENCE= \
  E2B_API_KEY= \
  COWORKER_MODAL_ENDPOINT_URL= \
  COWORKER_MODAL_AUTH_TOKEN= \
  "${args[@]}"
