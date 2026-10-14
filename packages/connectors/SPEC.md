# Native connectors — the pinned contract

Definitions live in JSON. `node.json` and `app.json` are the source of truth; a TypeScript file
appears only where real code is needed.

Structure (path IS the key; `node_key = {app}-{node}-{version_number}`):

```
packages/connectors/src/
  registry.ts                 ← reads the generated index, validates path↔key, seeds catalog
  load_definition.ts          ← THE trust boundary: raw JSON → typed ConnectorApp / ConnectorNode
  json_schema_validation.ts   ← one ajv instance; compiles every schema at registry load
  value_expression.ts         ← the declarative vocabulary node.json is written in
  connector_definition_schema.ts ← the top-level app.json / node.json JSON Schemas
  relation_families.ts        ← relation name → link family record (mentions/cites/in_container/thread)
  sync_types.ts                ← the recipe types: ConnectorSync, ConnectorSyncObject, ConnectorSyncDimension...
  sync_scope.ts                ← dimension lookup and browse_scope_options for the picker
  catalog_seed.ts              ← the native catalog rows seeded into apps/nodes at setup time
  sync_definition/
    sync_object_schema.ts      ← the sync object JSON Schema (list_node, page, strategy, relationships...)
    sync_extension_schemas.ts  ← text resolver, line, and file_fetch JSON Schemas
    check_sync_objects.ts      ← per-object load-time checks: scoped_by, strategy, value expressions
    check_sync_extensions.ts   ← browse_request, text resolvers, line, relationships, files checks
    check_sync_directory.ts    ← people directory and file_fetch checks
  runtime/
    execute_node.ts           ← THE door: (node_key, input, connection) → typed result
    get_node_schema.ts
    rate_limiter.ts           ← reads app.json limits; per-connection buckets; honors Retry-After
    http_request.ts           ← one fetch wrapper: auth header, retries, JSON Schema ingress
    status_error_code.ts      ← maps an HTTP status / response shape to a typed error code
    fan_out.ts                ← plural-contract helper: provider batch endpoint OR bounded
                                concurrent fan-out under the app's rate limits
  apps/
    slack/
      app.json                ← app_key, auth {kind, urls, scopes}, base_url, rate_limits
      send_messages/
        v1/
          node.json           ← THE definition: node_key slack-send_messages-1
          execute.ts          ← ONLY when the node needs real code
          fixtures.json       ← recorded real responses (redacted secrets)
          node.test.ts        ← fixture-driven; no network in CI
```

## The batch law (non-negotiable)

Every node is PLURAL. Never `get_record`/`create_record` — always `list_records`,
`create_records`, `send_messages`, `update_records`. Inputs take arrays and filters; outputs
return arrays + cursors. When the provider has a real batch endpoint (Salesforce composite,
HubSpot batch APIs), the node maps to it; when it does not (Notion), the runtime's `fan_out`
executes the plural contract as bounded concurrent singles under the app's rate limits. The
CONTRACT is always batch; the transport is an implementation detail inside the node.

## app.json

```json
{
  "app_key": "slack",
  "display_name": "Slack",
  "base_url": "https://slack.com/api",
  "auth": { "kind": "oauth2", "auth_url": "…", "token_url": "…", "scopes": ["chat:write"] },
  "rate_limits": { "rpm": 20, "concurrency": 4, "burst": 5 },
  "hidden": false
}
```

- `auth.kind` is `oauth2` | `api_key` | `none`. An `api_key` app needs no provider app
  registration at all: the customer pastes a key.
- `auth.scopes` is a list of OAuth scope STRINGS. It is written straight into the catalog's
  `required_scopes` column. A permission name a provider only shows in its own UI is not a scope
  — put it in a quirk key.
- Four more `auth` keys carry a provider's OAuth dialect into the product's own OAuth path. The
  catalog seed reads them; nothing else does. All are optional, and the defaults are the spec.
  - `auth.authorization_params`: extra query parameters the authorize URL needs. Notion takes
    `{ "owner": "user" }`; HubSpot takes `{ "optional_scope": "…" }` for a scope a plan may not
    grant.
  - `auth.token_auth_method`: `client_secret_post` (default) or `client_secret_basic`.
  - `auth.token_request_format`: `form` (default) or `json`. Notion's token endpoint parses JSON
    and nothing else.
  - `auth.scope_separator`: `space` (default) or `comma`. Slack uses commas.
  The two environment variables holding the client are named after the app and never declared
  here: `CONNECTOR_{APP_KEY}_CLIENT_ID` and `CONNECTOR_{APP_KEY}_CLIENT_SECRET`.
- The top level and `auth` are both open: extra keys (`quirks`, `notes`, `docs`,
  `rate_limit_notes`, `auth.header`, `auth.value_template`) are preserved, not validated.
