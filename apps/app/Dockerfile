# syntax=docker/dockerfile:1
# Dashboard image. Build context = repo ROOT:
#   docker build -f apps/app/Dockerfile -t <image> .
#
# Two stages. The build stage installs the dashboard's packages and runs `vite build`. The last
# stage holds only what that build wrote: apps/app/.output, a server that carries its own traced
# packages and the static files next to it.
#
# `vite build` runs Nitro, which picks its target from the environment. No platform variable is
# set here, so the build writes a plain Node server to apps/app/.output.
#
# Node runs the built server; Bun installs and builds, the same version local dev pins.
FROM node:24-slim AS build
RUN npm install --global bun@1.4.2
WORKDIR /repo

# The manifests first, so a code-only change reuses the install layer.
COPY --parents package.json bun.lock bunfig.toml apps/*/package.json packages/*/package.json ./
RUN --mount=type=cache,id=bun-app,target=/root/.bun/install/cache \
    bun install --frozen-lockfile --filter @coworker/app
COPY . .

ARG NEXT_PUBLIC_ENVIRONMENT=production
ENV NEXT_PUBLIC_ENVIRONMENT=$NEXT_PUBLIC_ENVIRONMENT
RUN NODE_ENV=production bun run --filter @coworker/app build

FROM node:24-slim
ENV NODE_ENV=production
ENV NODE_COMPILE_CACHE=/tmp/coworker-node-compile-cache
# Nitro's node-server entry reads PORT and binds every interface when HOST is 0.0.0.0.
ENV HOST=0.0.0.0
ENV PORT=3000
EXPOSE 3000

WORKDIR /repo/apps/app
RUN chown -R node:node /repo
COPY --from=build --chown=node:node /repo/apps/app/.output ./.output
USER node

# Exec form, so node is PID 1 and SIGTERM reaches the server during a compose stop. Compose
# supplies the environment through env_file.
CMD ["node", ".output/server/index.mjs"]
