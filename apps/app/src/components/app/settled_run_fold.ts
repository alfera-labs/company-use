import type { ProjectedChatMessagePart } from '@/components/app/chat_stream_projection';
import { is_failed_tool_call, is_stopped_tool_call } from '@/components/app/tool_call_outcome';

export type SettledRunGroup =
  | { type: 'part'; part: ProjectedChatMessagePart; startIndex: number }
  | { type: 'internal'; parts: ProjectedChatMessagePart[]; startIndex: number }
  | { type: 'thought'; parts: { text: string; durationMs?: number }[]; startIndex: number };

export type SettledRunSplit<Group> = {
  folded: Group[];
  shown: Group[];
};

type SettledRunOptions = {
  fold_part?: (part: ProjectedChatMessagePart) => boolean;
};

export function split_settled_run<Group extends SettledRunGroup>(
  groups: Group[],
  options: SettledRunOptions = {},
): SettledRunSplit<Group> {
  const folded: Group[] = [];
  const shown: Group[] = [];
  for (const group of groups) {
    if (is_working_out_without_text(group, options)) {
      folded.push(group);
    } else shown.push(group);
  }
  return { folded, shown };
}

function is_working_out_without_text(group: SettledRunGroup, options: SettledRunOptions) {
  if (group.type === 'internal') return !holds_a_step_waiting_for_a_person(group.parts);
  if (group.type === 'thought') return true;
  return (
    group.type === 'part' &&
    (group.part.type === 'source' || Boolean(options.fold_part?.(group.part)))
  );
}

function holds_a_step_waiting_for_a_person(parts: ProjectedChatMessagePart[]) {
  return parts.some((part) => 'state' in part && part.state === 'awaiting_approval');
}

/** The label of a settled fold. What the turn read from memory wins over the count of steps. */
export function describe_folded_work(
  groups: SettledRunGroup[],
  memory_summary?: string | null,
  memory_source_count = 0,
) {
  const memory_words = memory_summary ?? describe_source_count(memory_source_count);
  if (memory_words) return `Worked · ${memory_words}`;
  const step_count = groups.reduce((total, group) => {
    if (group.type === 'internal') return total + group.parts.length;
    return group.type === 'part' && 'toolName' in group.part ? total + 1 : total;
  }, 0);
  const thought_ms = groups
    .filter((group) => group.type === 'thought')
    .flatMap((group) => group.parts)
    .reduce((total, part) => total + (part.durationMs ?? 0), 0);
  const failed_count = folded_tool_parts(groups).filter(is_failed_tool_call).length;
  const stopped_count = folded_tool_parts(groups).filter(is_stopped_tool_call).length;

  const pieces: string[] = [];
  if (step_count > 0) pieces.push(`${step_count} step${step_count === 1 ? '' : 's'}`);
  if (thought_ms > 0) pieces.push(`thought for ${format_thought_duration(thought_ms)}`);
  if (failed_count > 0) pieces.push(`${failed_count} failed`);
  if (stopped_count > 0) pieces.push(`${stopped_count} stopped`);
  if (pieces.length === 0) return 'Worked';
  return `Worked · ${pieces.join(' · ')}`;
}

/** The label of the same fold while the run still works. One name for one control: "Worked". */
export function describe_live_work(groups: SettledRunGroup[]) {
  const failed_count = folded_tool_parts(groups).filter(is_failed_tool_call).length;
  return failed_count > 0 ? `Worked so far · ${failed_count} failed` : 'Worked so far';
}

/** The parts of the internal runs of a fold, in order. */
export function folded_internal_parts(groups: SettledRunGroup[]) {
  return groups.flatMap((group) => (group.type === 'internal' ? group.parts : []));
}

function describe_source_count(source_count: number) {
  if (source_count === 0) return undefined;
  return `${source_count} source${source_count === 1 ? '' : 's'}`;
}

function folded_tool_parts(groups: SettledRunGroup[]) {
  return groups
    .flatMap((group) => {
      if (group.type === 'internal') return group.parts;
      return group.type === 'part' ? [group.part] : [];
    })
    .flatMap((part) =>
      'state' in part
        ? [
            {
              state: part.state,
              errorCode: 'errorCode' in part ? part.errorCode : undefined,
              errorText: 'errorText' in part ? part.errorText : undefined,
            },
          ]
        : [],
    );
}

function format_thought_duration(duration_ms: number) {
  const seconds = Math.round(duration_ms / 1000);
  if (seconds < 60) return `${Math.max(1, seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  const remaining_seconds = seconds % 60;
  return remaining_seconds === 0 ? `${minutes}m` : `${minutes}m ${remaining_seconds}s`;
}
