import { create_llm_gateway, type LlmGateway } from '@agent-core/llm_gateway';
import type { TriggerFieldChoiceSource } from '@coworker/core/db/schema/json_column_types';
import type { FieldChoiceCandidates } from '@runtime-platform/catalog/field_choices/field_choice_candidates';
import { field_choice_source_schema } from '@runtime-platform/catalog/field_choices/stored_field_choices';
import { z } from 'zod';

const instructions = `You map setup boxes of an app's triggers to the app's own list actions.

A box can be mapped only when a person would pick its value from a list that belongs to their own
account (a label, a calendar, a channel, a repository, a folder, a board, a project, a database).
Free text, search queries, dates, numbers, emails a person types, and yes/no are never mapped.

For each box you map, name ONE action from the list you are given, and three paths into that
action's answer, as arrays of keys:
- items_path: where the list is ("labels[]: id, name" means ["labels"]),
- value_path: inside one item, the key the box stores: an id when the box asks for an id, the
  name when the box asks for a name (a GitHub "repo" box holds the repository's name),
- label_path: inside one item, the words a person reads (a name, a title, a summary).

Only use boxes and actions from the lists below. When unsure, leave the box out.
Answer JSON only: {"aliases":[{"field":"...","action":"...","items_path":[...],"value_path":[...],"label_path":[...]}]}`;

const reply_schema = z.object({ aliases: z.array(z.unknown()) });
const alias_schema = z.object({
  field: z.string(),
  action: z.string(),
  items_path: z.array(z.string()),
  value_path: z.array(z.string()),
  label_path: z.array(z.string()),
});

export async function ask_for_field_choices(
  input: { app_display_name: string; candidates: FieldChoiceCandidates },
  gateway: LlmGateway = create_llm_gateway(),
): Promise<Record<string, TriggerFieldChoiceSource>> {
  const { candidates } = input;
  if (candidates.fields.length === 0 || candidates.actions.length === 0) return {};
  const result = await gateway.generate_object({
    use_case: 'classification',
    system_prompt: instructions,
    max_output_tokens: 2000,
    messages: [{ role: 'user', content: [{ type: 'text', text: describe_app(input) }] }],
    response_format: { type: 'json_object', schema_name: 'trigger_field_aliases' },
    parse: (value) => reply_schema.parse(value),
  });
  return keep_what_was_shown(result.object.aliases, candidates);
}

function describe_app(input: { app_display_name: string; candidates: FieldChoiceCandidates }) {
  const boxes = input.candidates.fields.map(
    (field) => `- ${field.name}${field.description ? `: ${field.description}` : ''}`,
  );
  const actions = input.candidates.actions.map(
    (action) =>
      `- ${action.node_name}${action.description ? `: ${action.description}` : ''}` +
      `\n    answer: ${action.lists.length ? action.lists.join(' ; ') : '(shape not described)'}`,
  );
  return `App: ${input.app_display_name}\n\nBoxes:\n${boxes.join('\n')}\n\nList actions:\n${actions.join('\n')}`;
}

export function keep_what_was_shown(
  aliases: unknown[],
  candidates: FieldChoiceCandidates,
): Record<string, TriggerFieldChoiceSource> {
  const fields = new Set(candidates.fields.map((field) => field.name));
  const actions = new Map(candidates.actions.map((action) => [action.node_name, action]));
  const kept: Record<string, TriggerFieldChoiceSource> = {};
  for (const raw of aliases) {
    const parsed = alias_schema.safeParse(raw);
    if (!parsed.success) continue;
    const alias = parsed.data;
    const action = actions.get(alias.action);
    if (!fields.has(alias.field) || !action || kept[alias.field]) continue;
    if (!names_the_same_thing(alias.field, action)) continue;
    const source = field_choice_source_schema.safeParse({
      action_node_name: alias.action,
      items_path: alias.items_path,
      value_path: alias.value_path,
      label_path: alias.label_path,
    });
    if (source.success) kept[alias.field] = source.data;
  }
  return kept;
}

export function names_the_same_thing(
  field: string,
  action: { node_name: string; lists: string[] },
) {
  const thing = field
    .replace(/([a-z])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .replace(/(^|_)(ids?|keys?|slugs?|names?)$/, '')
    .replace(/s$/, '')
    .split('_')
    .filter(Boolean)
    .pop();
  if (!thing || thing.length < 3) return false;
  const list_paths = action.lists.map((list) => list.split(':')[0] ?? '');
  return [action.node_name, ...list_paths].some((words) => words.toLowerCase().includes(thing));
}
