import node_definition from '@connectors/apps/granola/list_notes/v1/node.json' with {
  type: 'json',
};
import type { ConnectorNodeContext } from '@connectors/types';
import type { JsonSchema } from '@coworker/shared';

const notes_page_schema = node_definition.response_schema as JsonSchema;

type NotesPage = {
  notes: {
    id: string;
    title?: string | null;
    owner?: { name?: string | null; email?: string | null } | null;
    created_at: string;
    updated_at: string;
  }[];
  hasMore?: boolean | null;
  cursor?: string | null;
};

export type ListNotesInput = {
  created_after?: string;
  created_before?: string;
  updated_after?: string;
  folder_id?: string;
  cursor?: string;
  limit?: number;
};

export async function execute(input: ListNotesInput, context: ConnectorNodeContext) {
  const page = await context.send_request<NotesPage>({
    method: 'GET',
    path: '/v1/notes',
    query: {
      created_after: input.created_after,
      created_before: input.created_before,
      updated_after: input.updated_after,
      folder_id: input.folder_id,
      cursor: input.cursor,
      page_size: input.limit,
    },
    response_schema: notes_page_schema,
  });

  return {
    notes: page.notes.map((note) => ({
      id: note.id,
      title: note.title ?? null,
      owner: { name: note.owner?.name ?? null, email: note.owner?.email ?? null },
      created_at: note.created_at,
      updated_at: note.updated_at,
    })),
    next_cursor: page.cursor ?? null,
    has_more: page.hasMore ?? false,
  };
}
