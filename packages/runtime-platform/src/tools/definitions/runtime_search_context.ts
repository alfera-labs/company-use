import { list_session_messages_containing_text } from '@coworker/core/db/queries/sessions';
import { restore_run_message_tool_results } from '@runtime-platform/tools/stored_tool_result_reads';
import type { RuntimeToolDefinition } from '@runtime-platform/tools/types';
import { z } from 'zod';

const input_schema = z.object({
  query: z.string().min(1),
  max_results: z.number().int().min(1).max(20).default(8),
});

export const runtime_search_context_tool: RuntimeToolDefinition<typeof input_schema> = {
  node_key: 'runtime-search_context-1',
  node_name: 'search_context',
  display_name: 'Search context',
  description:
    'Searches the full stored history of this session: every earlier message and tool result, including ones that are no longer visible in your current context. Reach for it when the user points at something you cannot see anymore, like a decision made earlier or a file discussed before the recap. Newest matches come back first.',
  category: 'internal',
  input_schema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description:
          'Keywords likely to appear in the stored message or tool result, not a natural-language question.',
      },
      max_results: {
        type: 'number',
        description: 'Maximum number of context matches to return. Defaults to 8, capped at 20.',
      },
    },
    required: ['query'],
  },
  output_schema: {
    type: 'object',
    properties: {
      answer: { type: 'string' },
      results: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            run_message_id: { type: 'string' },
            message_role: { type: 'string' },
            message_sequence: { type: 'number' },
            snippet: { type: 'string' },
          },
        },
      },
      result_count: { type: 'number' },
      query: { type: 'string' },
    },
    required: ['answer', 'results', 'result_count', 'query'],
  },
  app_name: 'runtime',
  required_connection: false,
  runtime_handler: 'runtime.search_context',
  approval_policy: { mode: 'none' },
  metadata: { safe_for_first_milestone: true, policy_exempt: true },
  validate_input: input_schema,
  async execute(input, context) {
    if (!context) {
      return {
        success: false,
        error: {
          code: 'runtime_context_unavailable',
          message: 'runtime-search_context-1 requires a runtime execution context.',
        },
      };
    }

    const messages = await restore_run_message_tool_results(context.db, {
      workspace_id: context.workspace_id,
      rows: await list_session_messages_containing_text(context.db, {
        workspace_id: context.workspace_id,
        session_id: context.session_id,
        query: input.query,
        limit: input.max_results,
      }),
      reading: 'load_full_value',
    });
    const results = messages.map((message) => ({
      run_message_id: message.run_message_id,
      message_role: message.message_role,
      message_sequence: message.message_sequence,
      snippet: build_context_snippet(message.message_content, input.query),
    }));

    return {
      success: true,
      data: {
        answer:
          results.length === 0
            ? `No stored session messages matched "${input.query}". Retry with keywords from the original message or tool result.`
            : `Found ${results.length} stored session message${results.length === 1 ? '' : 's'} matching "${input.query}", newest first.`,
        results,
        result_count: results.length,
        query: input.query,
      },
      metadata: {
        source: 'session_message_search',
      },
    };
  },
};

function build_context_snippet(message_content: unknown, query: string) {
  const text = normalize_message_content(message_content);
  const query_index = text.toLowerCase().indexOf(query.toLowerCase());
  const center = query_index === -1 ? 0 : query_index;
  const start = Math.max(center - 180, 0);
  const end = Math.min(center + query.length + 220, text.length);
  const prefix = start > 0 ? '...' : '';
  const suffix = end < text.length ? '...' : '';
  return `${prefix}${text.slice(start, end).trim()}${suffix}`;
}

function normalize_message_content(message_content: unknown) {
  if (!message_content || typeof message_content !== 'object') {
    return String(message_content ?? '');
  }

  const content = message_content as { text?: unknown; data?: unknown; parts?: unknown };
  if (typeof content.text === 'string') return content.text;
  if (Array.isArray(content.parts)) {
    return content.parts
      .map((part) =>
        part && typeof part === 'object' && 'text' in part
          ? String((part as { text?: unknown }).text ?? '')
          : '',
      )
      .filter(Boolean)
      .join('\n');
  }
  return JSON.stringify(content.data ?? message_content);
}
