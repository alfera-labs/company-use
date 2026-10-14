export type ConnectionAccessType = 'shared' | 'restricted';

export type ConnectionAccessMember = {
  user_id: string;
  can_delete?: boolean;
  can_edit_tools?: boolean;
};

export function read_connection_access(config: unknown): {
  access_type: ConnectionAccessType;
  allowed_users: ConnectionAccessMember[];
} {
  const block = config && typeof config === 'object' ? (config as Record<string, unknown>) : {};
  if (block.connection_access_type !== 'restricted') {
    return { access_type: 'shared', allowed_users: [] };
  }
  const access =
    block.access && typeof block.access === 'object'
      ? (block.access as Record<string, unknown>)
      : {};
  const allowed_users = Array.isArray(access.allowed_users)
    ? access.allowed_users.flatMap((entry) => {
        if (!entry || typeof entry !== 'object') return [];
        const member = entry as Record<string, unknown>;
        if (typeof member.user_id !== 'string') return [];
        return [
          {
            user_id: member.user_id,
            ...(member.can_delete === true ? { can_delete: true } : {}),
            ...(member.can_edit_tools === true ? { can_edit_tools: true } : {}),
          },
        ];
      })
    : [];
  return { access_type: 'restricted', allowed_users };
}
