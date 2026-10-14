export const users_management_widget_permission = 'widgets:users-table:manage';

type SettingsWidgetAuth = {
  accessToken?: string | undefined;
  organizationId?: string | undefined;
  permissions?: string[] | undefined;
  user?: { id: string } | null | undefined;
};

export type SettingsWidgetTokens = {
  profile_token: string | null;
  team_token_can_manage_users: boolean;
  runs_in_local_mode?: boolean;
  runs_in_team_mode?: boolean;
};

export function build_settings_widget_tokens(auth: SettingsWidgetAuth): SettingsWidgetTokens {
  const access_token = auth.user && auth.accessToken ? auth.accessToken : null;

  return {
    profile_token: access_token,
    team_token_can_manage_users: Boolean(
      access_token &&
        auth.organizationId &&
        auth.permissions?.includes(users_management_widget_permission),
    ),
  };
}