- `availability` holds an app back when the code is ready and something outside it is not:
  `{ "status": "held", "reason": "<one sentence a person can read>" }`. `held` is the only
  status, and the block is closed, so a typo fails at load instead of releasing the app.
  A held app is offered nowhere: it is not in the memory source picker, its scope cannot be
  browsed, a source on it does not crawl, its tools are not offered to a run, and no new
  connection to it starts. The reason is the sentence every one of those refusals says.
  Release the app by deleting the key. Gmail and Google Drive are held today, until Google
  approves their scopes.

## node.json

```json
{
  "node_key": "example-echo_items-1",
  "display_name": "Echo Items",
  "description": "…",
  "implementation": "http",
  "input_schema":  { "…": "JSON Schema draft 2020-12, plural: arrays, filters, cursor" },
  "output_schema": { "…": "JSON Schema draft 2020-12, arrays + next_cursor" },
  "http": {
    "method": "POST",
    "path": "/echo",
    "query": { "…": "<value expression>" },
    "body": { "…": "<value expression>" },
    "headers": { "…": "<value expression>" },
    "paginate": {
      "cursor_query_parameter": "cursor",
      "cursor_from_input": { "$": "input.cursor" },
      "limit_query_parameter": "limit",
      "limit_from_input": { "$": "input.limit" }
    },
    "response_format": "json",
    "response_schema": { "…": "JSON Schema, lenient" },
    "to_output": { "…": "<value expression> over { input, response }" }
  },
  "required_scopes": ["…"],
  "atomic": false
}
```

- `implementation` is `http` or `execute`, and it is the CANONICAL key. `http` runs the
  declarative mapping; `execute` runs the folder's own `execute.ts`. Omit it and the loader
  infers `http` when there is an `http` mapping and `execute` otherwise. Declaring both is an
  error — a documentary list of calls belongs in a quirk key such as `requests`.
- The top level is open. Extra keys (`quirks`, `notes`, `requests`) are preserved on the
  registry record and never validated. Inside `http` the schema is CLOSED: an unrecognized key
  there is a typo, not a quirk.
- `path` is a template. `{input.thread_id}` substitutes a dotted scope path and url-encodes it.
- `atomic: true` means the plural contract must not half-succeed: `fan_out` rejects on the first
  failure instead of capturing it.
- Versions are immutable: a breaking change is a new `v{n+1}/` folder.

## The value expression vocabulary

A JS `to_output: (response) => …` cannot live in JSON, so the mapping is data. One evaluator
serves `path`, `query`, `body`, `headers`, `paginate` and `to_output`, so there is one thing to
learn, not six.

A value expression is any JSON. Objects and arrays are walked, so a reference nests anywhere. A
record whose single key starts with `$` is an operator call. There are four:

| expression | meaning |
|---|---|
| `{ "$": "input.cursor" }` | read a dotted path from the scope; a missing step is `undefined` |
| `{ "$map": { "from": <expr>, "to": <expr> } }` | map an array; inside `to`, `item` is the element |
| `{ "$default": [<expr>, <expr>] }` | the first value that is neither `undefined` nor `null` |
| `{ "$literal": <json> }` | stop evaluating; use this JSON verbatim |

The scope is `{ input }` while a request is built, `{ input, response }` while the answer is
mapped, and `{ input, response, item }` inside a `$map`.

```json
"to_output": {
  "items": {
    "$map": {
      "from": { "$": "response.echoed" },
      "to": { "id": { "$": "item.id" }, "text": { "$": "item.value" } }
    }
  },
  "next_cursor": { "$default": [{ "$": "response.next_cursor" }, null] }
}
```

Rules the evaluator enforces:

- An object key whose value comes out `undefined` is dropped, so an optional field stays absent.
- An unknown `$` operator throws. So does a `$` key sharing its record with another key — use
  `$literal` for a JSON object that really has a `$` key.
- `$map` over a value that is not an array throws. The mistake it catches is writing
  `"from": "response.items"`, which is a literal string, instead of `{ "$": "response.items" }`.
- An absent `to_output` means the provider's answer already is the node's output.

Four operators is the whole language on purpose. A node that needs a fifth writes `execute.ts`.

## execute.ts

Written only when a mapping cannot express the work — control flow, per-item recovery, a
document assembled from several calls.

```ts
export const execute = define_connector_execute<MyInput, MyOutput>(async (input, context) => { … });
```

Either a default export or a named `execute` export works. The loader takes whichever is there,
and only when `node.json` says `"implementation": "execute"` (or has no `http`).

`context` is the whole surface: `send_request`, `send_request_for_response`, `fan_out`, `app`,
`connection` (a `connection_id` only), `log`, `signal`. There is no raw token and no global
fetch on it. `send_request` takes a JSON Schema as its `response_schema` and a type parameter
for what that schema means; the schema is what runs, the type is how the node reads the answer.

