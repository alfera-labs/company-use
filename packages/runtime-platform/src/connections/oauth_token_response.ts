import { z } from 'zod';

export type OAuthTokenRequest = {
  headers: Record<string, string>;
  body: URLSearchParams | string;
};

// `Accept: application/json` is not optional politeness. GitHub's token endpoint answers
// `application/x-www-form-urlencoded` without it, and the parse below reads JSON.
export function build_oauth_token_request(input: {
  parameters: Record<string, string>;
  client_id: string;
  client_secret?: string | null | undefined;
  token_auth_method?: string | null | undefined;
  token_request_format?: string | null | undefined;
}): OAuthTokenRequest {
  const uses_basic_auth = input.token_auth_method === 'client_secret_basic';
  const parameters = {
    ...input.parameters,
    client_id: input.client_id,
    ...(input.client_secret && !uses_basic_auth ? { client_secret: input.client_secret } : {}),
  };
  const writes_json = input.token_request_format === 'json';

  return {
    headers: {
      Accept: 'application/json',
      'Content-Type': writes_json ? 'application/json' : 'application/x-www-form-urlencoded',
      ...(uses_basic_auth && input.client_secret
        ? {
            Authorization: `Basic ${encode_basic_credentials(input.client_id, input.client_secret)}`,
          }
        : {}),
    },
    body: writes_json ? JSON.stringify(parameters) : new URLSearchParams(parameters),
  };
}

function encode_basic_credentials(client_id: string, client_secret: string) {
  return Buffer.from(`${client_id}:${client_secret}`).toString('base64');
}

const nonempty_text_schema = z.string().trim().min(1);
// The scope a provider granted, in whichever dialect it speaks: GitHub Apps answer `scope: ""`
// (permissions are app-level), Slack a space-joined string, HubSpot `scopes` as an ARRAY of
// strings. One field, three shapes — normalized here to a single space-joined string or absent,
// so the stored grant reads the same regardless of who issued the token.
const granted_scope_schema = z
  .union([z.string(), z.array(z.string())])
  .optional()
  .transform((value) => {
    const joined = Array.isArray(value) ? value.join(' ') : value;
    const trimmed = joined?.trim();
    return trimmed ? trimmed : undefined;
  });

const oauth_team_schema = z
  .object({
    id: nonempty_text_schema.optional(),
    name: nonempty_text_schema.optional(),
  })
  .passthrough();

const oauth_user_schema = z
  .object({
    id: nonempty_text_schema.optional(),
  })
  .passthrough();

const oauth_token_success_schema = z
  .object({
    access_token: nonempty_text_schema,
    refresh_token: nonempty_text_schema.optional(),
    id_token: nonempty_text_schema.optional(),
    bot_access_token: nonempty_text_schema.optional(),
    token_type: nonempty_text_schema.optional(),
    scope: granted_scope_schema,
    scopes: granted_scope_schema,
    expires_in: z.number().int().nonnegative().optional(),
    account_id: nonempty_text_schema.optional(),
    account_name: nonempty_text_schema.optional(),
    team_id: nonempty_text_schema.optional(),
    team_name: nonempty_text_schema.optional(),
    team: oauth_team_schema.optional(),
    authed_user: oauth_user_schema.optional(),
  })
  .passthrough();

const slack_oauth_token_success_schema = oauth_token_success_schema.extend({
  ok: z.literal(true),
  access_token: nonempty_text_schema,
  team: oauth_team_schema.extend({ id: nonempty_text_schema }),
});

const oauth_token_error_schema = z
  .object({
    error: nonempty_text_schema,
    error_description: nonempty_text_schema.optional(),
  })
  .passthrough();

export type OAuthTokenSuccessResponse = z.infer<typeof oauth_token_success_schema>;

export async function parse_oauth_token_response(input: {
  response: Response;
  provider_app_key?: string | null | undefined;
}): Promise<OAuthTokenSuccessResponse> {
  const body_text = await input.response.text();
  const raw_body = parse_response_json(body_text, input.response.status);
  const error_response = oauth_token_error_schema.safeParse(raw_body);

  if (error_response.success) {
    throw new Error(oauth_token_error_message(error_response.data, input.response.status));
  }
  if (!input.response.ok) {
    throw new Error(`OAuth token exchange failed: HTTP ${input.response.status}`);
  }

  const success_schema =
    input.provider_app_key?.trim().toLowerCase() === 'slack'
      ? slack_oauth_token_success_schema
      : oauth_token_success_schema;
  const token_response = success_schema.safeParse(raw_body);
  if (!token_response.success) {
    const invalid_fields = Array.from(
      new Set(token_response.error.issues.map((issue) => issue.path.join('.') || 'response body')),
    );
    throw new Error(
      `OAuth token exchange returned an invalid ${provider_label(input.provider_app_key)} response: ${invalid_fields.join(', ')}`,
    );
  }

  return token_response.data;
}

function parse_response_json(body_text: string, status: number): unknown {
  if (!body_text.trim()) {
    throw new Error(`OAuth token exchange returned an empty response (HTTP ${status}).`);
  }

  try {
    return JSON.parse(body_text) as unknown;
  } catch {
    throw new Error(`OAuth token exchange returned invalid JSON (HTTP ${status}).`);
  }
}

function oauth_token_error_message(
  token_response: z.infer<typeof oauth_token_error_schema>,
  status: number,
) {
  const description = token_response.error_description;
  return description
    ? `OAuth token exchange failed: ${token_response.error}: ${description}`
    : `OAuth token exchange failed: ${token_response.error || `HTTP ${status}`}`;
}

function provider_label(provider_app_key: string | null | undefined) {
  return provider_app_key?.trim() || 'provider';
}
