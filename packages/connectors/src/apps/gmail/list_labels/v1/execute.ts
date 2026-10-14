import node_definition from '@connectors/apps/gmail/list_labels/v1/node.json' with { type: 'json' };
import type { ConnectorNodeContext } from '@connectors/types';
import type { JsonSchema } from '@coworker/shared';

export type ListLabelsInput = {
  parent_id?: string | undefined;
  query?: string | undefined;
  cursor?: string | undefined;
  limit?: number | undefined;
};

type LabelOption = {
  id: string;
  label: string;
  sublabel?: string;
  kind: string;
  selectable: boolean;
};

export type ListLabelsOutput = {
  options: LabelOption[];
  next_cursor: null;
};

const labels_list = node_definition.requests.labels_list;
const labels_list_schema = labels_list.response_schema as JsonSchema;

type GmailLabel = {
  id?: string;
  name?: string;
  type?: string;
};

type LabelsList = {
  labels?: GmailLabel[];
};

const hidden_label_ids = new Set(['CHAT']);
const hidden_label_id_prefix = 'CATEGORY_';

function is_pickable_label(label_id: string) {
  return !hidden_label_ids.has(label_id) && !label_id.startsWith(hidden_label_id_prefix);
}

function matches_query(name: string, query: string | undefined) {
  return query === undefined || name.toLowerCase().includes(query.toLowerCase());
}

function to_label_option(label: GmailLabel): LabelOption | null {
  if (!label.id || !label.name) return null;
  return {
    id: label.id,
    label: label.name,
    ...(label.type === 'system' ? { sublabel: 'System label' } : {}),
    kind: 'label',
    selectable: true,
  };
}

export async function execute(
  input: ListLabelsInput,
  context: ConnectorNodeContext,
): Promise<ListLabelsOutput> {
  const answer = await context.send_request<LabelsList>({
    method: 'GET',
    path: labels_list.path,
    response_schema: labels_list_schema,
  });

  const options = (answer.labels ?? []).flatMap((label) => {
    if (!label.id || !is_pickable_label(label.id)) return [];
    const option = to_label_option(label);
    return option && matches_query(option.label, input.query) ? [option] : [];
  });

  return { options, next_cursor: null };
}
