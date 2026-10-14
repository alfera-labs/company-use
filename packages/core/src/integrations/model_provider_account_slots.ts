export const model_provider_account_slots = {
  openai: {
    model_proxy: 'openai_direct',
    env_name: 'OPENAI_API_KEY',
    private_value_names: [],
    shared_value_names: [],
    app_name: 'model_key_openai',
    display_name: 'OpenAI',
  },
  anthropic: {
    model_proxy: 'anthropic_direct',
    env_name: 'ANTHROPIC_API_KEY',
    private_value_names: [],
    shared_value_names: [],
    app_name: 'model_key_anthropic',
    display_name: 'Anthropic',
  },
  vercel_ai_gateway: {
    model_proxy: 'vercel_ai_gateway',
    env_name: 'VERCEL_AI_GATEWAY_API_KEY',
    private_value_names: [],
    shared_value_names: [],
    app_name: 'model_key_vercel_ai_gateway',
    display_name: 'AI Gateway',
  },
  chatgpt: {
    model_proxy: 'openai_codex',
    env_name: 'OPENAI_CODEX_ACCESS_TOKEN',
    private_value_names: ['OPENAI_CODEX_REFRESH_TOKEN', 'OPENAI_CODEX_EXPIRES_AT'],
    shared_value_names: [],
    app_name: 'model_key_chatgpt',
    display_name: 'ChatGPT',
  },
  openrouter: {
    model_proxy: 'openrouter',
    env_name: 'OPENROUTER_API_KEY',
    private_value_names: [],
    shared_value_names: [],
    app_name: 'model_key_openrouter',
    display_name: 'OpenRouter',
  },
  google: {
    model_proxy: 'google_direct',
    env_name: 'GEMINI_API_KEY',
    private_value_names: [],
    shared_value_names: [],
    app_name: 'model_key_google',
    display_name: 'Google',
  },
  xai: {
    model_proxy: 'xai_direct',
    env_name: 'XAI_API_KEY',
    private_value_names: [],
    shared_value_names: [],
    app_name: 'model_key_xai',
    display_name: 'xAI',
  },
  groq: {
    model_proxy: 'groq_direct',
    env_name: 'GROQ_API_KEY',
    private_value_names: [],
    shared_value_names: [],
    app_name: 'model_key_groq',
    display_name: 'Groq',
  },
  deepseek: {
    model_proxy: 'deepseek_direct',
    env_name: 'DEEPSEEK_API_KEY',
    private_value_names: [],
    shared_value_names: [],
    app_name: 'model_key_deepseek',
    display_name: 'DeepSeek',
  },
  mistral: {
    model_proxy: 'mistral_direct',
    env_name: 'MISTRAL_API_KEY',
    private_value_names: [],
    shared_value_names: [],
    app_name: 'model_key_mistral',
    display_name: 'Mistral',
  },
  moonshotai: {
    model_proxy: 'moonshotai_direct',
    env_name: 'MOONSHOT_API_KEY',
    private_value_names: [],
    shared_value_names: [],
    app_name: 'model_key_moonshotai',
    display_name: 'Moonshot AI',
  },
  minimax: {
    model_proxy: 'minimax_direct',
    env_name: 'MINIMAX_API_KEY',
    private_value_names: [],
    shared_value_names: [],
    app_name: 'model_key_minimax',
    display_name: 'MiniMax',
  },
  xiaomi: {
    model_proxy: 'xiaomi_direct',
    env_name: 'XIAOMI_API_KEY',
    private_value_names: [],
    shared_value_names: [],
    app_name: 'model_key_xiaomi',
    display_name: 'Xiaomi',
  },
  cerebras: {
    model_proxy: 'cerebras_direct',
    env_name: 'CEREBRAS_API_KEY',
    private_value_names: [],
    shared_value_names: [],
    app_name: 'model_key_cerebras',
    display_name: 'Cerebras',
  },
  together: {
    model_proxy: 'together_direct',
    env_name: 'TOGETHER_API_KEY',
    private_value_names: [],
    shared_value_names: [],
    app_name: 'model_key_together',
    display_name: 'Together AI',
  },
  fireworks: {
    model_proxy: 'fireworks_direct',
    env_name: 'FIREWORKS_API_KEY',
    private_value_names: [],
    shared_value_names: [],
    app_name: 'model_key_fireworks',
    display_name: 'Fireworks',
  },
  huggingface: {
    model_proxy: 'huggingface_direct',
    env_name: 'HF_TOKEN',
    private_value_names: [],
    shared_value_names: [],
    app_name: 'model_key_huggingface',
    display_name: 'Hugging Face',
  },
  chatgpt_plan: {
    model_proxy: 'chatgpt_plan',
    env_name: 'CHATGPT_PLAN_ACCESS_TOKEN',
    private_value_names: [
      'CHATGPT_PLAN_REFRESH_TOKEN',
      'CHATGPT_PLAN_EXPIRES_AT',
      'CHATGPT_PLAN_CLIENT_ID',
      'CHATGPT_PLAN_ID_TOKEN',
    ],
    shared_value_names: ['CHATGPT_PLAN_MODEL_IDS'],
    app_name: 'model_key_chatgpt_plan',
    display_name: 'ChatGPT',
  },
} as const;

export type ModelProviderAccountSlot = keyof typeof model_provider_account_slots;

const model_provider_account_slot_names = Object.keys(
  model_provider_account_slots,
) as ModelProviderAccountSlot[];

export function find_model_provider_account_slot(slot: string): ModelProviderAccountSlot | null {
  return slot in model_provider_account_slots ? (slot as ModelProviderAccountSlot) : null;
}

export function find_model_provider_account_slot_by_app_name(
  app_name: string,
): ModelProviderAccountSlot | null {
  return (
    model_provider_account_slot_names.find(
      (slot) => model_provider_account_slots[slot].app_name === app_name,
    ) ?? null
  );
}

export function find_model_provider_account_slot_by_env_name(
  env_name: string,
): ModelProviderAccountSlot | null {
  return (
    model_provider_account_slot_names.find(
      (slot) => model_provider_account_slots[slot].env_name === env_name,
    ) ?? null
  );
}

export const model_provider_account_app_names: readonly string[] =
  model_provider_account_slot_names.map((slot) => model_provider_account_slots[slot].app_name);

export function model_provider_account_connection_key(slot: ModelProviderAccountSlot): string {
  return `model_provider_account:${slot}`;
}
