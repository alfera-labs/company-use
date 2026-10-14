import type { ApiEnv } from '@api/lib/context';
import { read_manageable_project_or_raise } from '@api/routes/projects/project_reader';
import { list_slack_channel_access_rows } from '@runtime-platform/channels/slack/channel_setup';
import type { Context } from 'hono';

// Putting a Slack channel in a project decides which instructions and tools everyone in that
// channel gets, so it takes the same authority as changing the project itself: a manager of the
// project (or a workspace owner or admin). Taking a channel out of a project, or moving it to
// another, also needs that authority over the project it leaves.
export async function assert_may_set_channel_project(
  c: Context<ApiEnv>,
  input: {
    connection_id: string;
    external_account_id: string;
    external_conversation_id: string;
    project_id: string | null;
  },
) {
  const [current] = await list_slack_channel_access_rows(c.get('db'), {
    workspace_id: c.get('workspace_id'),
    connection_id: input.connection_id,
    external_account_id: input.external_account_id,
    external_conversation_ids: [input.external_conversation_id],
  });
  const leaving = current?.project_id ?? null;
  if (leaving === input.project_id) return;
  if (input.project_id) await read_manageable_project_or_raise(c, input.project_id);
  if (leaving) await read_manageable_project_or_raise(c, leaving);
}
