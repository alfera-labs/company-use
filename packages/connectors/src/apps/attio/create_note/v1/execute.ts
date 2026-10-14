import node_definition from '@connectors/apps/attio/create_note/v1/node.json' with { type: 'json' };
import type { ConnectorNodeContext } from '@connectors/types';
import type { JsonSchema } from '@coworker/shared';

const note_response_schema = node_definition.response_schema as JsonSchema;

export type CreateNoteInput = {
  object: string;
  record_id: string;
  content: string;
  title?: string;
};

type AttioNoteResponse = {
  data: {
    id: { workspace_id: string; note_id: string };
    parent_object: string;
    parent_record_id: string;
    title?: string | null;
    content_plaintext?: string | null;
    created_at?: string | null;
  };
};

export async function execute(input: CreateNoteInput, context: ConnectorNodeContext) {
  const title = input.title?.trim() || first_line(input.content);
  const response = await context.send_request<AttioNoteResponse>({
    method: 'POST',
    path: '/v2/notes',
    body: {
      data: {
        parent_object: input.object,
        parent_record_id: input.record_id,
        title,
        format: 'plaintext',
        content: input.content,
      },
    },
    response_schema: note_response_schema,
  });
  const note = response.data;
  return {
    note_id: note.id.note_id,
    object: note.parent_object,
    record_id: note.parent_record_id,
    title: note.title ?? title,
    content: note.content_plaintext ?? input.content,
    created_at: note.created_at ?? null,
  };
}

function first_line(content: string) {
  return content.trim().split('\n')[0]?.trim().slice(0, 200) || 'Note';
}
