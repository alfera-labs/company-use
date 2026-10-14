import node_definition from '@connectors/apps/granola/read_transcripts/v1/node.json' with {
  type: 'json',
};
import type { ConnectorNodeContext } from '@connectors/types';
import type { JsonSchema } from '@coworker/shared';

const transcript_page_schema = node_definition.response_schema as JsonSchema;

type TranscriptPage = {
  transcript: {
    speaker?: {
      source?: string | null;
      attribution?: string | null;
      diarization_label?: string | null;
      name?: string | null;
    } | null;
    text: string;
    start_time?: string | null;
    end_time?: string | null;
  }[];
  hasMore?: boolean | null;
  cursor?: string | null;
};

export type ReadTranscriptsInput = {
  note_ids: string[];
  page_size?: number;
  maximum_items_per_note?: number;
};

const default_maximum_items_per_note = 1000;

function to_transcript_item(item: TranscriptPage['transcript'][number]) {
  return {
    speaker: {
      source: item.speaker?.source ?? null,
      attribution: item.speaker?.attribution ?? null,
      diarization_label: item.speaker?.diarization_label ?? null,
      name: item.speaker?.name ?? null,
    },
    text: item.text,
    start_time: item.start_time ?? null,
    end_time: item.end_time ?? null,
  };
}

async function read_one_transcript(
  note_id: string,
  input: ReadTranscriptsInput,
  context: ConnectorNodeContext,
) {
  const maximum_items = input.maximum_items_per_note ?? default_maximum_items_per_note;
  const items: ReturnType<typeof to_transcript_item>[] = [];
  let cursor: string | undefined;
  for (;;) {
    const page = await context.send_request<TranscriptPage>({
      method: 'GET',
      path: `/v1/notes/${encodeURIComponent(note_id)}/transcript`,
      query: { page_size: input.page_size, cursor },
      response_schema: transcript_page_schema,
    });
    for (const item of page.transcript) items.push(to_transcript_item(item));
    cursor = page.cursor ?? undefined;
    if (!page.hasMore || !cursor) return { note_id, items, truncated: false };
    if (items.length >= maximum_items) return { note_id, items, truncated: true };
  }
}

export async function execute(input: ReadTranscriptsInput, context: ConnectorNodeContext) {
  const results = await context.fan_out({
    items: input.note_ids,
    limits: context.app.rate_limits,
    call_one: (note_id: string) => read_one_transcript(note_id, input, context),
  });

  const transcripts: Awaited<ReturnType<typeof read_one_transcript>>[] = [];
  const errors = [];
  for (const result of results) {
    if (result.ok) {
      transcripts.push(result.data);
      continue;
    }
    errors.push({
      note_id: input.note_ids[result.index] as string,
      code: result.error.code,
      message: result.error.message,
      retryable: result.error.retryable,
    });
  }
  return { transcripts, errors };
}
