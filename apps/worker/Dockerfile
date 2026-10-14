# syntax=docker/dockerfile:1
# Queue worker image. Build context = repo ROOT:
#   docker build -f apps/worker/Dockerfile -t <image> .
#
# The image runs a bundle, not the source: `bun build` puts the worker and the API code it imports
# in a few files, so a cold boot does not load thousands of TypeScript modules one by one.
#
# This image has no Docker CLI, so it fits a worker that runs agent sandboxes on a remote provider
# (COWORKER_WORKSPACE_RUNTIME_PROVIDER=e2b). deploy/docker-compose.yml runs its worker from the
# API image instead, because the docker provider needs that CLI.
FROM oven/bun:1.4.2-slim AS build
WORKDIR /repo

# The manifests first, so a code-only change reuses the install layer.
COPY --parents package.json bun.lock bunfig.toml apps/*/package.json packages/*/package.json ./
# Hoisted: every package sits in /repo/node_modules, so the few files the bundle still reads at
# run time (pino's worker, grpc protos, wasm files) resolve from apps/worker/dist too.
RUN --mount=type=cache,id=bun-worker,target=/root/.bun/install/cache \
    bun install --frozen-lockfile --production --linker hoisted --filter @coworker/worker --filter @coworker/api
COPY . .
# The musl builds are dead weight on this glibc image. engine-cli is the local engine binary: the
# worker never spawns it (rivetkit logs one warning at boot). quickjs finds its wasm next to the
# file that loads it, which is now a bundle chunk.
RUN cd apps/worker && bun run bundle \
    && cp /repo/node_modules/@jitl/quickjs-wasmfile-release-asyncify/dist/emscripten-module.wasm dist/ \
    && find /repo/node_modules -maxdepth 2 -type d \( -name '*-musl' -o -name 'engine-cli*' \) -prune -exec rm -rf {} +

FROM oven/bun:1.4.2-slim
COPY --from=build /repo/node_modules /repo/node_modules
COPY --from=build /repo/apps/worker/dist /repo/apps/worker/dist

# The worker reads its configuration from the container environment. It needs
# EVENT_JOB_DISPATCH_MODE=rivet, RIVET_ENDPOINT and DATABASE_URL to start.
# RIVETKIT_RUNTIME_MODE=serverless: the worker serves Rivet on PORT and answers only requests that
# carry WORKER_SERVERLESS_SECRET in the x-alfera-worker-secret header. Without it, the worker
# connects out to the engine as a runner.
ENV NODE_ENV=production
WORKDIR /repo/apps/worker
USER bun

# The first line of every boot prints the Rivet env (no *TOKEN* variable, URLs without their
# credentials). `exec` makes bun PID 1 so SIGTERM reaches the worker, which drains its actors.
# --no-env-file: the container environment is the only env authority.
CMD ["/bin/sh", "-c", "echo \"rivet env: $(env | grep -E '^(RIVET|PORT)' | grep -v TOKEN | sed -E 's#//[^@/]*@#//<credentials>@#; s#[?].*##' | sort | tr '\\n' ' ')\"; exec bun --no-env-file --preload ./dist/instrument.js dist/server.js"]
