import { create_llm_gateway, type LlmGateway, type LlmObjectResult } from '@agent-core/llm_gateway';
import type { Database } from '@coworker/core';
import { get_session, replace_placeholder_session_title } from '@coworker/core/db/queries/sessions';
import { create_logger, format_error_message } from '@coworker/shared';
import {
  build_session_title_messages,
  collapse_spaces,
  fallback_session_title_from_messages,
  normalize_generated_session_title,
  type SessionTitleConversationMessage,
  session_title_system_prompt,
} from '@runtime-platform/orchestrator/session_title_prompt';

const log = create_logger('session_title');
const title_actor_id = 'system:session_title';

export type SessionTitleFromPromptInput = {
  workspace_id: string;
  session_id: string;
  agent_id?: string;
  actor_id?: string;
  prompt_text: string;
  llm_gateway?: LlmGateway;
};

export type SessionTitleResult =
  | { status: 'updated'; title: string; source: 'llm' | 'fallback' }
  | { status: 'skipped'; reason: string };

type TitleObject = {
  title: string;
};

export async function set_session_title_from_prompt(
  db: Database,
  input: SessionTitleFromPromptInput,
): Promise<SessionTitleResult> {
  try {
    return await title_the_session(db, input);
  } catch (error) {
    log.warn('naming the chat failed', {
      workspace_id: input.workspace_id,
      session_id: input.session_id,
      error: format_error_message(error, 'session_title_write_failed'),
    });
    return { status: 'skipped', reason: format_error_message(error, 'session_title_write_failed') };
  }
}

async function title_the_session(
  db: Database,
  input: SessionTitleFromPromptInput,
): Promise<SessionTitleResult> {
  const session = await get_session(db, input.workspace_id, input.session_id);
  if (!session) return { status: 'skipped', reason: 'session_missing' };

  if (session.session_metadata.title_generation?.source !== 'placeholder') {
    return { status: 'skipped', reason: 'custom_title' };
  }

  const messages = title_messages_from_prompt(input.prompt_text);
  if (!messages.length) return { status: 'skipped', reason: 'prompt_text_missing' };

  const generated_title = await generate_session_title(input, messages);
  const updated_session = await replace_placeholder_session_title(db, {
    workspace_id: input.workspace_id,
    session_id: input.session_id,
    title: generated_title.title,
    title_generation: title_generation_metadata(generated_title),
    actor_id: input.actor_id ?? title_actor_id,
  });

  if (!updated_session) return { status: 'skipped', reason: 'title_changed' };
  return {
    status: 'updated',
    title: updated_session.session_title ?? generated_title.title,
    source: generated_title.source,
  };
}

function title_messages_from_prompt(prompt_text: string): SessionTitleConversationMessage[] {
  const text = collapse_spaces(prompt_text);
  return text ? [{ role: 'user', text }] : [];
}

async function generate_session_title(
  input: SessionTitleFromPromptInput,
  messages: SessionTitleConversationMessage[],
) {
  try {
    const result = await call_title_gateway(input, messages);
    const title = normalize_generated_session_title(result.object.title);
    if (title) return { title, source: 'llm' as const, result };
    return fallback_title(messages, 'invalid_llm_title');
  } catch (error) {
    return fallback_title(messages, format_error_message(error, 'session_title_write_failed'));
  }
}

async function call_title_gateway(
  input: SessionTitleFromPromptInput,
  messages: SessionTitleConversationMessage[],
): Promise<LlmObjectResult<TitleObject>> {
  const llm_gateway = input.llm_gateway ?? create_llm_gateway();
  return llm_gateway.generate_object<TitleObject>({
    use_case: 'session_title',
    workspace_id: input.workspace_id,
    session_id: input.session_id,
    ...(input.agent_id === undefined ? {} : { agent_id: input.agent_id }),
    system_prompt: session_title_system_prompt,
    messages: build_session_title_messages(messages),
    response_format: { type: 'json_object', schema_name: 'session_title' },
    temperature: 0.2,
  });
}

function fallback_title(messages: SessionTitleConversationMessage[], reason: string) {
  return {
    title: fallback_session_title_from_messages(messages),
    source: 'fallback' as const,
    reason,
  };
}

function title_generation_metadata(
  generated_title: Awaited<ReturnType<typeof generate_session_title>>,
) {
  return {
    source: generated_title.source,
    generated_time: new Date().toISOString(),
    ...(generated_title.source === 'llm' ? llm_title_metadata(generated_title.result) : {}),
    ...(generated_title.source === 'fallback' ? { fallback_reason: generated_title.reason } : {}),
  };
}

function llm_title_metadata(result: LlmObjectResult<TitleObject>) {
  return {
    model: result.result.model,
    usage: result.result.usage,
  };
}
