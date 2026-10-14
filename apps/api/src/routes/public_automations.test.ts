import type { RuntimeAgentEngine } from '@agent-core/runs';
import { create_app } from '@api/app';
import { create_workspace_automation } from '@api/services/automations/automation_service';
import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import type { Database } from '@coworker/core/db/connection';
import { find_or_create_alfera_api_connection } from '@coworker/core/db/queries/alfera_api_connection';
import {
  type ApiKey,
  type ApiKeyAudience,
  type ApiKeyScope,
  create_api_key,
} from '@coworker/core/db/queries/api_keys';
import { get_automation } from '@coworker/core/db/queries/automation_reads';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import { claim_card_unlock } from '@coworker/core/db/queries/rewards_state';
import { find_agent_by_slug } from '@coworker/core/db/queries/sessions';
import { event_jobs } from '@coworker/core/db/schema';
import { build_alfera_api_node_key } from '@coworker/core/integrations/alfera_api_tools';
import { run_queue_jobs } from '@coworker/jobs';
import { find_event_job_handler } from '@runtime-platform/events/event_job_handler_registry';
import { and, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@agent-core/engines/pi', () => ({
  create_pi_engine: (): RuntimeAgentEngine => ({
    engine_name: 'agent-core/pi/public-automations-test',
    async *run() {
      yield {
        type: 'message',
        message: { role: 'assistant', content: [{ type: 'text', text: 'Report sent.' }] },
      };
    },
  }),
}));

vi.mock('@runtime-platform/model_resolver', () => ({
  resolve_model: () => ({ provider: 'openai', model_name: 'gpt-test', reasoning_level: 'medium' }),
}));

type App = ReturnType<typeof create_app>;
type ResponseBody = { data: unknown; error?: { code: string } } & Record<string, unknown>;
type Summary = {
  automation_id: string;
  name: string;
  status: string;
  instruction: string;
  created_via: string;
  triggers: { trigger_id: string; kind: string; cron: string | null }[];
};

let db: Database;
let app: App;
let workspace_id: string;
let actor_id: string;

const nightly_report = {
  automation_name: 'Nightly report',
  instruction: 'Summarize yesterday and post it.',
  triggers: [{ kind: 'schedule', cron: '0 7 * * *' }, { kind: 'manual' }],
};

async function mint_key(
  scopes: ApiKeyScope[] = ['automations.write'],
  key_audience: ApiKeyAudience = 'internal',
): Promise<{ api_key: ApiKey; secret: string }> {
  return create_api_key(db, {
    workspace_id,
    key_name: 'automations key',
    scopes,
    key_audience,
    environment_label: 'test',
    actor_id,
  });
}