## Validation

Every schema is compiled by ajv at registry load, so a typo in `node.json` fails the import, not
the first customer's request.

- Input is validated before the network. Anything else is `invalid_input` with no call made.
- The provider response is validated on the way in, leniently: a vendor adding a field must not
  break a node, so `response_schema` leaves `additionalProperties` open.
- Output is validated on the way out.

Strict and lenient are not two validators. They are two schemas: the author writes
`additionalProperties: false` where unknown keys should be refused. That is the point of
JSON-first.

## What the fetch wrapper handles

- `response_format`: `json` (default) or `text` for an endpoint that returns a document, such as
  Google Drive's `files.export`. A text response is validated as a string.
- A 204, or any 2xx with an empty body, is a success that reads as `null`. Declare
  `"response_schema": { "type": "null" }`.
- A query value that is an array becomes a repeated parameter
  (`?labelIds=INBOX&labelIds=UNREAD`), not a comma-joined string.
- A 403 carrying `Retry-After` is rate limiting, not a refused credential: GitHub signals a
  secondary rate limit that way, and telling the person to reconnect a healthy connection is the
  wrong answer. A bare 403 is still a refusal, and still terminal.
- `send_request_for_response` returns `{ body, headers, status }`. `headers` carries only
  `link`, `retry-after` and `etag`, under lowercase names, for the providers that paginate in a
  header.

## Rules

- MCP reuse allowed ONLY if the MCP is generic AND batch-scalable by the law above. A
  get-one/create-one MCP fails the bar — build native REST instead.
- JSON Schema ingress on every provider response (lenient; no generic value readers — the
  value-boundaries lint applies).
- Fixtures are REAL recorded responses, secrets redacted, one file per node version. CI never
  touches the network.
- The module list is generated, not globbed: `bun run connectors:index` writes `src/apps/index.ts`
  and the file is checked in. A test fails when that file and the folders on disk disagree.
- Registry seeds the existing apps/nodes catalog (same pattern as `seed_runtime_tool_catalog`)
  so runtime agents get the tools unchanged. The schemas go in verbatim — there is no conversion
  step to drift.
- Credentials for live tests: read from env (see `.env.connectors.local`, gitignored) — never
  committed, never in fixtures.

## Sync scope: how an app declares "what can be synced" (generic picker contract)

Every syncable app declares, in `app.json`, an open `sync` section:

```json
"sync": {
  "prompt": "Choose which folders to sync",
  "dimensions": [
    {
      "key": "folders",
      "label": "Folders",
      "shape": "tree",                    // "tree" | "flat" | "query"
      "browse_node": "google_drive-list_folders-1",
      "allow_select_all": true
    }
  ]
}
```

- `shape: "tree"` renders an expandable checklist (children fetched lazily via
  the browse node with `parent_id`); `"flat"` renders a checklist page;
  `"query"` renders a text input (Gmail search, SOQL) with `placeholder`.
- `browse_node` is an ORDINARY connector node (plural, batch law applies)
  whose output_schema conforms to the scope-option shape below. The picker is
  a UI over a node — adding a picker to an app = adding one list node + one
  sync declaration. No bespoke UI, no bespoke endpoint.
- `browse_node` is REQUIRED for `tree` and `flat`, and OPTIONAL for `query`:
  the text a person types is the whole scope there, so there may be nothing to
  list. A query dimension that DOES name one previews what the text catches —
  Gmail runs `gmail-list_messages-1` and marks every option `selectable: false`
  — which is a good pattern, not a workaround.
- `option_mapping` is a value expression evaluated once per item, in a scope
  holding only `{ item }`, and it is what lets an EXISTING list node serve as
  a browser. `slack-list_channels-1` already lists what a person picks from;
  the mapping turns each channel into `{ id, label, kind }`. Without a mapping
  the node's own output must already be scope options.
- `browse_input` is a static object merged UNDER the picker's own input, so a
  browse node that requires an argument the picker never sends (a fixed label
  type, a page size) gets it from the declaration. `parent_id`, `query` and
  `cursor` always win over it.
- `search_param` names the browse node input field that takes a text search:
  Gmail's `search` dimension declares `"search_param": "query"`, because
  `gmail-list_messages-1` searches on `query`. It is what makes the typed text
  reach the provider. A dimension that leaves it out CANNOT search: the text
  never reaches the node, and the options the node listed are filtered by label
  (case-insensitive substring) before they are answered. That is not a nicety —
  `slack-list_channels-1` closes its input schema and declares no `query`, so
  sending the text anyway failed the whole call on every keystroke. The name is
  checked at registry load against the browse node's own input schema.
  `search_param` says the node can SEARCH; it does not say the crawler can
  repeat that search. A checklist dimension is a list of ids, so its picker
  stores the ids it matched either way — the button reads "Include all 12
  matches" when the provider searched, and "Include these 12" when only the
  loaded rows were filtered. The text itself is a scope only where the text IS
  the scope: a `query` dimension, whose `scoped_by` sends it straight back to the
  provider (Gmail: `search` → `query`). The crawler enforces that. It reads a
  stored `query` as the scope only for a dimension that declares `search_param`,
  and refuses anything else by name instead of reading a channel called "sup".
