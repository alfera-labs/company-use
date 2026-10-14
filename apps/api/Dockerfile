# syntax=docker/dockerfile:1
# API image. Build context = repo ROOT:
#   docker build -f apps/api/Dockerfile -t <image> .
#
# deploy/docker-compose.yml starts four services from this one image: the migration job, the
# Rivet Engine, the API, and the queue worker (apps/worker). The container reads its
# configuration from its environment (the compose file passes it with env_file).
#
# The image runs bundles, not the source: `bun build` puts each program, the workspace code and
# the packages it imports in a few files. The build stage holds the install and the source. The
# last stage holds only what runs: the bundles, the few packages a bundle still reads from disk,
# and the files a program reads from disk.
#
# The slim image has no Node. Its `node` command is a Bun fallback.

# The Docker CLI, for COWORKER_WORKSPACE_RUNTIME_PROVIDER=docker. That provider starts one
# sibling container per agent session by shelling out to `docker`, through the host socket a
# self-host deploy mounts (deploy/docker-compose.yml). The e2b provider never calls it. Only
# the client goes in — no daemon, no privileged mode.
# The checksums pin docker-28.5.2.tgz per architecture, so a swapped upstream tarball fails
# the build instead of shipping. Recompute both with sha256sum when the version changes.
FROM oven/bun:1.4.2-slim AS docker_cli
ARG TARGETARCH
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl \
  && case "${TARGETARCH:-amd64}" in \
       amd64) docker_arch=x86_64; docker_sha256=ea90cfd12e1eeb12aa1c971741adb8bd4ed88e2a574eaac13f5029a1dbc6300d ;; \
       arm64) docker_arch=aarch64; docker_sha256=9e4f82996ab790724094475ebed33a736434bfe5d45231b676fef22ffb80044d ;; \
       *) echo "no pinned Docker CLI for TARGETARCH=${TARGETARCH}" >&2; exit 1 ;; \
     esac \
  && curl -fsSL "https://download.docker.com/linux/static/stable/${docker_arch}/docker-28.5.2.tgz" \
    -o /tmp/docker.tgz \
  && echo "${docker_sha256}  /tmp/docker.tgz" | sha256sum -c - \
  && tar -xzf /tmp/docker.tgz -C /tmp docker/docker

FROM oven/bun:1.4.2-slim AS build
WORKDIR /repo

# The manifests first, so a code-only change reuses the install layer.
COPY --parents package.json bun.lock bunfig.toml apps/*/package.json packages/*/package.json ./
# Production packages of the API and the worker only. Hoisted: every package sits in
# /repo/node_modules, so the few files a bundle still reads at run time (native modules, pino's
# worker, grpc protos) resolve from each bundle folder.
RUN --mount=type=cache,id=bun-api,target=/root/.bun/install/cache \
    bun install --frozen-lockfile --production --linker hoisted --filter @coworker/worker --filter @coworker/api
COPY . .
# quickjs finds its wasm next to the file that loads it, which is now a bundle chunk.
# The copy script puts the packages the bundles read from disk in /repo/run_time_node_modules.
# rivetkit's native module comes in a glibc build and a musl build, and this image is glibc.
RUN (cd apps/api && bun build --target=bun --splitting --outdir=dist src/instrument.ts src/server.ts) \
    && (cd apps/worker && bun run bundle) \
    && bun build --target=bun --splitting --outdir=scripts/dist \
         scripts/migrate.ts scripts/seed-native-catalog.ts scripts/seed-library.ts scripts/sync-composio-catalog.ts \
    && for bundle in apps/api/dist apps/worker/dist; do \
         cp node_modules/@jitl/quickjs-wasmfile-release-asyncify/dist/emscripten-module.wasm "$bundle/" || exit 1; \
       done \
    && bun --no-env-file scripts/copy_run_time_packages.ts node_modules run_time_node_modules \
         apps/api/dist apps/worker/dist scripts/dist \
    && rm -rf run_time_node_modules/@rivetkit/rivetkit-napi-linux-*-musl

FROM oven/bun:1.4.2-slim
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/*
COPY --from=docker_cli /tmp/docker/docker /usr/local/bin/docker

# A named volume takes the owner of the folder it is first mounted on, so both state folders
# must exist and belong to the runtime user before any volume is mounted.
RUN mkdir -p /repo /var/lib/rivet-engine /var/lib/coworker/files \
    && chown bun:bun /repo /var/lib/rivet-engine /var/lib/coworker/files

COPY --from=build --chown=bun:bun /repo/run_time_node_modules /repo/node_modules
COPY --from=build --chown=bun:bun /repo/apps/api/dist /repo/apps/api/dist
COPY --from=build --chown=bun:bun /repo/apps/worker/dist /repo/apps/worker/dist
# The script bundles sit in /repo/scripts, where the source files sit in a clone, so the two
# folders they read are at the same relative paths: scripts/migrate.js reads the SQL files and
# the journal, scripts/seed-library.js reads the template library.
COPY --from=build --chown=bun:bun /repo/scripts/dist /repo/scripts
COPY --from=build --chown=bun:bun /repo/packages/core/src/db/migrations /repo/packages/core/src/db/migrations
COPY --from=build --chown=bun:bun /repo/packages/core/src/templates/library /repo/packages/core/src/templates/library

# The Rivet Engine binary ships inside a dependency of `rivetkit`. Link it onto PATH, so the
# engine service in deploy/docker-compose.yml starts it by name.
RUN cd /repo && ln -s "$(bun --no-env-file -e "console.log(require('@rivetkit/engine-cli').getEnginePath())")" /usr/local/bin/rivet-engine

ENV NODE_ENV=production
# server.js reads PORT and binds 0.0.0.0. A platform that injects its own PORT overrides this.
ENV PORT=3001
EXPOSE 3001

# Run from apps/api, so the relative paths below match the worker's in deploy/docker-compose.yml.
WORKDIR /repo/apps/api
USER bun

# Exec form, so bun is PID 1 and SIGTERM reaches the API process during a stop.
# --no-env-file: the container environment is the only env authority; Bun must not load .env
# files by itself. Bun has no working heap limit, so the container memory limit is the only cap.
CMD ["bun", "--no-env-file", "--preload", "./dist/instrument.js", "dist/server.js"]