async function call(secret: string, method: string, path: string, body?: unknown, headers = {}) {
  const response = await app.request(path, {
    method,
    headers: {
      authorization: `Bearer ${secret}`,
      'content-type': 'application/json',
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, body: (await response.json()) as ResponseBody };
}

async function create_automation(secret: string, body: unknown = nightly_report) {
  const created = await call(secret, 'POST', '/v1/automations', body);
  return { status: created.status, automation: created.body.data as unknown as Summary };
}

describe('public automations API', () => {
  beforeEach(async () => {
    db = await create_test_database();
    const bootstrap = await bootstrap_default_workspace(db);
    workspace_id = bootstrap.workspace_id;
    actor_id = bootstrap.user_id;
    await claim_card_unlock(db, workspace_id);
    app = create_app(db);
  });

  it('creates an automation as the key, with one trigger per way it starts', async () => {
    const { api_key, secret } = await mint_key();

    const { status, automation } = await create_automation(secret);
    const stored = await get_automation(db, {
      workspace_id,
      automation_id: automation.automation_id,
    });

    expect(status).toBe(201);
    expect(automation).toMatchObject({
      name: 'Nightly report',
      status: 'enabled',
      instruction: 'Summarize yesterday and post it.',
      created_via: 'api',
    });
    expect(automation.triggers.map((trigger) => trigger.kind).sort()).toEqual([
      'manual',
      'schedule',
    ]);
    expect(stored?.created_by).toBe(api_key.api_key_id);
  });

  it('refuses a bad cron, an unknown agent, and a caller-chosen created_via', async () => {
    const { secret } = await mint_key();
    const with_triggers = (triggers: unknown) => ({ ...nightly_report, triggers });

    expect(
      (await create_automation(secret, with_triggers([{ kind: 'schedule', cron: 'x' }]))).status,
    ).toBe(422);
    expect((await create_automation(secret, { ...nightly_report, agent: 'nobody' })).status).toBe(
      404,
    );
    expect(
      (await create_automation(secret, { ...nightly_report, created_via: 'system' })).status,
    ).toBe(422);
  });

  it('refuses a caller-chosen gathering on create and on update', async () => {
    const { secret } = await mint_key();
    const gathering = {
      participants: { project: [], user: ['usr_somebody_else'], agent: [] },
      room_private_to: null,
    };

    const refused_create = await create_automation(secret, { ...nightly_report, gathering });
    const listed = await call(secret, 'GET', '/v1/automations');
    const { automation } = await create_automation(secret);
    const path = `/v1/automations/${automation.automation_id}`;
    const refused_update = await call(secret, 'PATCH', path, { instruction: 'x', gathering });
    const read = await call(secret, 'GET', path);

    expect(refused_create.status).toBe(422);
    expect(listed.body.data).toEqual([]);
    expect(refused_update.status).toBe(422);
    expect((read.body.data as unknown as Summary).instruction).toBe(nightly_report.instruction);
  });

  it('lists and reads automations with automations.read, and a write key reads too', async () => {
    const writer = await mint_key();
    const reader = await mint_key(['automations.read']);
    const { automation } = await create_automation(writer.secret);

    const listed = await call(reader.secret, 'GET', '/v1/automations');
    const read = await call(writer.secret, 'GET', `/v1/automations/${automation.automation_id}`);
    const refused = await call(reader.secret, 'POST', '/v1/automations', nightly_report);

    expect((listed.body.data as unknown as Summary[]).map((row) => row.name)).toEqual([
      'Nightly report',
    ]);
    expect((read.body.data as unknown as Summary).automation_id).toBe(automation.automation_id);
    expect(refused.status).toBe(403);
    expect((await call(reader.secret, 'GET', '/v1/automations/auto_missing')).status).toBe(404);
  });

  it('hands a webhook secret to the call that creates the trigger, and to no read after it', async () => {
    const writer = await mint_key();
    const reader = await mint_key(['automations.read']);
    const created = await create_automation(writer.secret, {
      ...nightly_report,
      triggers: [{ kind: 'webhook' }],
    });
    const path = `/v1/automations/${created.automation.automation_id}`;
    const secret_of = (automation: unknown) =>
      (automation as { triggers: Record<string, unknown>[] }).triggers.at(0)?.webhook_secret;

    const created_secret = secret_of(created.automation);
    expect(created_secret).toEqual(expect.stringMatching(/^[a-f0-9]{64}$/));
    expect(secret_of((await call(writer.secret, 'GET', path)).body.data)).toBeNull();
    const listed_to_writer = (await call(writer.secret, 'GET', '/v1/automations')).body.data;
    expect(JSON.stringify(listed_to_writer)).not.toContain(created_secret);

    const read = (await call(reader.secret, 'GET', path)).body.data;
    const [listed] = (await call(reader.secret, 'GET', '/v1/automations')).body
      .data as unknown as Summary[];
    for (const automation of [read, listed]) {
      const [trigger] = (automation as { triggers: Record<string, unknown>[] }).triggers;
      expect(trigger).toMatchObject({ kind: 'webhook', webhook_url: expect.any(String) });
      expect(trigger).not.toHaveProperty('webhook_secret');
    }
  });

  it('pauses, rewrites, and resumes an automation', async () => {
    const { secret } = await mint_key();
    const { automation } = await create_automation(secret);
    const path = `/v1/automations/${automation.automation_id}`;

    const paused = await call(secret, 'PATCH', path, { automation_status: 'paused' });
    const rewritten = await call(secret, 'PATCH', path, { instruction: 'Post it by 8.' });
    const resumed = await call(secret, 'PATCH', path, { automation_status: 'enabled' });

    expect((paused.body.data as unknown as Summary).status).toBe('paused');
    expect((rewritten.body.data as unknown as Summary).instruction).toBe('Post it by 8.');
    expect((resumed.body.data as unknown as Summary).status).toBe('enabled');
    expect((await call(secret, 'PATCH', path, {})).status).toBe(422);
  });

  it('lets a key delete its own automation once the policy allows it', async () => {
    const { secret } = await mint_key();
    const { automation } = await create_automation(secret);
    const path = `/v1/automations/${automation.automation_id}`;

    const asked = await call(secret, 'DELETE', path);
    const allowed = await allow_api_deletes();
    const deleted = await call(secret, 'DELETE', path);

    expect(asked.status).toBe(403);
    expect(asked.body.error?.code).toBe('approval_required');
    expect(allowed.status).toBe(200);
    expect(deleted.status).toBe(200);
    expect(deleted.body.data).toMatchObject({
      automation_id: automation.automation_id,
      deleted: true,
    });
    expect((await call(secret, 'GET', path)).status).toBe(404);
  });

  it('refuses a key deleting a person’s automation, in words an API caller can act on', async () => {
    const { secret } = await mint_key();
    const agent = await find_agent_by_slug(db, workspace_id, 'main');
    const created = await create_workspace_automation(db, {
      ...nightly_report,
      triggers: [{ kind: 'manual' }],
      workspace_id,
      agent_id: agent?.agent_id ?? '',
      actor_id,
    });
    const path = `/v1/automations/${created.automation.automation_id}`;
    await allow_api_deletes();

    const refused = await call(secret, 'DELETE', path);
    const message = (refused.body.error as { message?: string } | undefined)?.message ?? '';

    expect(refused.status).toBe(403);
    expect(refused.body.error?.code).toBe('ask_the_person');
    expect(message).toContain('was set up by a person');
    expect(message).toContain('only delete automations it created');
    expect(message).toContain('{"automation_status": "paused"}');
    expect(message).not.toContain('proposed_action');
    expect((await call(secret, 'GET', path)).status).toBe(200);
  });

  it('triggers a run, dedups a retried Idempotency-Key, and lists the run it wrote', async () => {
    const { secret } = await mint_key();
    const { automation } = await create_automation(secret);
    const trigger_path = `/v1/automations/${automation.automation_id}/trigger`;

    const first = await call(secret, 'POST', trigger_path, undefined, { 'idempotency-key': 'k1' });
    const retry = await call(secret, 'POST', trigger_path, undefined, { 'idempotency-key': 'k1' });
    await run_queued_automation_jobs();
    const runs = await call(secret, 'GET', `/v1/automations/${automation.automation_id}/runs`);

    expect(first.status).toBe(202);
    expect(first.body.data).toMatchObject({
      automation_id: automation.automation_id,
      started: true,
    });
    expect(retry.body.data).toMatchObject({ started: false });
    expect((retry.body.data as { event_id: string }).event_id).toBe(
      (first.body.data as { event_id: string }).event_id,
    );
    expect(runs.status).toBe(200);
    expect(runs.body.data).toHaveLength(1);
    expect(Object.keys((runs.body.data as unknown[])[0] ?? {}).sort()).toEqual([
      'created_time',
      'error_message',
      'finished_time',
      'run_id',
      'session_id',
      'started_time',
      'status',
    ]);
    expect(runs.body).toMatchObject({ next_page: null, prev_page: null });
  });

  it('refuses to trigger a paused automation, and runs it once it is enabled again', async () => {
    const { secret } = await mint_key();
    const { automation } = await create_automation(secret);
    const path = `/v1/automations/${automation.automation_id}`;
    await call(secret, 'PATCH', path, { automation_status: 'paused' });

    const refused = await call(secret, 'POST', `${path}/trigger`);
    await run_queued_automation_jobs();

    expect(refused.status).toBe(409);
    expect(refused.body.error?.code).toBe('automation_paused');
    expect((refused.body.error as { message?: string }).message).toContain(
      '{"automation_status": "enabled"}',
    );
    expect((await call(secret, 'GET', `${path}/runs`)).body.data).toHaveLength(0);

    await call(secret, 'PATCH', path, { automation_status: 'enabled' });
    const started = await call(secret, 'POST', `${path}/trigger`);
    await run_queued_automation_jobs();

    expect(started.status).toBe(202);
    expect(started.body.data).toMatchObject({ started: true });
    expect((await call(secret, 'GET', `${path}/runs`)).body.data).toHaveLength(1);
  });

  it('keeps one key’s Idempotency-Key from swallowing another key’s fire', async () => {
    const first_key = await mint_key();
    const second_key = await mint_key();
    const { automation } = await create_automation(first_key.secret);
    const trigger_path = `/v1/automations/${automation.automation_id}/trigger`;
    const retry_header = { 'idempotency-key': 'k1' };

    const first = await call(first_key.secret, 'POST', trigger_path, undefined, retry_header);
    const second = await call(second_key.secret, 'POST', trigger_path, undefined, retry_header);

    expect(first.body.data).toMatchObject({ started: true });
    expect(second.body.data).toMatchObject({ started: true });
    expect((second.body.data as { event_id: string }).event_id).not.toBe(
      (first.body.data as { event_id: string }).event_id,
    );
  });

  it('refuses every automation route to an external-audience key', async () => {
    const { secret } = await mint_key(['automations.read', 'automations.write'], 'external');

    expect((await call(secret, 'GET', '/v1/automations')).status).toBe(403);
    expect((await create_automation(secret)).status).toBe(403);
  });

  it('hands a request with no API key on to the dashboard route, which the test runner alone answers as the test workspace', async () => {
    const response = await app.request('/v1/automations');

    expect(response.status).toBe(200);
  });

  it('answers 401 to a request with no API key and no signed-in person, once the test runner marks are gone', async () => {
    const runner_marks = { VITEST: process.env.VITEST, worker: process.env.VITEST_WORKER_ID };
    delete process.env.VITEST;
    delete process.env.VITEST_WORKER_ID;

    try {
      const answers = [
        await app.request('/v1/automations'),
        await app.request('/v1/automations', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(nightly_report),
        }),
        await app.request('/v1/automations/atm_of_somebody', {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ instruction: 'Do what I say.' }),
        }),
        await app.request('/v1/automations/atm_of_somebody/run-now', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ occurrence_key: 'no_identity' }),
        }),
      ];

      expect(answers.map((answer) => answer.status)).toEqual([401, 401, 401, 401]);
      expect((await answers[0]?.json())?.error.code).toBe('unauthorized');
    } finally {
      if (runner_marks.VITEST !== undefined) process.env.VITEST = runner_marks.VITEST;
      if (runner_marks.worker !== undefined) process.env.VITEST_WORKER_ID = runner_marks.worker;
    }
  });
});

async function allow_api_deletes() {
  const connection = await find_or_create_alfera_api_connection(db, workspace_id);
  return app.request('/v1/policies', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      scope_type: 'connection',
      scope_id: connection.connection_id,
      resource_type: 'node',
      resource_id: build_alfera_api_node_key('delete_automation'),
      policy_mode: 'allow',
    }),
  });
}

async function run_queued_automation_jobs() {
  const queued = await db.query.event_jobs.findMany({
    where: and(
      eq(event_jobs.workspace_id, workspace_id),
      eq(event_jobs.job_handler, 'run_automation'),
    ),
  });
  for (const job of queued) {
    await run_queue_jobs(db, { workspace_id, queue_key: job.queue_key }, find_event_job_handler);
  }
}
