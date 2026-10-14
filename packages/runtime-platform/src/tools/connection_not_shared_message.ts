type ToolOfAConnectedApp = {
  node_key: string;
  app_display_name: string | null;
  auth_type: string | null;
};

const each_person_signs_in_themselves = 'oauth2';

/**
 * What the coworker reads when a connection exists but is not shared with the person it works
 * for. It names who can share it, so the person is sent to them and not around them.
 */
export function describe_connection_not_shared(tool: ToolOfAConnectedApp): string {
  const app = tool.app_display_name ?? tool.node_key;
  const who_can_share =
    'A workspace owner or admin, or the person who connected it, can share it with them.';
  const next_step =
    tool.auth_type === each_person_signs_in_themselves
      ? 'They can also connect their own account.'
      : 'It uses one credential for the workspace, so do not ask them for its address or credentials, and do not start a new connection for it.';
  return `${app} is connected in this workspace but not shared with the person you are helping, so you cannot use it for them. ${who_can_share} ${next_step}`;
}
