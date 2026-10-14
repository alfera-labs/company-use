import { create_app } from '@api/app';
import {
  type PublicSessionMessageMatch,
  split_snippet_into_runs,
} from '@api/routes/sessions/public_session_message_match';
import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import type { Database } from '@coworker/core/db/connection';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import {
  match_end_marker,
  match_start_marker,
} from '@coworker/core/db/queries/session_message_search';
import {
  create_run,
  create_run_messages,
  create_session,
} from '@coworker/core/db/queries/sessions';
import { beforeEach, describe, expect, it } from 'vitest';

type App = ReturnType<typeof create_app>;

let db: Database;
let app: App;
let bootstrap: Awaited<ReturnType<typeof bootstrap_default_workspace>>;

beforeEach(async () => {
  db = await create_test_database();
  bootstrap = await bootstrap_default_workspace(db);
  app = create_app(db);
});

async function create_chat_saying(title: string, text: string) {
  const session = await create_session(db, {
    workspace_id: bootstrap.workspace_id,
    agent_id: bootstrap.agent_id,
    actor_id: bootstrap.user_id,
    session_title: title,
  });
  const run = await create_run(db, {
    workspace_id: bootstrap.workspace_id,
    session_id: session.session_id,
    agent_id: bootstrap.agent_id,
    trigger_type: 'user_message',
    actor_id: bootstrap.user_id,
  });
  await create_run_messages(db, [
    {
      workspace_id: bootstrap.workspace_id,
      session_id: session.session_id,
      run_id: run.run_id,
      message_role: 'assistant',
      message_content: { type: 'text', text },
      source_type: 'dashboard',
      actor_id: bootstrap.user_id,
    },
  ]);
  return session.session_id;
}

async function add_internal_rows(session_id: string) {
  const run = await create_run(db, {
    workspace_id: bootstrap.workspace_id,
    session_id,
    agent_id: bootstrap.agent_id,
    trigger_type: 'user_message',
    actor_id: bootstrap.user_id,
  });
  const row = { workspace_id: bootstrap.workspace_id, session_id, run_id: run.run_id };
  await create_run_messages(db, [
    {
      ...row,
      message_role: 'tool_result',
      message_content: {
        type: 'tool_result',
        text: '{"preloaded_tools":[],"resources":["/workspace/skills/heron/SKILL.md"],"note":"heron heron heron"}',
      },
      source_type: 'runtime',
      actor_id: bootstrap.user_id,
    },
    {
      ...row,
      message_role: 'assistant',
      message_content: { type: 'reasoning_summary', text: 'I should read the heron digest first.' },
      source_type: 'runtime',
      actor_id: bootstrap.user_id,
    },
  ]);
}

async function search(query_string: string) {
  const response = await app.request(`/v1/sessions/search?${query_string}`);
  return {
    status: response.status,
    body: (await response.json()) as { data?: PublicSessionMessageMatch[] },
  };
}

