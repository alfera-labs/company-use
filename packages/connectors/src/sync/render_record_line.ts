import { format_line, to_epoch_ms } from '@connectors/sync/format_line';
import {
  apply_text_resolvers,
  type ConnectorPersonDirectory,
} from '@connectors/sync/resolve_record_text';
import type { ConnectorSyncLine, ConnectorSyncTextResolver } from '@connectors/sync_types';
import { evaluate_value_expression, type ValueScope } from '@connectors/value_expression';

export const record_index_cap = 500;

export type LineParticipant = { id: string | null; name: string };

export type LineRecordIndexEntry = {
  external_id: string;
  ts: string | undefined;
  author_id: string | null;
};

export type RenderedRecordLine = {
  text: string;
  unresolved: number;
  participants: LineParticipant[];
  record_index_entry: LineRecordIndexEntry;
};

export type RecordLineInput = {
  item: unknown;
  content: unknown;
  external_id: string;
  cursor_value?: string;
};

export function resolve_line_author(
  raw_author: string,
  resolvers: readonly ConnectorSyncTextResolver[],
  people: ConnectorPersonDirectory,
) {
  const direct_hit = people.get(raw_author);
  if (direct_hit?.display_name) return { text: direct_hit.display_name, unresolved: 0 };
  return apply_text_resolvers(raw_author, resolvers, people);
}

function read_raw_marker(value: unknown): string | undefined {
  return value === undefined || value === null ? undefined : String(value);
}

function is_element_array(value: unknown): value is Record<string, unknown>[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every(
      (element) => typeof element === 'object' && element !== null && !Array.isArray(element),
    )
  );
}

type RenderedElementLine = { line: string; unresolved: number; author: LineParticipant };

function render_element_line(
  recipe: ConnectorSyncLine,
  resolvers: readonly ConnectorSyncTextResolver[],
  people: ConnectorPersonDirectory,
  element: Record<string, unknown>,
): RenderedElementLine {
  const scope: ValueScope = { item: element };
  const raw_author = String(evaluate_value_expression(recipe.author, scope) ?? '');
  const author = resolve_line_author(raw_author, resolvers, people);
  const raw_time = recipe.time ? evaluate_value_expression(recipe.time, scope) : undefined;
  const raw_text = recipe.text ? evaluate_value_expression(recipe.text, scope) : undefined;
  const text_resolution = apply_text_resolvers(String(raw_text ?? ''), resolvers, people);
  return {
    line: format_line(author.text, to_epoch_ms(raw_time), text_resolution.text),
    unresolved: author.unresolved + text_resolution.unresolved,
    author: { id: raw_author || null, name: author.text },
  };
}

function dedupe_participants(participants: readonly LineParticipant[]): LineParticipant[] {
  const by_key = new Map<string, LineParticipant>();
  for (const participant of participants) {
    const key = participant.id ?? participant.name;
    if (key.length === 0) continue;
    if (!by_key.has(key)) by_key.set(key, participant);
  }
  return [...by_key.values()];
}

function render_element_array_record(
  recipe: ConnectorSyncLine,
  resolvers: readonly ConnectorSyncTextResolver[],
  people: ConnectorPersonDirectory,
  elements: readonly Record<string, unknown>[],
  top_author: { text: string; unresolved: number },
  top_participant: LineParticipant,
  record_index_entry: LineRecordIndexEntry,
): RenderedRecordLine {
  const rendered_elements = elements.map((element) =>
    render_element_line(recipe, resolvers, people, element),
  );
  const elements_unresolved = rendered_elements.reduce((sum, one) => sum + one.unresolved, 0);
  return {
    text: rendered_elements.map((one) => one.line).join('\n'),
    unresolved: top_author.unresolved + elements_unresolved,
    participants: dedupe_participants([
      top_participant,
      ...rendered_elements.map((one) => one.author),
    ]),
    record_index_entry,
  };
}

function to_plain_text(content: unknown): string {
  if (Array.isArray(content)) return content.map((entry) => String(entry ?? '')).join('\n');
  return String(content ?? '');
}

export function render_record_line(
  recipe: ConnectorSyncLine,
  resolvers: readonly ConnectorSyncTextResolver[],
  people: ConnectorPersonDirectory,
  input: RecordLineInput,
): RenderedRecordLine {
  const top_scope: ValueScope = { item: input.item };
  const raw_top_author = String(evaluate_value_expression(recipe.author, top_scope) ?? '');
  const top_author = resolve_line_author(raw_top_author, resolvers, people);
  const raw_top_time = recipe.time ? evaluate_value_expression(recipe.time, top_scope) : undefined;
  const top_participant: LineParticipant = { id: raw_top_author || null, name: top_author.text };
  const record_index_entry: LineRecordIndexEntry = {
    external_id: input.external_id,
    ts: read_raw_marker(raw_top_time) ?? input.cursor_value,
    author_id: raw_top_author || null,
  };

  if (is_element_array(input.content)) {
    return render_element_array_record(
      recipe,
      resolvers,
      people,
      input.content,
      top_author,
      top_participant,
      record_index_entry,
    );
  }

  const text_resolution = apply_text_resolvers(to_plain_text(input.content), resolvers, people);
  return {
    text: format_line(top_author.text, to_epoch_ms(raw_top_time), text_resolution.text),
    unresolved: top_author.unresolved + text_resolution.unresolved,
    participants: [top_participant],
    record_index_entry,
  };
}

export function collect_line_participants(
  records: readonly RenderedRecordLine[],
): LineParticipant[] {
  return dedupe_participants(records.flatMap((record) => record.participants));
}

export function collect_record_index(
  records: readonly RenderedRecordLine[],
): LineRecordIndexEntry[] {
  return records.slice(0, record_index_cap).map((record) => record.record_index_entry);
}
