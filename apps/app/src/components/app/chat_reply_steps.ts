import { chat_respond_node_key } from '@coworker/shared';

type Entry = { message: { parts: { type: string; toolName?: string }[] } };

export function entries_people_see<T extends Entry>(entries: T[]): T[] {
  return entries
    .map((entry) => ({ ...entry, message: { ...entry.message, parts: shown_parts(entry) } }))
    .filter((entry) => entry.message.parts.length > 0);
}

function shown_parts(entry: Entry) {
  return entry.message.parts.filter(
    (part) => !part.type.startsWith('tool-') || part.toolName !== chat_respond_node_key,
  );
}