- `browse_request` shapes the input for a node that cannot take the picker's
  fields as-is. Google Drive's file list speaks only a `q` string, so no
  spelling of `parent_id` reaches it directly. `browse_request` is a record of
  `param -> value expression`, evaluated in the scope `{ parent_id, query,
  cursor }` — exactly those three roots; any other root fails the load — and
  merged OVER `browse_input`. One rule the four operators cannot express: a
  plain string value is a TEMPLATE over the same scope, for example
  `"'{parent_id}' in parents and trashed = false"`. A template whose
  placeholder has no value evaluates to `undefined`, which lets a `$default`
  chain answer per level: the drill template first, a root literal last. A
  filled value escapes `\` and `'`, because a template is spliced into a
  provider query string. A field that evaluates to nothing is left off the
  node input. Wrap a string in `$literal` to keep it verbatim. When a
  dimension declares `browse_request`, the door sends ONLY `browse_input` plus
  the evaluated fields (plus the `search_param` text, when the dimension
  declares one): the raw `parent_id`, `query` and `cursor` never reach the
  node, because a closed input schema would refuse fields it does not
  declare.

  ```json
  "browse_request": {
    "q": { "$default": [
      "'{parent_id}' in parents and trashed = false",
      { "$literal": "'root' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false" }
    ] }
  }
  ```
