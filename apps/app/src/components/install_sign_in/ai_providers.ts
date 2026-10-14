export type AiProvider = {
  provider_slot: string;
  name: string;
  line: string;
  connects_with: 'api_key' | 'chatgpt_sign_in';
  shown_under_more: boolean;
  is_recommended?: true;
  key_placeholder?: string;
  key_page?: string;
};

export const ai_providers: readonly AiProvider[] = [
  {
    provider_slot: 'chatgpt_plan',
    name: 'ChatGPT plan',
    line: 'Sign in with your ChatGPT account.',
    connects_with: 'chatgpt_sign_in',
    shown_under_more: false,
  },
  {
    provider_slot: 'openrouter',
    name: 'OpenRouter',
    line: 'One key, every model.',
    connects_with: 'api_key',
    shown_under_more: false,
    is_recommended: true,
    key_placeholder: 'sk-or-v1-…',
    key_page: 'https://openrouter.ai/settings/keys',
  },
  {
    provider_slot: 'anthropic',
    name: 'Anthropic',
    line: 'Claude models.',
    connects_with: 'api_key',
    shown_under_more: false,
    key_placeholder: 'sk-ant-api03-…',
    key_page: 'https://console.anthropic.com/settings/keys',
  },
  {
    provider_slot: 'openai',
    name: 'OpenAI',
    line: 'GPT models, paid by the token.',
    connects_with: 'api_key',
    shown_under_more: false,
    key_placeholder: 'sk-proj-…',
    key_page: 'https://platform.openai.com/api-keys',
  },
  {
    provider_slot: 'vercel_ai_gateway',
    name: 'Vercel AI Gateway',
    line: 'One key, models from every major lab.',
    connects_with: 'api_key',
    shown_under_more: true,
    key_placeholder: 'vck_…',
    key_page: 'https://vercel.com/d?to=%2F%5Bteam%5D%2F%7E%2Fai%2Fapi-keys',
  },
  {
    provider_slot: 'google',
    name: 'Google',
    line: 'Gemini models.',
    connects_with: 'api_key',
    shown_under_more: true,
    key_placeholder: 'AIza…',
    key_page: 'https://aistudio.google.com/app/apikey',
  },
  {
    provider_slot: 'xai',
    name: 'xAI',
    line: 'Grok models.',
    connects_with: 'api_key',
    shown_under_more: true,
    key_placeholder: 'xai-…',
    key_page: 'https://console.x.ai',
  },
  {
    provider_slot: 'groq',
    name: 'Groq',
    line: 'Fast open models.',
    connects_with: 'api_key',
    shown_under_more: true,
    key_placeholder: 'gsk_…',
    key_page: 'https://console.groq.com/keys',
  },
  {
    provider_slot: 'deepseek',
    name: 'DeepSeek',
    line: 'DeepSeek models.',
    connects_with: 'api_key',
    shown_under_more: true,
    key_placeholder: 'sk-…',
    key_page: 'https://platform.deepseek.com/api_keys',
  },
  {
    provider_slot: 'mistral',
    name: 'Mistral',
    line: 'Mistral models.',
    connects_with: 'api_key',
    shown_under_more: true,
    key_placeholder: 'Paste the key here',
    key_page: 'https://console.mistral.ai/api-keys',
  },
  {
    provider_slot: 'moonshotai',
    name: 'Moonshot AI',
    line: 'Kimi models.',
    connects_with: 'api_key',
    shown_under_more: true,
    key_placeholder: 'sk-…',
    key_page: 'https://platform.moonshot.ai/console/api-keys',
  },
  {
    provider_slot: 'minimax',
    name: 'MiniMax',
    line: 'MiniMax models.',
    connects_with: 'api_key',
    shown_under_more: true,
    key_placeholder: 'Paste the key here',
    key_page: 'https://platform.minimax.io/user-center/basic-information/interface-key',
  },
  {
    provider_slot: 'xiaomi',
    name: 'Xiaomi',
    line: 'MiMo models.',
    connects_with: 'api_key',
    shown_under_more: true,
    key_placeholder: 'Paste the key here',
    key_page: 'https://platform.xiaomimimo.com',
  },
  {
    provider_slot: 'cerebras',
    name: 'Cerebras',
    line: 'Fast open models.',
    connects_with: 'api_key',
    shown_under_more: true,
    key_placeholder: 'csk-…',
    key_page: 'https://cloud.cerebras.ai',
  },
  {
    provider_slot: 'together',
    name: 'Together AI',
    line: 'Open models.',
    connects_with: 'api_key',
    shown_under_more: true,
    key_placeholder: 'tgp_v1_…',
    key_page: 'https://api.together.ai/settings/api-keys',
  },
  {
    provider_slot: 'fireworks',
    name: 'Fireworks',
    line: 'Open models.',
    connects_with: 'api_key',
    shown_under_more: true,
    key_placeholder: 'fw_…',
    key_page: 'https://app.fireworks.ai/settings/users/api-keys',
  },
  {
    provider_slot: 'huggingface',
    name: 'Hugging Face',
    line: 'Open models from many hosts.',
    connects_with: 'api_key',
    shown_under_more: true,
    key_placeholder: 'hf_…',
    key_page: 'https://huggingface.co/settings/tokens',
  },
];

export const recommended_ai_provider = ai_providers.find((provider) => provider.is_recommended);

export function find_ai_provider(provider_slot: string): AiProvider | undefined {
  return ai_providers.find((provider) => provider.provider_slot === provider_slot);
}

export type SuggestedProvider = { provider_slot: string; display_name: string };

/** The other provider the server named for a key that belongs to it, or null. */
export function read_suggested_provider(code: string, details: unknown): AiProvider | null {
  if (code !== 'model_key_is_for_another_provider') return null;
  const suggested = (details as { suggested?: SuggestedProvider } | undefined)?.suggested;
  return suggested ? (find_ai_provider(suggested.provider_slot) ?? null) : null;
}
