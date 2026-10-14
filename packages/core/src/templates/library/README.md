# The library

One folder per listing. Each is a real Agent Skills folder — `SKILL.md` plus an `alfera.json`
sidecar — and it is published into `templates` by `bun run seed:library`.

Nothing here is a page with nothing behind it: if a listing exists, its folder exists, and
installing it writes rows into `tasks` or `skills`.

## Adding one

Write eight fields and four bullets. Nothing else.

- `SKILL.md` frontmatter: `name` (must equal the directory name) and `description`. Optionally
  `license`, `compatibility`, `metadata`, `allowed-tools`. **Only these six keys are part of the
  standard.** A `triggers:` list is tolerated and read as invocation phrases for discovery — it is
  not a start condition.
- `SKILL.md` body: the instructions, in plain English, under about 5k tokens.
- `alfera.json`: `outcome_text`, `summary_text`, `icon`, `listing_state`, `facets`,
  `what_it_does`, `it_will_be_able_to`, `requires`, and `starts_when`.

**`starts_when` never goes in the frontmatter.** An unknown top-level frontmatter key is a hard
error on claude.ai upload and in the Skills API, so a folder carrying one stops being a valid
Agent Skill. That is the whole reason the sidecar exists.

A folder with a non-empty `starts_when` publishes as a **task**; one without publishes as a
**skill**. There is no other structural difference between them.

Everything else on the listing — the kind, the slug, the requirements, the install questions, the
file tree, the blast radius — is derived at publish. Do not author it twice.

## What must not be here

No credentials, of any shape, in any file. Publish scans the whole tree and fails closed.
