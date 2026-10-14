import type { MessageContent, MessageContentPart } from '@coworker/shared';

export type ModelContextContentPolicy = {
  max_inline_text_characters: number;
  head_characters: number;
  tail_characters: number;
};

const default_model_context_content_policy: ModelContextContentPolicy = {
  max_inline_text_characters: 32_000,
  head_characters: 20_000,
  tail_characters: 8_000,
};

export function project_message_content_for_model(input: {
  run_message_id: string;
  message_role: string;
  message_content?: unknown;
  policy?: ModelContextContentPolicy;
}): MessageContent {
  const content = normalize_message_content(input.message_content);
  const policy = input.policy ?? default_model_context_content_policy;
  const projected_parts = content.parts?.flatMap((part) =>
    project_message_part(part, input, policy),
  );

  return {
    type: content.type,
    ...(typeof content.text === 'string'
      ? { text: project_inline_text(content.text, input, policy) }
      : {}),
    ...(content.data === undefined ? {} : { data: content.data }),
    ...(projected_parts === undefined || projected_parts.length === 0
      ? {}
      : { parts: projected_parts }),
  };
}

function normalize_message_content(message_content: unknown): MessageContent {
  if (message_content && typeof message_content === 'object' && !Array.isArray(message_content)) {
    return message_content as MessageContent;
  }

  return {
    type: 'text',
    text: String(message_content ?? ''),
  };
}

function project_message_part(
  part: MessageContentPart,
  input: { run_message_id: string; message_role: string },
  policy: ModelContextContentPolicy,
): MessageContentPart[] {
  if (part.type === 'text') {
    return [{ ...part, text: project_inline_text(part.text, input, policy) }];
  }

  if (part.type === 'file' && typeof part.text === 'string') {
    return [{ ...part, text: project_inline_text(part.text, input, policy) }];
  }

  return [part];
}

function project_inline_text(
  text: string,
  input: { run_message_id: string; message_role: string },
  policy: ModelContextContentPolicy,
) {
  if (text.length <= policy.max_inline_text_characters) return text;

  const head = text.slice(0, policy.head_characters).trimEnd();
  const tail = text.slice(-policy.tail_characters).trimStart();
  const omitted_characters = text.length - head.length - tail.length;

  return [head, large_text_reference(input, text.length, omitted_characters), tail]
    .filter(Boolean)
    .join('\n\n');
}

function large_text_reference(
  input: { run_message_id: string; message_role: string },
  original_characters: number,
  omitted_characters: number,
) {
  return [
    '[large_text_omitted_from_inline_model_context]',
    `run_message_id=${input.run_message_id}`,
    `message_role=${input.message_role}`,
    `original_characters=${original_characters}`,
    `omitted_characters=${omitted_characters}`,
    'Full stored text remains available through runtime-search_context-1.',
  ].join('\n');
}
