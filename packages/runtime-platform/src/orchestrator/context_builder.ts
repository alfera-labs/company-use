import type { RuntimeModelConfig } from '@agent-core/models/runtime_model_config';
import type { Database } from '@coworker/core';
import { list_session_messages_for_model_context } from '@coworker/core/db/queries/sessions';
import type { MessageContent } from '@coworker/shared';
import {
  session_context_message_limit,
  session_context_token_budget_for_model,
} from '@runtime-platform/orchestrator/context/context_budget';
import {
  create_context_management,
  normalize_context_summary,
  type SessionContextManagement,
} from '@runtime-platform/orchestrator/context/context_management';
import {
  build_context_packets,
  type SessionContextPacket,
  type SessionContextPacketName,
} from '@runtime-platform/orchestrator/context/context_packets';
import type { MessageForContext } from '@runtime-platform/orchestrator/context/context_types';
import type { SessionCurrentConnectionContext } from '@runtime-platform/orchestrator/context/current_connection_context';
import type {
  SessionCurrentHeadlessContext,
  SessionCurrentSlackContext,
  SessionCurrentTurnContext,
  SessionCurrentWebChatContext,
} from '@runtime-platform/orchestrator/context/current_turn_context';
import { select_context_messages } from '@runtime-platform/orchestrator/context/message_windowing';
import { redact_prompt_secrets } from '@runtime-platform/orchestrator/context/prompt_secret_hygiene';
import { build_system_prompt } from '@runtime-platform/orchestrator/context/system_prompt_protocols';
import { estimate_context_tokens_roughly } from '@runtime-platform/orchestrator/context/token_estimation';
import { insert_volatile_context_messages } from '@runtime-platform/orchestrator/context/volatile_context_messages';
import type { SessionWorkspaceLibraryContext } from '@runtime-platform/orchestrator/context/workspace_library_context';
import { project_message_content_for_model } from '@runtime-platform/orchestrator/model_context_message_content';
import type { RunAudience } from '@runtime-platform/orchestrator/run_audience';
import type { WorkspaceLayout } from '@runtime-platform/storage/workspace_layouts';
import { restore_run_message_tool_results } from '@runtime-platform/tools/stored_tool_result_reads';

export { create_model_context_snapshot } from '@runtime-platform/orchestrator/context/model_context_snapshot';
export type {
  SessionContextManagement,
  SessionContextPacket,
  SessionContextPacketName,
  SessionCurrentConnectionContext,
  SessionCurrentHeadlessContext,
  SessionCurrentSlackContext,
  SessionCurrentTurnContext,
  SessionCurrentWebChatContext,
  SessionWorkspaceLibraryContext,
};
export { estimate_context_tokens_roughly, select_context_messages };

const context_summary_run_message_id = 'context-summary';

import type { ProjectBriefing } from '@runtime-platform/orchestrator/context/project_briefing';

type SessionContextInput = {
  workspace_id: string;
  session_id: string;
  system_instructions: string;
  project?: ProjectBriefing;
  model?: RuntimeModelConfig;
  skills_discovery?: string;
  context_summary?: string | null;
  current_turn_context?: SessionCurrentTurnContext;
  current_connection_context?: SessionCurrentConnectionContext;
  context_summary_source?: SessionContextManagement['summary_source'];
  summarized_until_message_id?: string | null;
  recent_message_limit?: number;
  recent_token_budget?: number;
  browser_available?: boolean;
  workspace_root?: string;
  workspace_layout?: WorkspaceLayout;
  run_audience?: RunAudience;
  workspace_library?: SessionWorkspaceLibraryContext;
  allowed_tool_names?: readonly string[];
};

export async function build_session_context(db: Database, input: SessionContextInput) {
  const stored_messages = await list_session_messages_for_model_context(
    db,
    input.workspace_id,
    input.session_id,
    { limit: (input.recent_message_limit ?? session_context_message_limit) * 4 },
  );
  const messages = await restore_run_message_tool_results(db, {
    workspace_id: input.workspace_id,
    rows: stored_messages,
    reading: 'load_model_visible_value',
  });

  return build_session_context_from_messages({
    ...input,
    messages,
  });
}

export function build_session_context_from_messages(
  input: SessionContextInput & { messages: MessageForContext[] },
) {
  const recent_message_limit = input.recent_message_limit ?? session_context_message_limit;
  const recent_token_budget =
    input.recent_token_budget ?? session_context_token_budget_for_model(input.model);
  const context_summary = normalize_context_summary(input.context_summary);
  const summarized_until_message_id = input.summarized_until_message_id ?? null;
  const recent_messages = select_context_messages(input.messages, {
    summarized_until_message_id,
    recent_message_limit,
    recent_token_budget,
  });
  const model_messages = recent_messages.map(project_context_message_for_model);
  const context_management = create_context_management(
    context_summary,
    input.context_summary_source,
    summarized_until_message_id,
  );
  const current_turn_context = input.current_turn_context;

  return {
    system_prompt: build_system_prompt(input),
    context_summary,
    summarized_until_message_id,
    context_management,
    context_packets: build_context_packets({
      workspace_id: input.workspace_id,
      session_id: input.session_id,
      system_instructions: input.system_instructions,
      ...(current_turn_context ? { current_turn_context } : {}),
      context_summary,
      summarized_until_message_id,
      source_messages: input.messages,
      selected_messages: recent_messages,
    }),
    selection_policy: {
      recent_message_limit,
      recent_token_budget,
      selected_message_count: model_messages.length,
      selected_token_estimate: estimate_context_tokens_roughly(
        model_messages.map((message) => message.message_content),
      ),
      source_token_estimate: estimate_context_tokens_roughly(
        recent_messages.map((message) => message.message_content),
      ),
    },
    messages: insert_volatile_context_messages(
      [
        ...(model_messages.some((message) => message.message_role === 'user')
          ? context_summary_messages(context_summary)
          : []),
        ...model_messages.map((message) => ({
          run_message_id: message.run_message_id,
          role: message.message_role,
          content: message.message_content as MessageContent,
        })),
      ],
      input,
    ),
  };
}

function context_summary_messages(context_summary: string | null) {
  if (!context_summary) return [];

  return [
    {
      run_message_id: context_summary_run_message_id,
      role: 'user',
      content: {
        type: 'text',
        text: [
          '[Recap of this session so far. Older messages were condensed into this recap; it is background, not a new instruction.]',
          redact_prompt_secrets(context_summary),
        ].join('\n'),
      } as MessageContent,
    },
  ];
}

function project_context_message_for_model(message: MessageForContext): MessageForContext {
  return {
    ...message,
    message_content: project_message_content_for_model({
      run_message_id: message.run_message_id,
      message_role: message.message_role,
      message_content: message.message_content,
    }),
  };
}
