import { AppError } from '@coworker/shared';
import { z } from 'zod';

export const chatgpt_plan_auth_base_url = 'https://auth.openai.com';
export const chatgpt_plan_token_url = `${chatgpt_plan_auth_base_url}/api/accounts/oauth/token`;
export const chatgpt_plan_resource = 'https://api.openai.com/v1';
export const chatgpt_plan_usage_scope = 'chatgpt.tokens.use.direct';
const chatgpt_plan_models_url = 'https://api.openai.com/v1/models';

export const chatgpt_plan_value_names = {
  access_token: 'CHATGPT_PLAN_ACCESS_TOKEN',
  refresh_token: 'CHATGPT_PLAN_REFRESH_TOKEN',
  expires_at: 'CHATGPT_PLAN_EXPIRES_AT',
  client_id: 'CHATGPT_PLAN_CLIENT_ID',
  id_token: 'CHATGPT_PLAN_ID_TOKEN',
  model_ids: 'CHATGPT_PLAN_MODEL_IDS',
} as const;

const token_response_schema = z
  .object({
    access_token: z.string().min(1),
    refresh_token: z.string().min(1).optional(),
    id_token: z.string().min(1).optional(),
    expires_in: z.coerce.number().positive(),
    scope: z.string().optional(),
  })
  .passthrough();

export type ChatgptPlanTokenResponse = z.infer<typeof token_response_schema>;

const model_list_schema = z
  .object({
    models: z.array(
      z.object({ slug: z.string().min(1), visibility: z.string().optional() }).passthrough(),
    ),
  })
  .passthrough();

const oauth_errors_that_end_the_sign_in = new Set([
  'invalid_grant',
  'invalid_refresh_token',
  'token_expired',
  'refresh_token_expired',
  'refresh_token_invalidated',
  'refresh_token_reused',
  'invalid_client',
]);

export async function request_chatgpt_plan_tokens(
  form: Record<string, string>,
): Promise<ChatgptPlanTokenResponse> {
  const response = await call_openai(chatgpt_plan_token_url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ ...form, resource: chatgpt_plan_resource }).toString(),
  });
  const body = await read_json_body(response);
  const parsed = token_response_schema.safeParse(body);
  if (response.ok && parsed.success) return parsed.data;
  throw token_request_error(response.status, read_error_code(body));
}

function token_request_error(status: number, error: string | undefined) {
  const details = { status, error };
  if (error && oauth_errors_that_end_the_sign_in.has(error)) {
    return new AppError('chatgpt_sign_in_expired', 'Sign in to ChatGPT again.', 400, details);
  }
  if (status === 429 || status >= 500) {
    return new AppError('chatgpt_unreachable', 'ChatGPT is busy. Try again soon.', 502, details);
  }
  return new AppError('chatgpt_sign_in_failed', 'ChatGPT did not issue a token.', 502, details);
}

export function refresh_chatgpt_plan_tokens(input: { client_id: string; refresh_token: string }) {
  return request_chatgpt_plan_tokens({
    grant_type: 'refresh_token',
    client_id: input.client_id,
    refresh_token: input.refresh_token,
  });
}

export async function list_chatgpt_plan_model_ids(access_token: string): Promise<string[]> {
  const response = await call_openai(chatgpt_plan_models_url, {
    headers: { Authorization: `Bearer ${access_token}` },
  });
  const parsed = model_list_schema.safeParse(await read_json_body(response));
  if (!response.ok || !parsed.success) {
    throw new AppError('chatgpt_sign_in_failed', 'ChatGPT did not list the plan models.', 502, {
      status: response.status,
    });
  }
  return parsed.data.models
    .filter((model) => model.visibility === undefined || model.visibility === 'list')
    .map((model) => model.slug);
}

export function chatgpt_plan_token_values(
  tokens: ChatgptPlanTokenResponse,
  received_time_ms: number,
): Record<string, string> {
  return {
    [chatgpt_plan_value_names.access_token]: tokens.access_token,
    ...(tokens.refresh_token
      ? { [chatgpt_plan_value_names.refresh_token]: tokens.refresh_token }
      : {}),
    [chatgpt_plan_value_names.expires_at]: String(received_time_ms + tokens.expires_in * 1000),
    ...(tokens.id_token ? { [chatgpt_plan_value_names.id_token]: tokens.id_token } : {}),
  };
}

export function read_granted_scopes(tokens: ChatgptPlanTokenResponse): string[] {
  return (tokens.scope ?? '').split(/\s+/u).filter(Boolean);
}

const seconds_an_openai_call_may_take = 15;

async function call_openai(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(seconds_an_openai_call_may_take * 1000),
    });
  } catch (error) {
    throw new AppError('chatgpt_unreachable', 'ChatGPT could not be reached.', 502, {
      cause: String(error),
    });
  }
}

async function read_json_body(response: Response): Promise<unknown> {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return { unreadable_body: text.slice(0, 200) };
  }
}

function read_error_code(body: unknown): string | undefined {
  const parsed = z
    .object({ error: z.union([z.string(), z.object({ code: z.string() }).passthrough()]) })
    .safeParse(body);
  if (!parsed.success) return undefined;
  return typeof parsed.data.error === 'string' ? parsed.data.error : parsed.data.error.code;
}