- `selection_includes_descendants: true` — tree dimensions only, and only with
  a `browse_node` — declares that picking a container means its WHOLE
  subtree. The engine expands each selected scope before any object walks: a
  breadth-first browse through the same node with `parent_id`, collecting
  rows the browse node marks as a container (`selectable` not false AND
  `has_children` true — a leaf row never carries `has_children`). The walk
  caps at 200 descendants per selected scope and 10 levels deep, and raises a
  visible `subtree_truncated` problem when a cap cuts it short. Each expanded
  scope keeps the selection's own label as a prefixed path (`Education /
  CHEM7`), so `container.path` stays meaningful. Expansion runs again on
  every crawl, because folders move, and cursors key per expanded scope id as
  normal. WITHOUT this flag, a tree picker's "includes everything inside"
  promise is only true when the provider's own list filter is naturally
  recursive. A scope that lists direct children only (Drive's `'{id}' in
  parents`) syncs one level deep, and MUST declare this flag to reach the
  rest.
- The items are read from the browse node's output as `options`, else `items`,
  else the only array in it — which the batch law already guarantees for a
  list node (one array beside `next_cursor`).
- A dimension record is CLOSED, like `http`: the keys above, plus
  `browse_request`, `selection_includes_descendants`, and `note`. An
  unrecognized key there is a typo. A `browse_node` that names no registered
  node fails at registry load, and a malformed `option_mapping` fails when the
  app.json is loaded — not when somebody opens the picker.

```json
"sync": {
  "dimensions": [
    {
      "key": "channels",
      "label": "Channels",
      "shape": "flat",
      "browse_node": "slack-list_channels-1",
      "browse_input": { "limit": 200 },
      "option_mapping": {
        "id": { "$": "item.id" },
        "label": { "$": "item.name" },
        "kind": "channel"
      },
      "allow_select_all": true
    }
  ]
}
```

### The scope-option shape (standard output for browse nodes)

```json
{
  "options": [
    {
      "id": "1AbC…",                    // the external id stored into sync_scope
      "label": "Training Courses",           // required, what the person reads
      "sublabel": 128,                  // optional, small grey text — a STRING or a NUMBER,
                                        // because the four operators cannot format a count:
                                        // { "$": "item.num_members" } goes straight in and
                                        // the picker prints it
      "preview": "CHEM7, Teaching…",    // optional, one-line content hint
      "kind": "folder",                 // optional, drives the icon
      "has_children": true,             // tree shape only
      "selectable": true
    }
  ],
  "next_cursor": null
}
```

Input contract for browse nodes: `{ parent_id?, query?, cursor?, limit? }` —
all optional; a flat browse ignores `parent_id`.

### The stored selection (uniform across every app)

```json
"sync_scope": {
  "dimension": "folders",
  "select_all": false,
  "selected": [{ "id": "1AbC…", "label": "Training Courses" }],
  "query": null
}
```

Labels are snapshotted at pick time so the UI can render the scope without
re-browsing. Crawlers read `selected[].id` (or honor `select_all` / `query`).

Google Drive predates this record and its crawler reads `sync_scope.folder_ids`.
A folder scope is therefore stored with `folder_ids` beside the uniform fields,
written from the same pick, until that crawler reads `selected`.

Reference dimensions per app: google_drive folders (tree) · gmail labels
(flat) + search (query) · slack channels (flat) · notion databases (flat) ·
github repositories (flat) · salesforce/hubspot/attio object types (flat) ·
granola folders (flat).

## Sync objects: how an app declares what a sync pulls

A dimension says what a person may pick. An OBJECT says what the sync then reads, and what one
provider record becomes in memory. Both live in `sync` in app.json, and both are only data: the
engine (`packages/runtime-platform/src/brain/connector_sync.ts`) knows no app names.

```json
"sync": {
  "dimensions": [ … ],
  "objects": {
    "message_day": {
      "label": "Messages",
      "list_node": "slack-list_messages-1",
      "scoped_by": { "channels": "channels[].channel_id" },
      "list_input": { "limit": 200 },
      "page": {
        "cursor_param": "channels[].cursor",
        "items": { "$": "response.channels.0.messages" },
        "next_cursor": { "$": "response.channels.0.next_cursor" },
        "error": { "$": "response.channels.0.error_code" }
      },
      "strategy": "append_log",
      "cursor": { "field": { "$": "item.ts" }, "param": "oldest" },
      "edit_window_days": 14,
      "identity": { "$": "item.ts" },
      "title": { "$": "item.text" },
      "content": { "$": "item.text" },
      "item_kind": "slack_message",
      "metadata": { "channel_name": { "$": "scope.label" }, "author": { "$": "item.author_name" } },
      "container": { "id": { "$": "scope.id" }, "path": { "$": "scope.label" } },
      "bucket": { "by": "day", "of": { "$": "item.ts" } }
    }
  }
}
```

An object record is CLOSED, like `http`: an unrecognized key is a typo and fails the import.

| key | meaning |
|---|---|
| `list_node` | required. An ordinary registered node that lists records. The batch law applies, so it takes arrays; the engine sends one scope at a time. |
| `scoped_by` | required. Dimension key → the input PATH the picked id is written to. `channels[].channel_id` is the first row of the `channels` array, `label_ids[]` is an array holding one value, `object_type` is a plain field. A recipe runs only for the dimension the source actually picked. |
| `list_input` | a static object, merged UNDER everything the engine writes, exactly like a dimension's `browse_input`. It is NOT evaluated, so a provider filter with `$` keys is safe here. |
| `page.items` | required. A value expression over `{ response }` naming the array of records. |
| `page.next_cursor` | the provider's page cursor. Absent or null means the last page. |
| `page.cursor_param` | where that cursor goes back in, as an input path. |
| `page.error` | where a PLURAL node reports the failure of this one scope row. Without it a refused token reads as "no records". |
| `when` | a value expression evaluated per record. A falsy answer SKIPS that record. This is how two objects read ONE list node and each takes only its own records. The four operators cannot say "not", so a node that needs both sides exposes both booleans. |
| `strategy` | `relist_diff` (list everything, the content hash decides what changed), `modified_since` (send the cursor, read only what moved), `append_log` (a log that only grows, plus an edit window). |
| `cursor` | required unless `relist_diff`. `{ field: <expr into the record>, param: <input path>, overlap_minutes?, initial_lookback_days?, max_age_days?, expired_error_contains?, marker_format? }`. `initial_lookback_days` sets how far back a virgin scope's first crawl reaches, so a new source does not page from its newest record through all of history before it has a watermark to resume from. `marker_format` is `epoch_seconds` or `iso_time`: it tells the engine which format to render a computed lookback marker in, matching the provider's own cursor, and the format is kept whenever a marker moves. `max_age_days` is the oldest watermark the provider still accepts: an older stored watermark is dropped and the scope relists in full. A cursor with `max_age_days` stores the time its walk began as the next watermark, not the newest record marker, so a quiet source keeps a watermark the provider accepts and the next walk is incremental again. `expired_error_contains` lists the texts of the provider's "watermark too old" error: when a listing that sent a watermark fails with one of them, the scope relists once without it. |
| `edit_window_days` | `append_log` only. Each sweep re-reads this much of the recent past, because an edited message keeps its original marker. |
| `identity` | required → `external_item_id`. |
| `version_signal` | → `external_revision`. |
| `tombstone` | an expression that is `true` for a record the provider says is deleted. |
| `title`, `content` | required. `content` may instead be `{ "read_node": …, "input": {…}, "text": <expr over { response, item, scope }> }` for a provider whose list answer carries no body. |
| `item_kind` | required. Stored on the item, and the grain the tombstone sweep works at. |
| `metadata` | key → a value expression, evaluated per record in the same `{ item, scope }` scope. The result is written to `brain_items.metadata`. A key whose expression reads nothing is left out. Metadata is NOT hashed: a changed field alone is not a new revision, and it lands on the item with the next one, exactly like `container_path`. |
| `container` | `{ id, path }` → `external_container_id` / `container_path`. |
| `source_url` | the link a person clicks. |
| `relationships` | relation name → an external id, or an array of them, or the closed record `{ scope_day_of: <expr> }`. Written as `provider_native` edges between items of this SOURCE; an id naming nothing in the source is dropped, not stored as unresolved. The edges are written after every object of the crawl has been stored, so a thread may point at a channel day another object produces. `scope_day_of` points the edge at THIS scope's own day bucket, for the UTC day the expression's time names — how a thread links to the channel day it began inside, without the recipe concatenating an id the language cannot build. A key is any relation name matching `^[a-z][a-z0-9_]{1,40}$` (`assignee`, `reporter`, `attendee`, …, not only `mentions`, `cites`, `in_container` and `thread`); `relation_families.ts` maps each relation name to one of the four link families, and an unregistered name that still matches the pattern falls back to the `mentions` family with `registered: false` and surfaces as an `unregistered_relation` load warning. An app may carry its own `relation_records: [{ relation, link_family, inverse_relation, allowed_link_methods }]` on `app.json` to name a relation that is not built in (a CRM's `owns_deal`, say) without it falling back unregistered. A relation name is metadata for ranking and display only — it never widens or narrows who may read the item it points at; access stays governed entirely by scope membership. |
| `files` | a value expression yielding `[{ id, name, mime_type, byte_size, download_url }]`. See "Files a record carries" below. |
| `bucket` | `{ "by": "day", "of": <expr> }` or `{ "by": "key", "key": <expr>, "scoped"?: true }`. Records sharing a bucket become ONE item, content joined oldest first. This is what keeps chat from becoming a million one-line documents. `scoped: true` prefixes the key with the scope id (`{scope_id}:{key}`), for a provider whose key is unique only inside its own scope — a Slack thread timestamp repeats across channels, and items are keyed by `(app_key, external_item_id)` alone. |

A `day` bucket is one scope and one UTC day: id `{scope_id}:{YYYY-MM-DD}`, title `{scope label} —
{day}`. A `key` bucket is named by the record itself: the id IS the key, and the title is the
recipe's own `title` read off the first record of the bucket. `key` is what lets one list node feed
two documents at once — a Slack channel day, and a thread that keeps growing after the day it began
on, which a day bucket would rewrite forever.

A bucket's metadata is the metadata of the records inside it, merged by one dull rule: **last
value wins per key, and two arrays under one key become their union.** Records are merged oldest
first, so "last value wins" reads back the NEWEST record's value. A fact that is neither the newest
value nor a union — a first time, a count of something — is not expressible: a recipe either stamps
the same constant on every record it buckets, or exposes an array and lets the reader count it, and
says which it chose in its `note`. The engine then adds two
keys of its own — `record_count`, how many records were merged, and `participants`, the deduped
names read from every record's `author` and `reply_authors` (written only when a record names
one). The engine still knows no app names: those two key names are the contract a recipe opts
into by declaring them.
| `label`, `note` | what the progress card shows, and why the recipe is written this way. |

Every expression is evaluated in `{ item, scope }` — the provider's record, and the scope value it
was listed under (`{ id, label }`). Only the four operators exist here too. A recipe that would
need a fifth is simplified and says so in its `note`; it does not grow the language.

### The people directory

Chat text is often written in ids: `<@U0EXAMPLE03>` means a person, and an item stored that way
is unsearchable by the one thing a reader knows — the name. An app whose records speak in ids
declares a `ConnectorSyncDirectory` beside its objects:

```json
"sync": {
  "directory": {
    "list_node": "slack-list_users-1",
    "list_input": { "limit": 200 },
    "page": {
      "items": { "$": "response.members" },
      "next_cursor": { "$": "response.next_cursor" },
      "cursor_param": "cursor"
    },
    "identity": { "$": "item.id" },
    "display_name": [{ "$": "item.profile.display_name" }, { "$": "item.profile.real_name" }, { "$": "item.name" }],
    "email": { "$": "item.profile.email" },
    "person_kind": { "bot": { "$": "item.is_bot" }, "guest": { "$": "item.is_restricted" } }
  }
}
```

The record is CLOSED. Every expression is evaluated with one directory entry as `item`.

- The directory is crawled FIRST on every run, before any object, so the run's own records
  resolve against the freshest listing. It has its own progress row, labelled "People".
- No cursor is persisted. The whole listing is re-read each crawl — a directory is small next
  to the records it explains, and a rename must land without waiting for a delta the provider may
  never send. The read still counts against the run's record budget.
- `display_name` may evaluate to an ARRAY. The engine takes the first non-empty trimmed string.
  This exists because providers answer `""` where `$default` would need `null` — Slack's
  `profile.display_name` is usually the empty string.
- `person_kind` is two truthy flags checked in order: `bot` wins, then `guest`, else `member`.
  Flags, not a conditional, because the language has no conditional.
- A directory failure fails its own progress row and is recorded as a problem; the objects still
  run. A refused credential stops the run at the first object listing regardless, so the
  directory refusing is not the run's death.

What the crawl reads lands in `source_actors`, scoped by `workspace_id` and keyed by
`(connection, external id)` with `provider` set to the app key. That table is what
`lookup: "person"` resolvers and `line.author` read.

### Text resolvers

```json
"text_resolvers": [
  { "pattern": "<@(U[A-Z0-9]+)>", "lookup": "person", "render": "@{display_name} ({external_person_id})" },
  { "pattern": "<#(C[A-Z0-9]+)\\|([^>]*)>", "render": "#{2}" }
]
```

A `ConnectorSyncTextResolver` rewrites the record's text BEFORE it is stored, so the content
hash, the chunks, and search all see the resolved text. `pattern` is a regular expression source
with at least one capture group, applied globally, in declaration order.

- With `lookup: "person"`, group 1 is looked up in `source_actors` by external id. On a hit,
  `render` is a template over the person row's fields (`display_name`, `external_person_id`,
  `email`) and the numbered groups `{1}`, `{2}`… . On a miss the match stays VERBATIM and the run
  counts it (`unresolved_mentions` on the object's progress row), so a directory gap is visible
  instead of silent.
- Without `lookup`, `render` sees only the numbered groups: a pure rewrite, like
  `<#C0AB…|general>` → `#general`.

