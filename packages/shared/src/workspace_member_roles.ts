export const workspace_administrator_roles = ['owner', 'admin'] as const;

export function is_workspace_administrator_role(role: string | null | undefined): boolean {
  return workspace_administrator_roles.some((administrator_role) => administrator_role === role);
}
