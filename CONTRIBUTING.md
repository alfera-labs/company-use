# Contributing

Thanks for helping.

## Run your change

You need [Bun](https://bun.sh) 1.4.2, Node 24, and Docker. [`.nvmrc`](.nvmrc) pins the Node
version, and `package.json` pins Bun through `packageManager`.

The installer builds the two images from your clone and starts the whole stack:

```bash
git clone https://github.com/alfera-labs/company-use.git
cd company-use
./deploy/install.sh        # asks for one model key
./deploy/alfera doctor     # checks every part
```

After a change, build and start again:

```bash
cd deploy
docker compose build api && docker compose build app
docker compose up -d
```

[SELF_HOSTING.md](SELF_HOSTING.md) describes the stack.

## Checks

Run these before you open a pull request. They need no env file and no secret:

```bash
bun install --frozen-lockfile
bun x biome check .
bun x turbo typecheck
bun --no-env-file node_modules/vitest/vitest.mjs run path/to/file.test.ts
```

The last line runs one test file. Leave the path out to run every test. Most tests use an
embedded database, so they need no running service.

## Code rules

Reviewers apply these rules.

- Write plain names in `snake_case`. Name the operation: `create_`, `set_`, `delete_`. Do not
  use hedge words such as `ensure_`, `_safely`, or a bare `handle_`.
- Keep a function under 50 lines and a file on one concept.
- Import through the `@` aliases in `tsconfig.base.json`. Do not use `./` or `../` between
  source files.
- Add a record to a registry instead of a branch to a function.
- A route or a tool calls a domain service. It does not call database query helpers directly.
- Do not add explanatory comments under `apps/` or `packages/`. A good name explains the code.
- Test the real requirement. Do not mock our own modules or the database. Mock only a
  third-party boundary.

## Repository map

One Bun workspace. TypeScript everywhere.

| Path | What it holds |
| --- | --- |
| `apps/api` | The HTTP API. |
| `apps/app` | The dashboard. |
| `apps/worker` | The queue worker. It runs every job: agent runs and automations. |
| `packages/core` | The Postgres schema, the queries, and the shared domain services. |
| `packages/runtime-platform` | The agent runtime: orchestrator, tools, skills, channels, and sandboxes. |
| `packages/agent-core` | The model loop: provider calls, streaming, and tool execution. |
| `packages/jobs` | The job queue: events, jobs, claims, and retries. |
| `packages/connectors` | The connector framework and the native connector apps. |
| `packages/ui` | The shared React components and the theme. |
| `packages/config`, `packages/shared` | Environment schemas, model proxy records, and shared types. |
| `deploy` | The self-host stack: the installer, the helper, the compose file, and the env template. |

## Where to add things

Each extension point is a registry.

| To add | Edit |
| --- | --- |
| A tool | `packages/runtime-platform/src/tools/tool_registry.ts` |
| A skill | `packages/runtime-platform/src/skills/skill_registry.ts`, with the text in `skills/library/` |
| A channel (Slack, email, ...) | `packages/runtime-platform/src/channels/channel_ingress_adapters.ts` |
| A connector | `packages/connectors/src/registry.ts` |
| A model proxy | `packages/shared/src/model_proxies.json` |
| A job | `packages/runtime-platform/src/events/event_job_handler_registry.ts` |

## The license of your contribution

This repository is under the GNU Affero General Public License, version 3, and your
contribution is published under the same license.

Before a pull request is merged, you sign the Alfera contributor agreement. It lets Alfera
Labs license your contribution under other terms as well. You keep the copyright of what you
wrote. The agreement is not published yet, so open an issue before you start a large change.

## Commits

- One logical change per commit.
- Write the subject in the imperative: `add the linear connector`, not `added` or `adding`.
- Keep the subject under 72 characters. Explain why in the body when the diff does not show
  the reason.
- Do not mix a rename or a format pass with a behavior change.

## Pull requests

- Say what changed and why, in plain sentences.
- List the checks you ran and their result. Name anything you did not run.
- State known limitations instead of hiding them.
- Keep the diff scoped to the change.
- Add a test when the behavior is risky: a parser, a policy gate, a permission check, a
  failure path.

## Security

Do not open a public issue for a vulnerability. Read [SECURITY.md](SECURITY.md).
