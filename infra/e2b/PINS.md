# Browser-agent harness — pinned versions

The browser runs inside the **session's own sandbox** — the same `coworker-workspace`
template that hosts the coding workspace and the document toolchain. There is no
separate browser sandbox. agent-browser has recurring
Chromium-install bugs, so we pin every version and bake the browser into the
session image at build time — never `agent-browser install` at sandbox boot.
Bump deliberately, then re-run `evals/browser` before promoting.

| Component | Pin | Where |
|---|---|---|
| E2B base image | `node:24` | `workspace-template.ts` (`fromNodeImage('24')`) |
| agent-browser CLI | `0.32.3` | `workspace-template.ts` (`agent_browser_version`) |
| Chrome for Testing | `151.0.7922.138`, determined by agent-browser `0.32.3` | resolve + record below after a build |
| Baked browser path | `/opt/coworker/browser` | `baked_browser_home` in `e2b_command.ts` |
| Archil client | `0.8.35-1788453570`, SHA-256 `6a9f5ae80ee8c6b3d3f20a09443981a4889433e3f815acb21716b214390ab05b` | `workspace-template.ts` |
| Session template id | `coworker-workspace` | `build-template.ts`, `COWORKER_E2B_TEMPLATE_ID` |

## Resolve the exact Chrome build

`agent-browser install` downloads the Chrome for Testing build the pinned CLI
version expects, so pinning the CLI pins Chrome. Record the resolved build after
the first build so a regression is visible in a diff (`verify-template.ts` prints
`agent-browser doctor --json`):

- Chrome for Testing build: `151.0.7922.138`

  Pinning the CLI does not pin Chrome exactly: the CLI resolves the Chrome for Testing build it
  expects at install time, so a later rebuild can get a newer Chrome with no pin changing. Re-run
  the browser evals before promoting a rebuild, and read the value out of `verify-template.ts`.

## Bump the Archil client

Archil publishes the current release id at `https://s3.amazonaws.com/archil-client/pkg/latest`
and the artifact at `$BASE_URL/archil_<VERSION>_amd64.deb`. There are no adjacent signature
files, so the SHA-256 in the table is the only integrity check the build has — read it off the
downloaded artifact, never off a release note.

```bash
VERSION=$(curl -fsSL https://s3.amazonaws.com/archil-client/pkg/latest)
curl -fsSL "https://s3.amazonaws.com/archil-client/pkg/archil_${VERSION}_amd64.deb" -o /tmp/archil.deb
shasum -a 256 /tmp/archil.deb
```

The runtime drives this binary by CLI surface, so a bump re-checks the surface before the table
changes. `archil unmount` is amd64-Linux only; run the help output in a container:

```bash
docker run --rm --platform linux/amd64 -v /tmp/archil.deb:/tmp/a.deb node:24 bash -c '
apt-get update -qq && apt-get install -y /tmp/a.deb
archil --version && archil mount --help && archil checkout --help && archil unmount --help'
```

What must still be there — every item is load-bearing in `orchestrator/e2b_volume.ts` and
`orchestrator/e2b_volume_teardown.ts`:

- `archil mount <disk> <path> --region <region> --shared`, reading `ARCHIL_MOUNT_TOKEN` from env
- `archil checkout [--force --yes] <path>`, and the literal `outstanding delegation` conflict text
  that `archil_checkout` matches on to decide between retry and reclaim
- `archil checkin <path>` and `archil unmount <path>`

## Build & verify

```bash
# Build the session template (E2B_API_KEY required)
bun run e2b:build-template

# Verify the document toolchain AND that agent-browser is baked in and ready
bun run e2b:verify-template
```

Both entry points import `@runtime-platform/orchestrator/e2b_command`, and `infra/e2b` has no
tsconfig of its own. Bun resolves that alias from the root `tsconfig.json`, which extends
`tsconfig.base.json`. Use the package scripts, with `E2B_API_KEY` set to the key of your account.

**The build is the promotion.** `build-template.ts` writes the `coworker-workspace` alias. An
install that sets `COWORKER_E2B_TEMPLATE_ID=coworker-workspace` has no separate flip: running
sessions keep the sandbox they started on, and the next session boots whatever this build
produced. Build to a throwaway name first if you want a look before that.

The runtime reaches the template through:

```bash
COWORKER_WORKSPACE_RUNTIME_PROVIDER=e2b
COWORKER_E2B_TEMPLATE_ID=coworker-workspace
```
