import {
  chat_tool_part_key,
  is_chat_tool_part,
  type ProjectedChatMessage,
  type ProjectedChatMessagePart,
  type ProjectedChatToolPart,
} from '@/components/app/chat_stream_projection';

export function is_same_chat_message(left: ProjectedChatMessage, right: ProjectedChatMessage) {
  return (
    left.id === right.id &&
    left.role === right.role &&
    left.run_id === right.run_id &&
    left.sent_time === right.sent_time &&
    left.sender?.source_actor_id === right.sender?.source_actor_id &&
    left.sender?.display_name === right.sender?.display_name &&
    is_same_chat_message_part_list(left.parts, right.parts)
  );
}

function is_same_chat_message_part_list(
  left: readonly ProjectedChatMessagePart[],
  right: readonly ProjectedChatMessagePart[],
) {
  if (left.length !== right.length) return false;
  return left.every((part, index) => is_same_chat_message_part(part, right[index]));
}

function is_same_chat_message_part(
  left: ProjectedChatMessagePart,
  right: ProjectedChatMessagePart | undefined,
) {
  if (!right || left.type !== right.type) return false;
  if (is_chat_tool_part(left)) {
    return is_chat_tool_part(right) && is_same_chat_tool_part(left, right);
  }
  if (left.type === 'text') {
    return right.type === 'text' && left.text === right.text;
  }
  if (left.type === 'image') {
    return right.type === 'image' && left.dataUrl === right.dataUrl && left.name === right.name;
  }
  if (left.type === 'file') {
    return (
      right.type === 'file' &&
      left.fileId === right.fileId &&
      left.name === right.name &&
      left.mimeType === right.mimeType &&
      left.isInlineText === right.isInlineText
    );
  }
  if (left.type === 'reasoning') {
    return (
      right.type === 'reasoning' &&
      left.text === right.text &&
      left.state === right.state &&
      left.durationMs === right.durationMs
    );
  }
  if (left.type === 'source') {
    return (
      right.type === 'source' &&
      left.sourceId === right.sourceId &&
      left.title === right.title &&
      left.citationText === right.citationText
    );
  }
  return (
    right.type === 'artifact' &&
    left.artifactId === right.artifactId &&
    left.title === right.title &&
    left.kind === right.kind
  );
}

function is_same_chat_tool_part(left: ProjectedChatToolPart, right: ProjectedChatToolPart) {
  return (
    chat_tool_part_key(left) === chat_tool_part_key(right) &&
    left.toolName === right.toolName &&
    left.state === right.state &&
    left.errorCode === right.errorCode &&
    left.errorText === right.errorText &&
    left.durationMs === right.durationMs &&
    left.input === right.input &&
    left.output === right.output &&
    left.outputText === right.outputText &&
    is_same_chat_tool_display(left.display, right.display)
  );
}

function is_same_chat_tool_display(
  left: ProjectedChatToolPart['display'],
  right: ProjectedChatToolPart['display'],
) {
  return (
    left?.appId === right?.appId &&
    left?.appName === right?.appName &&
    left?.iconUrl === right?.iconUrl &&
    left?.title === right?.title &&
    left?.subtitle === right?.subtitle
  );
}
