export type OAuthTokenResponseData = Record<string, unknown> & {
  access_token?: string | undefined;
  refresh_token?: string | undefined;
  id_token?: string | undefined;
  bot_access_token?: string | undefined;
  token_type?: string | undefined;
  scope?: string | undefined;
  scopes?: string | undefined;
  expires_in?: number | undefined;
  account_id?: string | undefined;
  account_name?: string | undefined;
  team_id?: string | undefined;
  team_name?: string | undefined;
  team?: { id?: string | undefined; name?: string | undefined } | undefined;
  authed_user?: { id?: string | undefined } | undefined;
};
