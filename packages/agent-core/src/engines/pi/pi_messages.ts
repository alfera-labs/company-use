import { image_part_for_model } from '@agent-core/engines/pi/pi_image_content';
import { get_pi_runtime_provider_name } from '@agent-core/engines/pi/pi_model';
import { cap_tool_result_text_parts } from '@agent-core/engines/pi/pi_tools';
import type {
  RuntimeAgentMessage,
  RuntimeAgentMessagePart,
} from '@agent-core/messages/runtime_message';
import type { RuntimeModelConfig } from '@agent-core/models/runtime_model_config';
import type {
  AssistantMessage,
  ImageContent,
  Message as PiMessage,
  TextContent,
  ThinkingContent,
  ToolCall,
  ToolResultMessage,
  Usage,
  UserMessage,
} from '@earendil-works/pi-ai';

export function runtime_messages_to_pi_messages(
  messages: readonly RuntimeAgentMessage[],
): PiMessage[] {
  return messages.flatMap((message) => {
    const mapped = runtime_message_to_pi_message(message);
    return mapped ? [mapped] : [];
  });
}

export function runtime_message_to_pi_message(message: RuntimeAgentMessage): PiMessage | undefined {
  const content = runtime_message_content_to_pi_user_content(message.content);
  const timestamp = Number(message.metadata?.timestamp ?? Date.now());

  if (message.role === 'user' || message.role === 'system') {
    return {
      role: 'user',
      content,
      timestamp,
    } satisfies UserMessage;
  }

  if (message.role === 'tool') {
    return {
      role: 'toolResult',
      toolCallId: message.tool_call_id ?? read_tool_call_id(message.content),
      toolName: message.name ?? read_tool_name(message.content),
      content: runtime_message_content_to_pi_tool_result_content(message.content),
      details: read_tool_details(message.content),
      isError: read_tool_result_is_error(message.content),
      timestamp,
    } satisfies ToolResultMessage;
  }

  return {
    role: 'assistant',
    content: runtime_message_content_to_pi_assistant_content(message.content),
    api: String(message.metadata?.api ?? 'runtime'),
    provider: String(message.metadata?.provider ?? 'runtime'),
    model: String(message.metadata?.model ?? 'runtime'),
    usage: message.metadata?.usage ?? empty_usage(),
    stopReason: 'stop',
    timestamp,
  } satisfies AssistantMessage;
}

export function pi_assistant_message_to_runtime_message(
  message: AssistantMessage,
  model: RuntimeModelConfig,
): RuntimeAgentMessage | undefined {
  const content = message.content.flatMap(pi_assistant_content_to_runtime_part);

  if (content.length === 0) return undefined;

  return {
    role: 'assistant',
    content,
    metadata: {
      engine_name: 'pi',
      mode: 'provider',
      api: message.api,
      provider: get_pi_runtime_provider_name(model),
      model_provider: model.model_provider,
      model_proxy: model.model_proxy ?? model.model_provider,
      model: model.model_name,
      response_model: message.responseModel ?? message.model,
      stop_reason: message.stopReason,
      usage: message.usage,
    },
  };
}

export function runtime_message_content_to_text(content: readonly RuntimeAgentMessagePart[]) {
  return content
    .map((part) => {
      if (part.type === 'text') return part.text;
      if (part.type === 'json') return JSON.stringify(part.json);
      if (part.type === 'image') return `[image:${part.mime_type}]`;
      if (part.type === 'file') return runtime_file_part_to_text(part);
      if (part.type === 'thinking') return part.redacted ? '[thinking:redacted]' : part.thinking;
      if (part.type === 'tool_call')
        return JSON.stringify({
          tool_call_id: part.id,
          tool_name: part.name,
          arguments: part.arguments,
        });
      return stringify_runtime_tool_result(part);
    })
    .join('\n')
    .trim();
}

export function runtime_message_content_to_pi_user_content(
  content: readonly RuntimeAgentMessagePart[],
): UserMessage['content'] {
  const parts: Array<TextContent | ImageContent> = [];

  for (const part of content) {
    if (part.type === 'text') {
      if (part.text) parts.push({ type: 'text', text: part.text });
      continue;
    }

    if (part.type === 'image') {
      parts.push(image_part_for_model(part.data, part.mime_type));
      continue;
    }

    const text = runtime_message_part_to_model_text(part);
    if (text) parts.push({ type: 'text', text });
  }

  if (parts.every((part) => part.type === 'text')) {
    return parts
      .map((part) => part.text)
      .join('\n')
      .trim();
  }

  return parts;
}

function runtime_message_content_to_pi_tool_result_content(
  content: readonly RuntimeAgentMessagePart[],
): ToolResultMessage['content'] {
  const parts: ToolResultMessage['content'] = [];

  for (const part of content) {
    if (part.type === 'image') {
      parts.push(image_part_for_model(part.data, part.mime_type));
      continue;
    }

    if (part.type === 'tool_result' && part.result.content) {
      for (const content_part of part.result.content) {
        if (content_part.type === 'image') {
          parts.push(image_part_for_model(content_part.data, content_part.mime_type));
        } else {
          parts.push({ type: 'text', text: content_part.text });
        }
      }
      continue;
    }

    const text = runtime_message_part_to_model_text(part);
    if (text) parts.push({ type: 'text', text });
  }

  return cap_tool_result_text_parts(parts.length === 0 ? [{ type: 'text', text: '' }] : parts);
}

