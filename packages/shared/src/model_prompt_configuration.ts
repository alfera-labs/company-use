import model_prompt_profiles_data from '@coworker/shared/model_prompt_profiles.json' with {
  type: 'json',
};
import { find_model_proxy } from '@shared/model_configuration';
import { parse_json_config } from '@shared/parse_json_config';
import { z } from 'zod';

const prompt_section_names = [
  'persistence',
  'planning',
  'tool_discipline',
  'communication',
  'tone',
] as const;

const prompt_profile_schema = z.object(
  Object.fromEntries(
    prompt_section_names.map((section_name) => [section_name, z.array(z.string().min(1)).min(1)]),
  ) as Record<(typeof prompt_section_names)[number], z.ZodArray<z.ZodString>>,
);

const proxy_with_multiple_model_providers_rule_schema = z
  .object({
    profile: z.string().min(1),
    model_name_starts_with: z.array(z.string().min(1)).optional(),
    model_name_includes: z.array(z.string().min(1)).optional(),
  })
  .strict();

const model_prompt_profiles_file_schema = z
  .object({
    comment: z.array(z.string()).optional(),
    default_profile: z.string().min(1),
    profiles_by_model_provider: z.record(z.string().min(1), z.string().min(1)),
    proxy_with_multiple_model_providers_default_profile: z.string().min(1),
    proxy_with_multiple_model_providers_rules: z.array(
      proxy_with_multiple_model_providers_rule_schema,
    ),
    prompt_profiles: z.record(z.string().min(1), prompt_profile_schema),
  })
  .superRefine(require_referenced_profiles);

export type ModelPromptProfileData = z.infer<typeof prompt_profile_schema>;
const model_prompt_section_names = prompt_section_names;

type PromptModelSelection = {
  model_provider: string;
  model_proxy?: string;
  model_name: string;
};

const configuration = parse_json_config(
  'model_prompt_profiles.json',
  model_prompt_profiles_file_schema,
  model_prompt_profiles_data,
);

export function select_model_prompt_profile(
  model: PromptModelSelection | undefined,
): ModelPromptProfileData {
  const model_provider = model?.model_provider?.trim().toLowerCase();
  if (!model || !model_provider) return require_prompt_profile(configuration.default_profile);

  const proxy = find_model_proxy(model.model_proxy ?? model_provider);
  if (proxy?.model_ids_are_written_as === 'provider_slash_model') {
    return select_prompt_profile_for_proxy_with_multiple_model_providers(model.model_name);
  }

  return require_prompt_profile(
    configuration.profiles_by_model_provider[model_provider] ?? configuration.default_profile,
  );
}

export function format_model_prompt_profile(profile: ModelPromptProfileData): string {
  return model_prompt_section_names
    .map((section_name) => profile[section_name].join('\n'))
    .join('\n\n');
}

function select_prompt_profile_for_proxy_with_multiple_model_providers(model_name: string) {
  const normalized_model_name = model_name.trim().toLowerCase();
  const rule = configuration.proxy_with_multiple_model_providers_rules.find((candidate) =>
    rule_matches_model_name(candidate, normalized_model_name),
  );
  return require_prompt_profile(
    rule?.profile ?? configuration.proxy_with_multiple_model_providers_default_profile,
  );
}

function rule_matches_model_name(
  rule: (typeof configuration.proxy_with_multiple_model_providers_rules)[number],
  model_name: string,
) {
  return (
    rule.model_name_starts_with?.some((prefix) => model_name.startsWith(prefix)) === true ||
    rule.model_name_includes?.some((part) => model_name.includes(part)) === true
  );
}

function require_prompt_profile(profile_name: string) {
  const profile = configuration.prompt_profiles[profile_name];
  if (profile) return profile;
  throw new Error(`Model prompt profile ${profile_name} is not configured`);
}

function require_referenced_profiles(
  file: z.infer<typeof model_prompt_profiles_file_schema>,
  context: z.RefinementCtx,
) {
  const referenced_profiles = [
    file.default_profile,
    file.proxy_with_multiple_model_providers_default_profile,
    ...Object.values(file.profiles_by_model_provider),
    ...file.proxy_with_multiple_model_providers_rules.map((rule) => rule.profile),
  ];
  for (const profile_name of referenced_profiles) {
    if (file.prompt_profiles[profile_name]) continue;
    context.addIssue({
      code: 'custom',
      path: ['prompt_profiles', profile_name],
      message: `Referenced prompt profile ${profile_name} is not declared`,
    });
  }
}
