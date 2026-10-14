import type { ModelProviderAccountSlot } from '@coworker/core/integrations/model_provider_account_slots';

export type ApiKeySlot = Exclude<ModelProviderAccountSlot, 'chatgpt' | 'chatgpt_plan'>;

type ApiKeyCheck = {
  key_starts_with: readonly string[];
  check_url: string;
  send_key_as: 'bearer' | 'x-api-key' | 'x-goog-api-key';
  extra_headers?: Record<string, string>;
};

export const api_key_checks: Record<ApiKeySlot, ApiKeyCheck> = {
  vercel_ai_gateway: {
    key_starts_with: ['vck_'],
    check_url: 'https://ai-gateway.vercel.sh/v1/credits',
    send_key_as: 'bearer',
  },
  openrouter: {
    key_starts_with: ['sk-or-'],
    check_url: 'https://openrouter.ai/api/v1/key',
    send_key_as: 'bearer',
  },
  anthropic: {
    key_starts_with: ['sk-ant-'],
    check_url: 'https://api.anthropic.com/v1/models',
    send_key_as: 'x-api-key',
    extra_headers: { 'anthropic-version': '2023-06-01' },
  },
  openai: {
    key_starts_with: ['sk-proj-', 'sk-svcacct-', 'sk-'],
    check_url: 'https://api.openai.com/v1/models',
    send_key_as: 'bearer',
  },
  google: {
    key_starts_with: ['AIza'],
    check_url: 'https://generativelanguage.googleapis.com/v1beta/models',
    send_key_as: 'x-goog-api-key',
  },
  xai: {
    key_starts_with: ['xai-'],
    check_url: 'https://api.x.ai/v1/models',
    send_key_as: 'bearer',
  },
  groq: {
    key_starts_with: ['gsk_'],
    check_url: 'https://api.groq.com/openai/v1/models',
    send_key_as: 'bearer',
  },
  deepseek: {
    key_starts_with: ['sk-'],
    check_url: 'https://api.deepseek.com/models',
    send_key_as: 'bearer',
  },
  mistral: {
    key_starts_with: [],
    check_url: 'https://api.mistral.ai/v1/models',
    send_key_as: 'bearer',
  },
  moonshotai: {
    key_starts_with: [],
    check_url: 'https://api.moonshot.ai/v1/models',
    send_key_as: 'bearer',
  },
  minimax: {
    key_starts_with: [],
    check_url: 'https://api.minimax.io/v1/models',
    send_key_as: 'bearer',
  },
  xiaomi: {
    key_starts_with: [],
    check_url: 'https://api.xiaomimimo.com/v1/models',
    send_key_as: 'bearer',
  },
  cerebras: {
    key_starts_with: ['csk-'],
    check_url: 'https://api.cerebras.ai/v1/models',
    send_key_as: 'bearer',
  },
  together: {
    key_starts_with: ['tgp_'],
    check_url: 'https://api.together.xyz/v1/models',
    send_key_as: 'bearer',
  },
  fireworks: {
    key_starts_with: ['fw_'],
    check_url: 'https://api.fireworks.ai/inference/v1/models',
    send_key_as: 'bearer',
  },
  huggingface: {
    key_starts_with: ['hf_'],
    check_url: 'https://huggingface.co/api/whoami-v2',
    send_key_as: 'bearer',
  },
};

export const api_key_slots = Object.keys(api_key_checks) as ApiKeySlot[];

export function is_api_key_slot(slot: string): slot is ApiKeySlot {
  return Object.hasOwn(api_key_checks, slot);
}

export const refused_api_keys = [
  {
    key_starts_with: 'sk-ant-oat',
    code: 'model_key_is_claude_subscription_token',
    message:
      'This is a Claude subscription token. Anthropic lets only its own apps use it. Paste an API key from console.anthropic.com.',
  },
  {
    key_starts_with: 'sk-ant-admin',
    code: 'model_key_is_admin_key',
    message:
      'This is an Anthropic admin key. It cannot run models. Paste an API key from console.anthropic.com.',
  },
  {
    key_starts_with: 'sk-admin-',
    code: 'model_key_is_admin_key',
    message:
      'This is an OpenAI admin key. It cannot run models. Paste a project key from platform.openai.com.',
  },
] as const;

export function build_api_key_check_request(slot: ApiKeySlot, api_key: string): Request {
  const check = api_key_checks[slot];
  const key_header: Record<ApiKeyCheck['send_key_as'], Record<string, string>> = {
    bearer: { Authorization: `Bearer ${api_key}` },
    'x-api-key': { 'x-api-key': api_key },
    'x-goog-api-key': { 'x-goog-api-key': api_key },
  };
  return new Request(check.check_url, {
    headers: { ...key_header[check.send_key_as], ...check.extra_headers },
  });
}