Both halves are proven at load: a pattern that does not compile, captures nothing, or whose
render names a group the pattern does not have, fails the import.

### Line rendering

```json
"line": { "author": { "$": "item.user" }, "time": { "$": "item.ts" } }
```

On a BUCKETED object, a `ConnectorSyncLine` renders each record as `[{author} · {HH:mm}] {text}`
— the clock in UTC, read from `time` when declared and from the cursor field otherwise. The
author passes through the same resolution as the text: a person id the directory knows becomes
the display name, and the object's `text_resolvers` run over whatever remains.

A `line` object also gets, on its stored item:

- `metadata.participants` as `{ id, name }` pairs instead of bare strings, one per distinct
  author in the bucket.
- `metadata.record_index` as `[{ external_id, ts, author_id }]`, one entry per record, capped at
  500, merged across the pages of a bucket — the map from a rendered line back to the provider
  record it came from.

`line.text` is a third expression, used only when the object's `content` is a `read_node` whose
`text` evaluates to an array of OBJECTS: each element is rendered as its own
`[{author} · {HH:mm}] {text}` line, with that element as `item`. This is what lets a thread
item, read whole through a second node, still carry authored lines.

### Files a record carries

A chat channel is a third pictures and PDFs. A recipe that stores only message text loses the
invoice, the screenshot and the contract — usually the thing a person was looking for.

