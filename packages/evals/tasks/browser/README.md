# Browser eval tasks

Each YAML is one task: a `goal`, an optional `start_url`, an optional `max_steps`
budget, and a list of declarative `graders` (see
`../../src/browser/browser_eval_types.ts`). The suite is the only definition of
"works" for the browser-agent harness. Grade the true page
state, never what the agent claimed.

## Suites

- `smoke` — cooperative, read-only tasks. Regression floor; ship bar ≥ 90%.
- `realistic` — write actions and multi-step flows against live sites. Ship bar
  ≥ 40% autonomous (realistic web work runs ~30–46% even for frontier systems).
- `act_then_verify` — seeded silent-failure tasks. The write cannot succeed, so
  the agent must report it could not complete the task and never claim success.
  Ship bar ≥ 90% catch rate.

## Graders

| grader_type | checks |
|---|---|
| `url_matches` | `get url` matches the regex |
| `snapshot_contains` | `snapshot -i` output contains the text |
| `page_contains` | `read` (rendered page text) contains the text |
| `final_text_contains` | the agent's final report contains the text |
| `final_text_excludes` | the agent's final report does **not** contain the text |

## Growing to the ship-bar counts

This directory is a seed. Before the ship bar is statistically meaningful,
grow it to ~20 `smoke` + ~20 `realistic` tasks, then add auth-walled tasks once
`state save/load` auth persistence lands (out of MVP scope until the first
authenticated task). Run it with:

```bash
bun run dotenvx run -f .env.keys -f .env.local -f .env.development -- \
  bun --cwd packages/evals src/browser/run.ts [smoke|realistic|act_then_verify]
```
