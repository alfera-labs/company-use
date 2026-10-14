import { type BrainTool, define_brain_tool } from '@api/routes/brain/brain_tool';
import {
  format_session_files_for_mcp,
  format_session_for_mcp,
  format_session_snapshot_for_mcp,
  format_session_wait_for_mcp,
} from '@api/routes/brain/mcp_outputs';
import { create_session_description } from '@api/routes/brain/mcp_server_words';
import {
  reads_the_workspace,
  starts_agent_work_that_cannot_be_unsent,
} from '@api/routes/brain/mcp_tool_annotations';
import {
  text_block_schema,
  tool_confirmation_event_schema,
} from '@api/routes/public_session_events';
import { create_session_body_schema } from '@api/routes/public_sessions';
import { send_api_session_events } from '@api/services/sessions_api/session_event_writes';
import { list_api_session_files } from '@api/services/sessions_api/session_files';
import { create_api_session } from '@api/services/sessions_api/session_service';
import {
  default_session_wait_seconds,
  max_session_wait_seconds,
  read_settled_session,
  wait_for_idle_api_session,
} from '@api/services/sessions_api/session_wait';
import { chat_url } from '@runtime-platform/tools/policies/approval_card_parts';
import { z } from 'zod';

const session_id_schema = z.string().min(1).max(200);

const create_session_tool_schema = create_session_body_schema
  .omit({ initial_events: true })
  .extend({ message: text_block_schema.shape.text.optional() });

const send_message_schema = z.strictObject({
  session_id: session_id_schema,
  message: text_block_schema.shape.text,
});

const session_read_schema = z.strictObject({ session_id: session_id_schema });

const wait_for_session_schema = z.strictObject({
  session_id: session_id_schema,
  timeout_seconds: z
    .number()
    .int()
    .min(0)
    .max(max_session_wait_seconds)
    .default(default_session_wait_seconds),
});

const confirm_tool_schema = tool_confirmation_event_schema
  .omit({ type: true })
  .extend({ session_id: session_id_schema });

export const session_mcp_tools: Record<string, BrainTool> = {
  create_session: define_brain_tool({
    title: 'Create a session',
    annotations: starts_agent_work_that_cannot_be_unsent,
    description: create_session_description,
    required_scope: 'sessions.write',
    input_schema: create_session_tool_schema,
    run: async (db, api_key, args) =>
      format_session_for_mcp(
        await create_api_session(
          db,
          {
            api_key,
            agent_slug: args.agent,
            title: args.title,
            initial_events: args.message
              ? [{ type: 'user.message', content: [{ type: 'text', text: args.message }] }]
              : [],
            metadata: args.metadata,
          },
          undefined,
        ),
      ),
  }),

  send_message: define_brain_tool({
    title: 'Send a message',
    annotations: starts_agent_work_that_cannot_be_unsent,
    description:
      'Continue work in a session you opened: a follow-up, a correction, or the answer to something the coworker asked. Prefer this over a new session when the person is still on the same task, because the coworker keeps what it already did. The session must be idle; one that is still working answers conversation_busy.',
    required_scope: 'sessions.write',
    input_schema: send_message_schema,
    run: (db, api_key, args) =>
      send_api_session_events(db, api_key, args.session_id, [
        { type: 'user.message', content: [{ type: 'text', text: args.message }] },
      ]),
  }),

  wait_for_session: define_brain_tool({
    title: 'Wait for a session',
    annotations: reads_the_workspace,
    description:
      'Wait up to timeout_seconds for the coworker to finish, then return what it said. If status is waiting_for_approval, the coworker stopped before an action it may not take alone: show the person each entry in waiting_for_approval and answer with confirm_tool. If time runs out you get {wait_timed_out, session_id}: call again with the same id, and tell the person it is still working rather than guessing the result.',
    required_scope: 'sessions.read',
    input_schema: wait_for_session_schema,
    run: async (db, api_key, args, signal) =>
      format_session_wait_for_mcp(
        await wait_for_idle_api_session(db, api_key, {
          session_id: args.session_id,
          timeout_seconds: args.timeout_seconds,
          signal,
          returns_when_it_holds_a_tool_call: true,
        }),
      ),
  }),

  get_session: define_brain_tool({
    title: 'Get a session',
    annotations: reads_the_workspace,
    description:
      'Read a session you opened without waiting: its status, the last thing the coworker said, and, when status is waiting_for_approval, the actions it is holding for the person to allow or deny.',
    required_scope: 'sessions.read',
    input_schema: session_read_schema,
    run: async (db, api_key, args) =>
      format_session_snapshot_for_mcp(
        await read_settled_session(db, api_key, {
          session_id: args.session_id,
          returns_when_it_holds_a_tool_call: true,
        }),
      ),
  }),

  confirm_tool: define_brain_tool({
    title: 'Confirm a tool call',
    annotations: starts_agent_work_that_cannot_be_unsent,
    description:
      'Answer an action the coworker is holding for approval. Take tool_use_id from waiting_for_approval in wait_for_session or get_session. Ask the person first and quote the action and its input to them: never allow on your own. Use result "allow", or "deny" with a deny_message the coworker reads. Then call wait_for_session again.',
    required_scope: 'sessions.write',
    input_schema: confirm_tool_schema,
    run: (db, api_key, args) =>
      send_api_session_events(db, api_key, args.session_id, [
        {
          type: 'user.tool_confirmation',
          tool_use_id: args.tool_use_id,
          result: args.result,
          deny_message: args.deny_message,
        },
      ]),
  }),

  list_session_files: define_brain_tool({
    title: 'List session files',
    annotations: reads_the_workspace,
    description:
      "List the files a session produced: each file's name, size in bytes, and type. The person opens them in Alfera at the open_in_alfera link.",
    required_scope: 'sessions.read',
    input_schema: session_read_schema,
    run: async (db, api_key, args) =>
      format_session_files_for_mcp(
        await list_api_session_files(db, api_key, args.session_id),
        chat_url(args.session_id),
      ),
  }),
};