```json
"files": { "$": "item.files" }
```

The expression yields an array of `{ id, name, mime_type, byte_size?, download_url? }`. For each
one, ONCE per crawl however many records carry it, the engine:

- fetches it on the source's own connection (the token lives on the door, never in the engine),
  refusing anything over 25 MB and recording that as a problem rather than a silent gap. Files
  are fetched BEFORE the empty-content skip, so a body-less message that only carries an
  attachment still keeps it;
- keeps the bytes through the files service (`store_source_file`);
- transcribes what it can read (`parse_source_file`) and stores the file as its OWN brain item,
  kind `{app}_file`, named by the provider's file id, with `raw_file_id` pointing at the bytes.
  An image or any mime the transcriber cannot read is stored anyway with `needs_ocr` in its
  metadata, so the OCR lane fills the text in later without a re-crawl;
- writes `{ file_id, name, mime_type, byte_size }` into the carrying record's `metadata.files`,
  which the bucket merge then unions across the document;
- and points a `cites` edge from the document at the file's item.

Fetches and parses run five at a time. A file that fails is one problem on the source card; the
document that carried it is still stored. One fetch is memoized per provider file id per crawl,
so two records that carry the same attachment fetch it once.

How the bytes are actually fetched is declared once per app, in `sync.file_fetch`
(`ConnectorSyncFileFetch`). At least one of its two halves must be present:

```json
"file_fetch": { "hosts": ["files.slack.com", "*.slack.com"] }
```

