import type { RuntimeAgentEngine } from '@agent-core/runs';
import { create_app } from '@api/app';
import { mint_workspace_api_key } from '@api/services/api_keys';
import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import type { Database } from '@coworker/core/db/connection';
import {
  type ApiKeyAudience,
  type ApiKeyScope,
  create_api_key,
} from '@coworker/core/db/queries/api_keys';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import { sessions } from '@coworker/core/db/schema';
import { eq } from 'drizzle-orm';
import OpenAI from 'openai';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@agent-core/engines/pi', () => ({
  create_pi_engine: (): RuntimeAgentEngine => ({
    engine_name: 'agent-core/pi/compat-test',
    async *run() {
      yield {
        type: 'message',
        message: { role: 'assistant', content: [{ type: 'text', text: 'Done.' }] },
      };
    },
  }),
}));

vi.mock('@runtime-platform/model_resolver', () => ({
  resolve_model: () => ({ provider: 'openai', model_name: 'gpt-test', reasoning_level: 'medium' }),
}));

type App = ReturnType<typeof create_app>;

let db: Database;
let app: App;
let workspace_id: string;
let actor_id: string;

async function mint_key(
  scopes: ApiKeyScope[] = ['chat.completions'],
  key_audience: ApiKeyAudience = 'internal',
): Promise<string> {
  const { secret } = await create_api_key(db, {
    workspace_id,
    key_name: `${key_audience} compat key`,
    scopes,
    key_audience,
    environment_label: 'test',
    actor_id,
  });
  return secret;
}

function compat_client(secret: string) {
  return new OpenAI({
    apiKey: secret,
    baseURL: 'http://compat.test/api/compat/v1',
    maxRetries: 0,
    fetch: (async (input: string, init?: RequestInit) => app.request(input, init)) as never,
  });
}

function post(path: string, secret: string | null, body: unknown) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (secret) headers.authorization = `Bearer ${secret}`;
  return app.request(path, { method: 'POST', headers, body: JSON.stringify(body) });
}

describe('OpenAI/Anthropic compatible API', () => {
  beforeEach(async () => {
    db = await create_test_database();
    const bootstrap = await bootstrap_default_workspace(db);
    workspace_id = bootstrap.workspace_id;
    actor_id = bootstrap.user_id;
    app = create_app(db);
  });

  it('answers a real OpenAI chat.completions request with the agent text', async () => {
    const client = compat_client(await mint_key());

    const completion = await client.chat.completions.create({
      model: 'alfera',
      messages: [{ role: 'user', content: 'Summarize yesterday.' }],
    });

    expect(completion.object).toBe('chat.completion');
    expect(completion.model).toBe('alfera');
    expect(completion.choices[0]?.message.content).toBe('Done.');
    expect(completion.choices[0]?.finish_reason).toBe('stop');
  });

  it('streams well-formed chunks ending in a stop finish_reason', async () => {
    const client = compat_client(await mint_key());

    const stream = await client.chat.completions.create({
      model: 'alfera',
      stream: true,
      messages: [{ role: 'user', content: 'Summarize yesterday.' }],
    });

    let content = '';
    let finish_reason: string | null | undefined;
    for await (const chunk of stream) {
      expect(chunk.object).toBe('chat.completion.chunk');
      content += chunk.choices[0]?.delta.content ?? '';
      finish_reason = chunk.choices[0]?.finish_reason ?? finish_reason;
    }
    expect(content).toBe('Done.');
    expect(finish_reason).toBe('stop');
  });

  it('resumes a durable session through previous_response_id', async () => {
    const secret = await mint_key();
    const first = await (
      await post('/api/compat/v1/responses', secret, {
        model: 'alfera',
        input: 'Start.',
      })
    ).json();
    const second = await (
      await post('/api/compat/v1/responses', secret, {
        model: 'alfera',
        input: 'Continue.',
        previous_response_id: first.id,
      })
    ).json();

    expect(first.object).toBe('response');
    expect(first.output_text).toBe('Done.');
    expect(second.id).toBe(first.id);
  });

  it('answers an Anthropic messages request with a valid message object', async () => {
    const response = await post('/api/compat/v1/messages', await mint_key(), {
      model: 'alfera',
      max_tokens: 128,
      messages: [{ role: 'user', content: 'Summarize yesterday.' }],
    });
    const message = await response.json();

    expect(response.status).toBe(200);
    expect(message.type).toBe('message');
    expect(message.role).toBe('assistant');
    expect(message.model).toBe('alfera');
    expect(message.content[0]).toEqual({ type: 'text', text: 'Done.' });
    expect(message.stop_reason).toBe('end_turn');
  });

  it('holds a compat conversation to the REST text caps on every wire format', async () => {
    const secret = await mint_key();
    const too_long = 'x'.repeat(8001);
    const too_many = Array.from({ length: 401 }, (_, index) => ({
      role: index % 2 === 0 ? 'user' : 'assistant',
      content: `turn ${index}`,
    }));

    const refused = await Promise.all([
      post('/api/compat/v1/chat/completions', secret, {
        model: 'alfera',
        messages: [{ role: 'user', content: too_long }],
      }),
      post('/api/compat/v1/chat/completions', secret, { model: 'alfera', messages: too_many }),
      post('/api/compat/v1/responses', secret, { model: 'alfera', input: too_long }),
      post('/api/compat/v1/messages', secret, {
        model: 'alfera',
        max_tokens: 100,
        messages: [{ role: 'user', content: [{ type: 'text', text: too_long }] }],
      }),
    ]);

    for (const response of refused) {
      expect(response.status).toBe(422);
      const body = (await response.json()) as { error?: { code: string; message: string } };
      expect(body.error).toMatchObject({
        code: 'validation_error',
        message: expect.stringContaining('at most 8000 characters'),
      });
    }
    expect(await db.query.sessions.findMany({ where: eq(sessions.session_source, 'api') })).toEqual(
      [],
    );
  });

  it('requires Anthropic max_tokens', async () => {
    const response = await post('/api/compat/v1/messages', await mint_key(), {
      model: 'alfera',
      messages: [{ role: 'user', content: 'Hi' }],
    });
    expect(response.status).toBe(422);
  });

  it('counts input tokens without running the agent', async () => {
    const response = await post('/api/compat/v1/messages/count_tokens', await mint_key(), {
      model: 'alfera',
      messages: [{ role: 'user', content: 'hello world this is a token count' }],
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.input_tokens).toBeGreaterThan(0);
    expect(Number.isInteger(body.input_tokens)).toBe(true);
  });

  it('lists the single logical model alfera', async () => {
    const response = await app.request('/api/compat/v1/models', {
      headers: { authorization: `Bearer ${await mint_key()}` },
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data[0].id).toBe('alfera');
  });

  it('refuses the chat.completions scope on an external-audience key', async () => {
    await expect(
      mint_workspace_api_key(db, {
        workspace_id,
        user_id: actor_id,
        key_name: 'widget key',
        scopes: ['chat.completions'],
        key_audience: 'external',
      }),
    ).rejects.toMatchObject({ code: 'validation_error', status: 422 });

    const external_secret = await mint_key(['chat.completions'], 'external');
    const response = await post('/api/compat/v1/chat/completions', external_secret, {
      model: 'alfera',
      messages: [{ role: 'user', content: 'Hi' }],
    });
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error.code).toBe('scope_missing');
  });

  it('refuses a request with no API key', async () => {
    const response = await post('/api/compat/v1/chat/completions', null, {
      model: 'alfera',
      messages: [{ role: 'user', content: 'Hi' }],
    });
    expect(response.status).toBe(401);
  });
});
