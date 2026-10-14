import { listing_states } from '@coworker/core/db/schema/templates';
import { z } from 'zod';

/** What must already exist in a workspace before a template can be installed. */
export const template_requirement_schema = z.strictObject({
  requirement_kind: z.enum([
    'app_connection',
    'node',
    'model',
    'channel',
    'volume',
    'plan_entitlement',
    'template',
  ]),
  requirement_key: z.string().min(1),
  requirement_label: z.string().default(''),
  is_optional: z.boolean().default(false),
  requirement_config: z
    .object({
      needs_authorized_scopes: z.array(z.string()).optional(),
      connect_before_first_run: z.boolean().optional(),
      explain_to_the_installer: z.string().optional(),
    })
    .loose()
    .default({}),
});

export type TemplateRequirement = z.infer<typeof template_requirement_schema>;

export const template_requirements_schema = z.array(template_requirement_schema);

/**
 * One question the install asks. `example_answer` is what the listing prints in the box before
 * anyone types: a filled-in form says what will happen far faster than a label does.
 */
export const setup_question_schema = z.strictObject({
  input_key: z.string().min(1),
  label: z.string().min(1),
  input_type: z.string().min(1).default('text'),
  is_required: z.boolean().default(true),
  example_answer: z.string().optional(),
  default_value: z.unknown().optional(),
  resolve_options_from_connection: z.string().optional(),
  help_text: z.string().optional(),
});

export type SetupQuestion = z.infer<typeof setup_question_schema>;

/** A question the install wizard asks, and how to offer answers. */
export const template_setup_input_schema = z.strictObject({
  ask_the_installer_for: z.array(setup_question_schema).default([]),
});

export type TemplateSetupInput = z.infer<typeof template_setup_input_schema>;

/**
 * The three ways a task can begin, and the only structural difference between a task and a skill.
 * A task has one or more; a skill has none, and nothing ever starts one.
 */
export const start_modes = ['you_ask', 'on_a_schedule', 'something_happens'] as const;

/** Which app event a `something_happens` start listens to. Deployed at install, deleted at uninstall. */
export const start_listener_schema = z.strictObject({
  node_key: z.string().min(1),
  app_key: z.string().min(1).optional(),
  listener_config: z.record(z.string(), z.unknown()).default({}),
});

const starts_when_entry_schema = z.strictObject({
  start_mode: z.enum(start_modes),
  label: z.string().optional(),
  note: z.string().optional(),
  schedule_expression: z.string().min(1).optional(),
  read_timezone_from: z.enum(['ask_the_installer', 'workspace_default']).optional(),
  timezone: z.string().min(1).optional(),
  listens_to: start_listener_schema.optional(),
});

export type StartsWhenEntry = z.infer<typeof starts_when_entry_schema>;

export const starts_when_schema = z.array(starts_when_entry_schema);

/**
 * One browse axis. `/templates/{category}`, `/for/{role}` and `/works-with/{app}` are the same
 * query with a different facet filter, which is how 38 listings become a few hundred pages.
 */
export const facet_kinds = ['category', 'role', 'app', 'topic'] as const;

const template_facet_schema = z.strictObject({
  facet_kind: z.enum(facet_kinds),
  facet_key: z.string().min(1),
  is_primary: z.boolean().default(false),
});

export type TemplateFacet = z.infer<typeof template_facet_schema>;

export const template_facets_schema = z.array(template_facet_schema);

/**
 * What each file in a published folder is for. Deliberately NOT a whitelist of directory names:
 * real skills use references/ scripts/ assets/ bin/ src/ test/ templates/ vendor/, and a publish
 * step that understands three would silently drop half of a real skill.
 */
export const file_roles = [
  'instructions',
  'sidecar',
  'reference',
  'script',
  'asset',
  'bundled_skill',
] as const;

export type FileRole = (typeof file_roles)[number];

/** Text at or below this size travels inside the row; anything larger or binary goes to storage. */
export const inline_text_byte_limit = 64 * 1024;
/** Total size of one published version. */
export const bundle_byte_limit = 25 * 1024 * 1024;

const bundle_file_schema = z.strictObject({
  file_path: z.string().min(1),
  file_role: z.enum(file_roles),
  byte_size: z.number().int().nonnegative(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/u),
  inline_text: z.string().optional(),
  storage_key: z.string().min(1).optional(),
});

export type BundleFile = z.infer<typeof bundle_file_schema>;

export const bundle_manifest_schema = z.strictObject({
  manifest_version: z.literal(1).default(1),
  file_count: z.number().int().nonnegative(),
  total_bytes: z.number().int().nonnegative(),
  files: z.array(bundle_file_schema),
});

export type BundleManifest = z.infer<typeof bundle_manifest_schema>;

/**
 * `alfera.json` — the sidecar that carries everything the Agent Skills frontmatter cannot.
 *
 * `starts_when` lives here and NEVER in SKILL.md frontmatter: an unknown top-level frontmatter key
 * is a hard error on claude.ai upload and in the Skills API, so a `starts_when:` key would make
 * every folder we publish unuploadable to the ecosystem we claim compatibility with.
 */
export const alfera_sidecar_schema = z.strictObject({
  sidecar_version: z.literal(1),
  outcome_text: z.string().default(''),
  summary_text: z.string().default(''),
  icon: z.string().default('🧩'),
  listing_state: z.enum(listing_states).default('built_with_you'),
  facets: template_facets_schema.default([]),
  what_it_does: z.array(z.string().min(1)).default([]),
  what_you_get: z.array(z.string().min(1)).default([]),
  guidance: z
    .array(z.strictObject({ label: z.string().min(1), value: z.string().min(1) }))
    .default([]),
  used_when_text: z.string().optional(),
  asks_you_for: z.array(setup_question_schema).default([]),
  starts_when: starts_when_schema.default([]),
  it_will_be_able_to: z
    .array(
      z.strictObject({
        capability: z.string().min(1),
        risk: z.enum(['reads_data', 'changes_data', 'reaches_outside']).default('reads_data'),
      }),
    )
    .default([]),
  requires: template_requirements_schema.default([]),
  available_on_source_types: z.array(z.string().min(1)).default([]),
  caveat_text: z.string().optional(),
});

export type AlferaSidecar = z.infer<typeof alfera_sidecar_schema>;