`hosts` allows direct `download_url` fetches on the connection's token. A download URL comes out
of provider JSON, so the engine does not trust it by itself: it fetches only from the app's
`base_url` host and from the hosts listed here. Each entry is either a bare host or a `*.`
wildcard suffix over at least two labels — `*.slack.com`, never `*.com` and never a bare
`*slack.com` glob, because a loose glob admits `evilslack.com`, which would then carry the bearer
token to a host the app never named. The token travels only over https and only to the default
port. Any other host, scheme, or port is refused before a request is made, and the refusal is a
problem on the source card. The fetch streams the body under a 25 MB cap, checked against the declared size, the
response `content-length`, and the actual bytes received — whichever is smallest, so a provider
that understates its size does not get a free pass. A redirect is never followed with the token
to a host outside the allowed set: the engine checks the redirect target against the same host
rule before it sends the token again, instead of trusting the provider's 3xx blindly, and it
never follows a redirect from https to http.

```json
"file_fetch": { "node": "GMAIL_GET_ATTACHMENT" }
```

`node` names a fetch node the engine runs per file, for a provider whose records carry no
download URL at all — mail attachments are the normal case. What that node takes is declared on
the OBJECT that yields the files, as `file_fetch_input` — key → value expression, evaluated per
file in the scope `{ item, scope, file }`, where `file` is the yielded record itself:

```json
"file_fetch_input": {
  "user_id": "me",
  "message_id": { "$": "item.messageId" },
  "attachment_id": { "$": "file.id" },
  "file_name": { "$": "file.name" }
}
```

An object may not declare `file_fetch_input` without a `files` expression, and not without the
app naming a `file_fetch.node` to feed it to — either half alone is a recipe that can never
download anything, and fails the import.

### Two objects off one list node: the Slack pattern

`slack-list_messages-1` answers RECORDS, not messages: one record per LINE, each saying which
document that line belongs to (`day:{channel}:{YYYY-MM-DD}` or `thread:{channel}:{ts}`). A thread
root appears twice — as the first line of its thread, and as a one-line stub in the day it started.

Two recipes read that one node:

```json
"objects": {
  "channel_day": {
    "list_node": "slack-list_messages-1",
    "when": { "$": "item.is_day_record" },
    "bucket": { "by": "key", "key": { "$": "item.document_key" } },
    "title": { "$": "item.document_title" },
    "content": { "$": "item.line" },
    "item_kind": "slack_channel_day",
    "files": { "$": "item.files" }
  },
  "thread": {
    "list_node": "slack-list_messages-1",
    "when": { "$": "item.is_thread_record" },
    "bucket": { "by": "key", "key": { "$": "item.document_key" } },
    "item_kind": "slack_thread",
    "relationships": { "in_container": { "$": "item.day_document_key" } }
  }
}
```

Three things make it work, and each is a rule above rather than a Slack special case:

- `when` splits one stream of records into two documents. `is_day_record` is a FIELD, not a
  negation, because the language has four operators and none of them is `not`.
- `bucket.by: "key"` lets the record choose its own document, so a reply arriving tomorrow lands in
  the thread instead of rewriting yesterday's day.
- `relationships` resolve after the whole crawl, so the thread's `in_container` edge finds the
  channel day the OTHER object wrote.

It costs one listing, not two. Objects that share a list plan — same `list_node`, `scoped_by`,
`list_input`, `page` block, strategy and cursor — are read as ONE walk, and every page is handed to
each object's `when`. They keep their own cursors in `sync_state`, written together. Reading the
page once per object doubled every provider call, which at Slack's rate limit pushed a busy channel
past the life of an event job.

### What the engine guarantees

- **Resumability is the queue's.** A crawl stops after ~500 listed records, writes its cursors to
  `brain_sources.sync_state`, and the hourly stale sweep enqueues the next one. There is no
  scheduler in the engine.
- **The watermark stands still until a walk finishes.** A provider that answers newest first puts
  the newest marker on page one; moving the watermark there would step over everything unread. The
  running maximum waits in `pending_watermark` until the walk reaches the end.
- **A deletion needs proof.** Only a COMPLETE re-list proves absence, so only `relist_diff` sweeps,
  only for a recipe whose container IS the scope, and only at that recipe's `item_kind`. Every
  record a walk sees is stamped with the walk's own id; a stale stamp after a complete listing gets
  `deleted_time`. Search skips deleted items; their text stays, so old citations still resolve.
- **A half-read bucket is not a bucket.** When a budget stops a bucketed listing, the bucket at the
  edge is dropped and the next crawl resumes at the page that bucket started on.
- **A refused credential stops the whole run** (`broken`); a rate limit pauses it (`rate_limited`);
  any other failure belongs to its own scope, is recorded as a problem, and the next scope runs.
