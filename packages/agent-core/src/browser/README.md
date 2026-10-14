# Browser-agent harness — agent-core module

Gives the agent a real browser it drives through the **stock**
`agent-browser` CLI. The browser runs **inside the session's own E2B sandbox** —
the same one that hosts the coding workspace — so there is no separate browser
sandbox to mint or reconnect. Template + pins: agent-browser +
pinned Chrome are baked into the session template `infra/e2b/nextjs-template.ts`
(`infra/e2b/PINS.md`). Eval suite (the definition of "works"):
`packages/evals/src/browser/` + `packages/evals/tasks/browser/`.

## How the model separation works — the browser is a sub-agent

The main agent does **not** issue individual `snapshot`/`click`/`fill`
commands. It calls **one high-level `browse(task)` tool**. That tool runs a
**nested model loop** (`run_browser_agent`) which issues the low-level
agent-browser commands, reads the a11y snapshots, and returns only the final
result to the main agent. Because that loop calls an injected `turn` bound to a
specific model, the browser can run a **different, browser-tuned model**
(`claude-sonnet-5`) than the main agent — it's a sub-agent sharing the session's
sandbox, not a separate top-level run.

```ts
import {
  create_browser_session,   // attach the browser to the session's SessionEnv (no new sandbox)
  load_browser_skill_prompt,// core skill from the pinned binary + the loop rules
  create_browse_tool,       // the HIGH-LEVEL `browse(task)` tool the MAIN agent gets
  run_browser_agent,        // the sub-agent loop create_browse_tool runs
  create_browser_tool,      // the LOW-LEVEL `browser(command)` tool the sub-agent uses internally
} from '@agent-core/browser';

const session = create_browser_session(session_environment);      // no new sandbox
const system_prompt = await load_browser_skill_prompt(session);
const browse = create_browse_tool({ session, system_prompt, turn });// give `browse` to the main agent
```

- `turn` is the browser model: the caller binds it to `claude-sonnet-5` via the
  LLM gateway (see `evals/src/browser/browser_model_turn.ts`), using `use_case:
  'agent_run'` so the gateway applies **`long` prompt-cache retention** to the
  sub-agent's turns.
- `session.exec(argv[])` — one command, every argument shell-escaped (safe default and the model-facing path).
- `session.exec_raw(shell)` — trusted maintenance escape hatch; runs via `bash -lc` and is not used for model-facing browser commands.
- Reliability lives at the **prompt layer**, not in harness code. The single
  source of truth is `browser_operating_guide.ts` (persistence, verification,
  precision, scraping, forms, security); `browser_skill_prompt.ts` composes it
  with the binary's own `core` skill for the sub-agent, and the
  `operate-the-browser` registry skill (runtime-platform) renders the same
  guide for the main agent.

## Production wiring — done, mode-switchable

The browser is wired into the live run loop: `create_runtime_tool_definitions`
(runtime-platform) calls `create_browser_tool_definitions(db, input)`
(`runtime-platform/src/tools/browser_harness.ts`), which adds the browser
capability to every remote-sandbox run per **`COWORKER_BROWSER_HARNESS_MODE`**:

| Mode | Main agent gets | Driven by | Logged as |
|---|---|---|---|
| `subagent` (default) | high-level `browse(task)` | browser model (`claude-sonnet-5`), its own loop | a **child run** (same session, `parent_run_id`/`root_run_id`), each agent-browser command a `tool_call` on it |
| `direct` | low-level `browser(command)` | the main agent's own model | the main run (one browser tool call per command) |
| `off` | nothing | — | — |

**Sub-agent logging (subagent mode):** on each `browse` call, the harness opens a
child run via `create_run({ parent_run_id, root_run_id, model = browser model })`
(same session — not a new session, not a parentless run), runs `run_browser_agent`
with an observer that writes a `tool_call` per command against the child run,
records the child run's token usage + timing, and finalizes its status. Cost and
status roll up the tree by `root_run_id`. The main run records only the single
`browse` tool call. No schema change — the lineage columns (migration
`0018_run_lineage`) already exist. If `agent_id` is absent the browse still runs,
just unlogged.

**`direct` mode has the skill too.** The low-level `browser` tool's *description*
carries the snapshot→ref→act loop, the command families, and the guide's
precision/obstacle/vision essentials (`build_browser_tool_description` in
`browser_tool.ts`); the full manual arrives when the main agent loads the
`operate-the-browser` registry skill, which the always-on `browser_protocol`
in `context_builder.ts` tells it to do for any web task. For the exhaustive,
version-pinned reference the agent can run `agent-browser commands` /
`skills get core` through the tool. `subagent` mode carries the same guide as
its system prompt.

The harness is also exercised end to end through the eval CLI
(`packages/evals/src/browser/run.ts`), gated on credentials.
