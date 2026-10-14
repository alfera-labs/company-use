import {
  is_chat_tool_part,
  type ProjectedChatMessagePart,
} from '@/components/app/chat_stream_projection';

/**
 * The text parts of one run that are notes the coworker wrote while it worked: a tool call comes
 * after the note, and more text comes after that tool call. Such a note belongs with the steps of
 * the work. The last text of a run is its answer and is never a note, so an answer that is only
 * followed by a tool call stays an answer.
 */
export function mid_run_note_parts(parts: readonly ProjectedChatMessagePart[]) {
  const notes = new Set<ProjectedChatMessagePart>();
  let text_comes_later = false;
  let work_and_then_text_come_later = false;
  for (const part of [...parts].reverse()) {
    if (is_chat_tool_part(part)) work_and_then_text_come_later ||= text_comes_later;
    if (part.type !== 'text' || !part.text.trim()) continue;
    if (work_and_then_text_come_later) notes.add(part);
    text_comes_later = true;
  }
  return notes;
}