describe('GET /v1/sessions/search', () => {
  it('finds a chat by a phrase that appears only inside its messages', async () => {
    const session_id = await create_chat_saying(
      'Tuesday sync',
      'The Stripe webhook kept returning a 400 all afternoon.',
    );

    const { status, body } = await search('q=stripe+webhook');

    expect(status).toBe(200);
    expect(body.data).toHaveLength(1);
    expect(body.data?.[0]?.session_id).toBe(session_id);
    expect(body.data?.[0]?.session_title).toBe('Tuesday sync');
  });

  it('is not shadowed by the session-by-id route', async () => {
    await create_chat_saying('Anything', 'a distinctive pelican appears here');

    const { status, body } = await search('q=pelican');

    expect(status).toBe(200);
    expect(body.data).toHaveLength(1);
  });

  it('marks the matched words in the snippet it returns', async () => {
    await create_chat_saying(
      'Billing',
      'We agreed the invoice reconciliation should run nightly instead of hourly.',
    );

    const runs = (await search('q=reconciliation')).body.data?.[0]?.snippet_runs ?? [];

    expect(runs.filter((run) => run.is_match).map((run) => run.text)).toEqual(['reconciliation']);
    expect(runs.map((run) => run.text).join('')).toContain('nightly');
  });

  it('returns angle brackets as plain text and never leaks a marker', async () => {
    await create_chat_saying('Risky', 'The payload was <img src=x onerror=alert(1)> pelican.');

    const runs = (await search('q=pelican')).body.data?.[0]?.snippet_runs ?? [];
    const snippet_text = runs.map((run) => run.text).join('');

    expect(snippet_text).toContain('<img');
    expect(snippet_text).not.toContain(match_start_marker);
    expect(snippet_text).not.toContain(match_end_marker);
  });

  it('searches only what the person wrote and what the coworker answered', async () => {
    const session_id = await create_chat_saying('Birds', 'The heron count is up this spring.');
    await add_internal_rows(session_id);

    const found = (await search('q=heron')).body.data ?? [];
    const preview = (found[0]?.snippet_runs ?? []).map((run) => run.text).join('');

    expect(found).toHaveLength(1);
    expect(preview).toBe('heron count is up this spring');
    expect((await search('q=preloaded_tools')).body.data).toEqual([]);
    expect((await search('q=SKILL.md')).body.data).toEqual([]);
    expect((await search('q=digest')).body.data).toEqual([]);
  });

  it('rejects a query longer than the parser should ever be handed', async () => {
    expect((await search(`q=${'a'.repeat(201)}`)).status).toBe(422);
  });

  it('answers an all-punctuation query with no matches rather than an error', async () => {
    await create_chat_saying('Anything', 'a distinctive pelican appears here');

    const { status, body } = await search('q=%26%26%26');

    expect(status).toBe(200);
    expect(body.data).toEqual([]);
  });
});

describe('split_snippet_into_runs', () => {
  it('splits a marked snippet into alternating plain and matched runs', () => {
    const snippet = `run ${match_start_marker}nightly${match_end_marker} instead`;

    expect(split_snippet_into_runs(snippet)).toEqual([
      { text: 'run ', is_match: false },
      { text: 'nightly', is_match: true },
      { text: ' instead', is_match: false },
    ]);
  });

  it('returns a snippet with no markers as one plain run', () => {
    expect(split_snippet_into_runs('nothing marked here')).toEqual([
      { text: 'nothing marked here', is_match: false },
    ]);
  });

  it('keeps the tail as plain text when a highlight is left unclosed', () => {
    const snippet = `run ${match_start_marker}nightly`;

    expect(split_snippet_into_runs(snippet)).toEqual([{ text: 'run nightly', is_match: false }]);
  });

  it('reads a row of a markdown table as its words, with no pipes and no dashes', () => {
    const table = `| Planet | Diameter |\n|---|:---:|\n| ${match_start_marker}Mars${match_end_marker} | 6,779 km |`;

    const text = split_snippet_into_runs(table)
      .map((run) => run.text)
      .join('');

    expect(text).not.toMatch(/[|]|-{3}/u);
    expect(text.replace(/\s+/gu, ' ').trim()).toBe('Planet Diameter Mars 6,779 km');
  });

  it('drops empty runs rather than emitting blank text', () => {
    const snippet = `${match_start_marker}only${match_end_marker}`;

    expect(split_snippet_into_runs(snippet)).toEqual([{ text: 'only', is_match: true }]);
  });

  it('shows no markdown mark in the preview of a message written in markdown', () => {
    const snippet = `## Plan\n**${match_start_marker}Revenue${match_end_marker}** is up, see \`report.md\` and [the sheet](https://example.com/s).`;

    expect(split_snippet_into_runs(snippet)).toEqual([
      { text: 'Plan\n', is_match: false },
      { text: 'Revenue', is_match: true },
      { text: ' is up, see report.md and the sheet.', is_match: false },
    ]);
  });

  it('keeps the signs of plain text that are not markdown marks', () => {
    expect(split_snippet_into_runs('2 * 3 > 5, snake_case and a_b')).toEqual([
      { text: '2 * 3 > 5, snake_case and a_b', is_match: false },
    ]);
  });
});
