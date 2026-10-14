import { create_llm_gateway } from '@agent-core/llm_gateway';
import { create_fake_llm_adapter } from '@agent-core/llm_gateway/adapters/fake_llm_adapter';
import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import { create_session, get_session } from '@coworker/core/db/queries/sessions';
import type { SessionMetadata } from '@coworker/core/db/schema/json_column_types';
import { set_session_title_from_prompt } from '@runtime-platform/orchestrator/session_title';
import { describe, expect, it } from 'vitest';

const title_prompt_text = 'Debug Stripe OAuth callback failures today.';

describe('session title generation', () => {
  it('generates an LLM title from the submitted prompt', async () => {
    const fixture = await create_title_fixture();
    const llm_gateway = create_fake_gateway('{"title":"Stripe OAuth Callback Debugging"}');

    const result = await set_session_title_from_prompt(fixture.db, {
      workspace_id: fixture.bootstrap.workspace_id,
      session_id: fixture.session.session_id,
      agent_id: fixture.bootstrap.agent_id,
      actor_id: fixture.bootstrap.user_id,
      prompt_text: title_prompt_text,
      llm_gateway,
    });
    const updated_session = await get_session(
      fixture.db,
      fixture.bootstrap.workspace_id,
      fixture.session.session_id,
    );

    expect(result).toEqual({
      status: 'updated',
      title: 'Stripe OAuth Callback Debugging',
      source: 'llm',
    });
    expect(updated_session?.session_metadata).toMatchObject({
      title_generation: { source: 'llm' },
    });
  });

  it('does not overwrite a custom session title', async () => {
    const fixture = await create_title_fixture('Custom Roadmap');
    const llm_gateway = create_fake_gateway('{"title":"Stripe OAuth Callback Debugging"}');

    const result = await set_session_title_from_prompt(fixture.db, {
      workspace_id: fixture.bootstrap.workspace_id,
      session_id: fixture.session.session_id,
      agent_id: fixture.bootstrap.agent_id,
      actor_id: fixture.bootstrap.user_id,
      prompt_text: title_prompt_text,
      llm_gateway,
    });
    const updated_session = await get_session(
      fixture.db,
      fixture.bootstrap.workspace_id,
      fixture.session.session_id,
    );

    expect(result).toEqual({ status: 'skipped', reason: 'custom_title' });
    expect(updated_session?.session_title).toBe('Custom Roadmap');
  });

  it('replaces the label the product wrote for the chat list', async () => {
    const fixture = await create_title_fixture('Untitled session', {
      title_generation: { source: 'placeholder' },
    });
    const llm_gateway = create_fake_gateway('{"title":"Stripe OAuth Callback Debugging"}');

    const result = await set_session_title_from_prompt(fixture.db, {
      workspace_id: fixture.bootstrap.workspace_id,
      session_id: fixture.session.session_id,
      agent_id: fixture.bootstrap.agent_id,
      actor_id: fixture.bootstrap.user_id,
      prompt_text: title_prompt_text,
      llm_gateway,
    });

    expect(result).toEqual({
      status: 'updated',
      title: 'Stripe OAuth Callback Debugging',
      source: 'llm',
    });
  });

  it('replaces a Slack placeholder title', async () => {
    const fixture = await create_title_fixture('#support thread', {
      title_generation: { source: 'placeholder' },
    });
    const llm_gateway = create_fake_gateway('{"title":"Stripe OAuth Callback Debugging"}');

    const result = await set_session_title_from_prompt(fixture.db, {
      workspace_id: fixture.bootstrap.workspace_id,
      session_id: fixture.session.session_id,
      agent_id: fixture.bootstrap.agent_id,
      actor_id: fixture.bootstrap.user_id,
      prompt_text: title_prompt_text,
      llm_gateway,
    });

    expect(result).toEqual({
      status: 'updated',
      title: 'Stripe OAuth Callback Debugging',
      source: 'llm',
    });
  });

  it('still names a chat whose creator passed unrelated metadata', async () => {
    const fixture = await create_title_fixture(undefined, { read_markers: { usr_reader: 1 } });
    const llm_gateway = create_fake_gateway('{"title":"Stripe OAuth Callback Debugging"}');

    const result = await set_session_title_from_prompt(fixture.db, {
      workspace_id: fixture.bootstrap.workspace_id,
      session_id: fixture.session.session_id,
      agent_id: fixture.bootstrap.agent_id,
      actor_id: fixture.bootstrap.user_id,
      prompt_text: title_prompt_text,
      llm_gateway,
    });

    expect(result).toMatchObject({ status: 'updated', source: 'llm' });
  });

  it('leaves the rest of the chat metadata alone when it writes the title', async () => {
    const fixture = await create_title_fixture(undefined, {
      title_generation: { source: 'placeholder' },
      read_markers: { usr_reader: 3 },
    });
    const llm_gateway = create_fake_gateway('{"title":"Stripe OAuth Callback Debugging"}');

    await set_session_title_from_prompt(fixture.db, {
      workspace_id: fixture.bootstrap.workspace_id,
      session_id: fixture.session.session_id,
      agent_id: fixture.bootstrap.agent_id,
      actor_id: fixture.bootstrap.user_id,
      prompt_text: title_prompt_text,
      llm_gateway,
    });
    const updated_session = await get_session(
      fixture.db,
      fixture.bootstrap.workspace_id,
      fixture.session.session_id,
    );

    expect(updated_session?.session_title).toBe('Stripe OAuth Callback Debugging');
    expect(updated_session?.session_metadata.title_generation?.source).toBe('llm');
    expect(updated_session?.session_metadata.read_markers).toEqual({ usr_reader: 3 });
  });

  it('falls back to the submitted prompt when the gateway returns a weak title', async () => {
    const fixture = await create_title_fixture();
    const llm_gateway = create_fake_gateway('{"title":"Bug"}');

    const result = await set_session_title_from_prompt(fixture.db, {
      workspace_id: fixture.bootstrap.workspace_id,
      session_id: fixture.session.session_id,
      agent_id: fixture.bootstrap.agent_id,
      actor_id: fixture.bootstrap.user_id,
      prompt_text: title_prompt_text,
      llm_gateway,
    });

    expect(result).toEqual({
      status: 'updated',
      title: 'Debug Stripe OAuth callback failures today',
      source: 'fallback',
    });
  });

  it('stores what the provider said when the model call fails', async () => {
    const fixture = await create_title_fixture();
    const provider_error = '400 `temperature` is deprecated for this model.';
    const llm_gateway = create_llm_gateway({
      adapter: {
        ...create_fake_llm_adapter(''),
        async generate_text(input) {
          const result = await create_fake_llm_adapter('').generate_text(input);
          return { ...result, metadata: { stop_reason: 'error', error_message: provider_error } };
        },
      },
      environment: { ANTHROPIC_API_KEY: 'test-anthropic-key' },
    });

    await set_session_title_from_prompt(fixture.db, {
      workspace_id: fixture.bootstrap.workspace_id,
      session_id: fixture.session.session_id,
      prompt_text: title_prompt_text,
      llm_gateway,
    });
    const updated_session = await get_session(
      fixture.db,
      fixture.bootstrap.workspace_id,
      fixture.session.session_id,
    );

    expect(updated_session?.session_metadata.title_generation).toMatchObject({
      source: 'fallback',
      fallback_reason: `LLM call failed: ${provider_error}`,
    });
  });
});

function create_fake_gateway(response: string) {
  return create_llm_gateway({
    adapter: create_fake_llm_adapter(response),
    environment: { OPENAI_API_KEY: 'test-openai-key' },
  });
}

async function create_title_fixture(session_title?: string, session_metadata?: SessionMetadata) {
  const db = await create_test_database();
  const bootstrap = await bootstrap_default_workspace(db);
  const session = await create_session(db, {
    workspace_id: bootstrap.workspace_id,
    agent_id: bootstrap.agent_id,
    ...(session_title === undefined ? {} : { session_title }),
    ...(session_metadata === undefined ? {} : { session_metadata }),
    actor_id: bootstrap.user_id,
  });

  return { db, bootstrap, session };
}