function runtime_message_content_to_pi_assistant_content(
  content: readonly RuntimeAgentMessagePart[],
): AssistantMessage['content'] {
  const parts: AssistantMessage['content'] = [];

  for (const part of content) {
    if (part.type === 'text') {
      parts.push({
        type: 'text',
        text: part.text,
        ...(part.text_signature === undefined ? {} : { textSignature: part.text_signature }),
      });
      continue;
    }

    if (part.type === 'thinking') {
      parts.push({
        type: 'thinking',
        thinking: part.thinking,
        ...(part.signature === undefined ? {} : { thinkingSignature: part.signature }),
        ...(part.redacted === undefined ? {} : { redacted: part.redacted }),
      });
      continue;
    }

    if (part.type === 'tool_call') {
      parts.push({
        type: 'toolCall',
        id: part.id,
        name: part.name,
        arguments: part.arguments,
        ...(part.thought_signature === undefined
          ? {}
          : { thoughtSignature: part.thought_signature }),
      });
    }
  }

  if (parts.length > 0) return parts;
  return [{ type: 'text', text: runtime_message_content_to_text(content) }];
}

function runtime_message_part_to_model_text(part: RuntimeAgentMessagePart) {
  if (part.type === 'text') return part.text;
  if (part.type === 'json') return JSON.stringify(part.json);
  if (part.type === 'file') return runtime_file_part_to_text(part);
  if (part.type === 'thinking') return part.redacted ? '[thinking:redacted]' : part.thinking;
  if (part.type === 'tool_call') {
    return JSON.stringify({
      tool_call_id: part.id,
      tool_name: part.name,
      arguments: part.arguments,
    });
  }
  if (part.type === 'tool_result') return stringify_runtime_tool_result(part);
  return '';
}

function runtime_file_part_to_text(part: Extract<RuntimeAgentMessagePart, { type: 'file' }>) {
  return [
    '[file]',
    part.name ? `name=${part.name}` : undefined,
    part.mime_type ? `mime_type=${part.mime_type}` : undefined,
    part.path ? `path=${part.path}` : undefined,
    part.url ? `url=${part.url}` : undefined,
    part.file_id ? `file_id=${part.file_id}` : undefined,
    part.text,
  ]
    .filter(Boolean)
    .join(' ');
}

function pi_assistant_content_to_runtime_part(
  part: AssistantMessage['content'][number],
): RuntimeAgentMessagePart[] {
  if (part.type === 'text') {
    const text = (part as TextContent).text;
    if (!text) return [];
    return [
      {
        type: 'text',
        text,
        ...((part as TextContent).textSignature === undefined
          ? {}
          : { text_signature: (part as TextContent).textSignature }),
      },
    ];
  }

  if (part.type === 'thinking') {
    const thinking_part = part as ThinkingContent;
    return [
      {
        type: 'thinking',
        thinking: thinking_part.thinking,
        ...(thinking_part.thinkingSignature === undefined
          ? {}
          : { signature: thinking_part.thinkingSignature }),
        ...(thinking_part.redacted === undefined ? {} : { redacted: thinking_part.redacted }),
      },
    ];
  }

  const tool_call = part as ToolCall;
  return [
    {
      type: 'tool_call',
      id: tool_call.id,
      name: tool_call.name,
      arguments: tool_call.arguments,
      ...(tool_call.thoughtSignature === undefined
        ? {}
        : { thought_signature: tool_call.thoughtSignature }),
    },
  ];
}

function stringify_runtime_tool_result(
  part: Extract<RuntimeAgentMessagePart, { type: 'tool_result' }>,
) {
  const content_text = part.result.content
    ?.map((content_part) =>
      content_part.type === 'text' ? content_part.text : `[image:${content_part.mime_type}]`,
    )
    .join('\n')
    .trim();
  if (content_text) return content_text;

  if (part.result.ok) {
    return part.result.content_text ?? JSON.stringify(part.result.content_json ?? part.result);
  }

  return part.result.error_message;
}

function read_tool_call_id(content: readonly RuntimeAgentMessagePart[]) {
  const part = content.find((candidate) => candidate.type === 'tool_result');
  return part?.type === 'tool_result'
    ? (part.tool_call_id ?? 'runtime_tool_result')
    : 'runtime_tool_result';
}

function read_tool_name(content: readonly RuntimeAgentMessagePart[]) {
  const part = content.find((candidate) => candidate.type === 'tool_result');
  return part?.type === 'tool_result' ? (part.tool_name ?? 'runtime_tool') : 'runtime_tool';
}

function read_tool_details(content: readonly RuntimeAgentMessagePart[]) {
  const part = content.find((candidate) => candidate.type === 'tool_result');
  return part?.type === 'tool_result' ? part.result : {};
}

function read_tool_result_is_error(content: readonly RuntimeAgentMessagePart[]) {
  const part = content.find((candidate) => candidate.type === 'tool_result');
  return part?.type === 'tool_result' ? !part.result.ok : false;
}

export function empty_usage(): Usage {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      total: 0,
    },
  };
}
