import { z } from 'zod';

export const reasoning_levels = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'] as const;

export type ModelReasoningLevel = (typeof reasoning_levels)[number];

export const language_model_use_cases = [
  'agent_run',
  'session_title',
  'session_summary',
  'classification',
  'onboarding_scan',
  'slack_discovery',
  'slack_workflow_proposal',
  'evaluation',
] as const;

export type LanguageModelUseCase = (typeof language_model_use_cases)[number];

const model_profile_names = ['customer_agent', 'browser_agent'] as const;

export type ModelProfileName = (typeof model_profile_names)[number];

export type ModelSelection = {
  model_provider: string;
  model_proxy: string;
  model_name: string;
  reasoning_level: ModelReasoningLevel;
};

const model_id_formats = ['provider_slash_model', 'bare_model_name', 'any_model_name'] as const;

export const provider_payload_rewrites = ['chatgpt_plan_responses'] as const;

const unset_use_case_model_behaviors = [
  'try_the_proxies_shared_model_env',
  'use_the_default_model_name',
] as const;

const model_catalog_sources_schema = z
  .object({
    models_dev: z
      .object({
        fetch_from: z.url(),
        refresh_after_ms: z.number().int().positive(),
        retry_after_failure_ms: z.number().int().positive(),
        request_timeout_ms: z.number().int().positive(),
      })
      .strict(),
  })
  .strict();

const env_name_schema = z
  .string()
  .min(1)
  .regex(/^[A-Z][A-Z0-9_]*$/u);

const model_proxy_schema = z
  .object({
    comment: z.array(z.string()).optional(),
    model_proxy: z
      .string()
      .min(1)
      .regex(/^[a-z][a-z0-9_]*$/u),
    display_name: z.string().min(1),
    also_known_as: z.array(z.string().min(1)).optional(),
    reach_models_through_pi_provider: z.string().min(1),
    reach_models_at_the_address_in_env: env_name_schema.optional(),
    serve_only_when_env_is_true: env_name_schema.optional(),
    run_only_the_models_named_in_env: z.literal(true).optional(),
    authenticate_with_first_env_name_present: z.array(z.string().min(1)).min(1),
    model_ids_are_written_as: z.enum(model_id_formats),
    model_provider: z.string().min(1).optional(),
    claim_model_ids_starting_with: z.array(z.string().min(1)).optional(),
    claim_model_ids_no_other_proxy_claims: z.literal(true).optional(),
    offer_models_made_by: z.array(z.string().min(1)).optional(),
    offer_models_no_other_proxy_offers: z.literal(true).optional(),
    suggest_as_one_key_for_every_model: z.literal(true).optional(),
    models_dev_names_of_model_providers: z.record(z.string().min(1), z.string().min(1)).optional(),
    offer_only_the_model_ids_listed_in_env: env_name_schema.optional(),
    rewrite_provider_payload_as: z.enum(provider_payload_rewrites).optional(),
    models_dev_provider_name: z.string().min(1),
    read_model_names_from_env_prefixed: env_name_schema,
    model_name_when_env_is_unset: z.string().min(1),
    model_name_when_env_is_unset_by_use_case: z
      .partialRecord(z.enum(language_model_use_cases), z.string().min(1))
      .optional(),
  })
  .strict()
  .superRefine(require_fields_the_chosen_operations_need);

export const model_proxies_file_schema = z.object({
  comment: z.array(z.string()).optional(),
  model_catalog_sources: model_catalog_sources_schema,
  model_proxies: z.array(model_proxy_schema).min(1),
});

const model_use_case_schema = z
  .object({
    comment: z.string().optional(),
    try_proxies_in_order: z.array(z.string().min(1)).min(1),
    when_use_case_model_env_is_unset: z.enum(unset_use_case_model_behaviors),
    stream: z.boolean(),
    tools: z.boolean(),
    images: z.boolean(),
    reasoning_level_comment: z.string().optional(),
    reasoning_level: z.enum(reasoning_levels),
    reasoning_level_when_nobody_is_waiting_comment: z.string().optional(),
    reasoning_level_when_nobody_is_waiting: z.enum(reasoning_levels).optional(),
    max_output_tokens: z.number().int().positive().optional(),
    prompt_cache_retention_comment: z.string().optional(),
    prompt_cache_retention: z.enum(['none', 'short', 'long']),
    maximum_retry_attempts: z.number().int().nonnegative(),
    stream_idle_timeout_ms_comment: z.string().optional(),
    stream_idle_timeout_ms: z.number().int().positive().optional(),
  })
  .strict();

export const model_use_cases_file_schema = z.object({
  comment: z.array(z.string()).optional(),
  model_use_cases: z.record(z.enum(language_model_use_cases), model_use_case_schema),
});

const model_profile_schema = z
  .object({
    read_model_proxy_from_env: z.string().min(1).optional(),
    model_proxy_when_env_is_unset: z.string().min(1),
    read_model_name_from_env: z.string().min(1).optional(),
    model_name_when_env_is_unset: z.string().min(1),
    reasoning_level: z.enum(reasoning_levels),
  })
  .strict();

export const model_profiles_file_schema = z.object({
  comment: z.array(z.string()).optional(),
  model_profiles: z.record(z.enum(model_profile_names), model_profile_schema),
});

export type ModelProxy = z.infer<typeof model_proxy_schema>;
export type ModelUseCasePolicy = z.infer<typeof model_use_case_schema>;
export type ModelIdFormat = (typeof model_id_formats)[number];
export type ModelCatalogSourceName = keyof z.infer<typeof model_catalog_sources_schema>;
export type ModelProfile = z.infer<typeof model_profile_schema>;

function require_fields_the_chosen_operations_need(
  proxy: {
    model_ids_are_written_as: ModelIdFormat;
    model_provider?: string | undefined;
  },
  context: z.RefinementCtx,
) {
  if (proxy.model_ids_are_written_as !== 'provider_slash_model' && !proxy.model_provider) {
    context.addIssue({
      code: 'custom',
      path: ['model_provider'],
      message:
        'A proxy writing bare model ids must name who provided its models, because the id cannot.',
    });
  }
}
export type ProviderPayloadRewrite = (typeof provider_payload_rewrites)[number];
