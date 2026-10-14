import { require_owned_api_session } from '@api/services/sessions_api/session_reads';
import type { Database } from '@coworker/core/db/connection';
import type { ApiKey } from '@coworker/core/db/queries/api_keys';
import { type HeldToolCall, list_held_tool_calls } from '@coworker/core/db/queries/held_tool_calls';
import { z } from 'zod';

const input_preview_max_characters = 600;
const catalog_transport_tool_name = 'runtime-execute_tool-1';
const catalog_call_schema = z.strictObject({
  node_key: z.string().min(1),
  input: z.unknown(),
  connection_id: z.string().optional(),
  output_fields: z.array(z.string()).optional(),
});

export type SessionHeldToolCall = {
  tool_use_id: string;
  tool: string;
  input_preview: string;
  question: string | null;
};

/** What a session is waiting on a person to allow or deny, in the words confirm_tool takes. */
export async function read_session_held_tool_calls(
  db: Database,
  api_key: ApiKey,
  session_id: string,
): Promise<SessionHeldToolCall[]> {
  await require_owned_api_session(db, api_key, session_id);
  const held = await list_held_tool_calls(db, { workspace_id: api_key.workspace_id, session_id });
  return held.map(describe_held_tool_call);
}

function describe_held_tool_call(call: HeldToolCall): SessionHeldToolCall {
  const catalog_call =
    call.tool_name === catalog_transport_tool_name
      ? catalog_call_schema.safeParse(call.input_data)
      : null;
  const tool = catalog_call?.success ? catalog_call.data.node_key : call.tool_name;
  const input = catalog_call?.success ? (catalog_call.data.input ?? {}) : (call.input_data ?? {});
  return {
    tool_use_id: call.tool_call_id,
    tool,
    input_preview: JSON.stringify(input).slice(0, input_preview_max_characters),
    question: call.question,
  };
}
