import type { Database } from '@coworker/core/db/connection';
import { publish_global_template } from '@coworker/core/db/queries/template_catalog';
import type { TemplateKind } from '@coworker/core/db/schema/templates';
import { reject_bundle_with_credentials } from '@coworker/core/templates/credential_scan';
import { read_library_folders, type SkillFolder } from '@coworker/core/templates/skill_folder';
import { describe_timezone_question } from '@coworker/core/templates/starts_when';
import {
  type AlferaSidecar,
  alfera_sidecar_schema,
  type StartsWhenEntry,
  type TemplateFacet,
  type TemplateRequirement,
  type TemplateSetupInput,
} from '@coworker/core/templates/template_object';

/**
 * Turns a folder on disk into a published `templates` row.
 *
 * The author writes eight fields and four bullets. Everything else on the listing — the kind, the
 * slug, what it requires, what the install wizard asks, what is inside the bundle — is derived
 * here, because a field an author has to remember to fill in is a field that is wrong on listing
 * thirty.
 */

export const platform_publisher = {
  publisher_handle: 'alfera',
  publisher_kind: 'platform',
  publisher_display_name: 'Alfera',
} as const;

/** The installable definition, stored on `templates.payload` and read by the install adapters. */
export type TemplatePayload = {
  folder_name: string;
  instruction_markdown: string;
  description_text: string;
  starts_when: StartsWhenEntry[];
  discovery_phrases: string[];
  allowed_tools: string[];
  available_on_source_types: string[];
  what_it_does: string[];
  what_you_get: string[];
  guidance: AlferaSidecar['guidance'];
  used_when_text: string | null;
  outcome_text: string;
  it_will_be_able_to: AlferaSidecar['it_will_be_able_to'];
  caveat_text: string | null;
  bundle_manifest: SkillFolder['manifest'];
  bundled_skills: TemplatePayload[];
};

function derive_template_kind(folder: SkillFolder): TemplateKind {
  return (folder.sidecar?.starts_when.length ?? 0) > 0 ? 'task' : 'skill';
}

function sidecar_or_default(folder: SkillFolder): AlferaSidecar {
  return folder.sidecar ?? alfera_sidecar_schema.parse({ sidecar_version: 1 });
}

function build_template_payload(folder: SkillFolder): TemplatePayload {
  const sidecar = sidecar_or_default(folder);
  return {
    folder_name: folder.folder_name,
    instruction_markdown: folder.instruction_markdown,
    description_text: folder.frontmatter.description,
    starts_when: sidecar.starts_when,
    discovery_phrases: folder.discovery_phrases,
    allowed_tools: folder.allowed_tools,
    available_on_source_types: sidecar.available_on_source_types,
    what_it_does: sidecar.what_it_does,
    what_you_get: sidecar.what_you_get,
    guidance: sidecar.guidance,
    used_when_text: sidecar.used_when_text ?? null,
    outcome_text: sidecar.outcome_text,
    it_will_be_able_to: sidecar.it_will_be_able_to,
    caveat_text: sidecar.caveat_text ?? null,
    bundle_manifest: folder.manifest,
    bundled_skills: folder.bundled_skills.map(build_template_payload),
  };
}

/**
 * What must already exist in the workspace. Merged from four places so an author never restates
 * something the folder already says.
 */
export function derive_requirements(folder: SkillFolder): TemplateRequirement[] {
  const sidecar = sidecar_or_default(folder);
  const from_listeners = sidecar.starts_when.flatMap((start) =>
    start.listens_to
      ? [
          {
            requirement_kind: 'node' as const,
            requirement_key: start.listens_to.node_key,
            requirement_label: start.listens_to.app_key ?? start.listens_to.node_key,
            is_optional: false,
            requirement_config: { connect_before_first_run: true },
          },
        ]
      : [],
  );
  const from_allowed_tools = folder.allowed_tools.map((tool) => ({
    requirement_kind: 'node' as const,
    requirement_key: tool,
    requirement_label: tool,
    is_optional: true,
    requirement_config: { explain_to_the_installer: 'Listed by the author as a tool it may use.' },
  }));
  const from_bundled_skills = folder.bundled_skills.map((nested) => ({
    requirement_kind: 'template' as const,
    requirement_key: nested.frontmatter.name,
    requirement_label: nested.frontmatter.name,
    is_optional: false,
    requirement_config: {},
  }));
  return dedupe_requirements([
    ...sidecar.requires,
    ...from_listeners,
    ...from_allowed_tools,
    ...from_bundled_skills,
  ]);
}

function dedupe_requirements(requirements: TemplateRequirement[]) {
  const by_key = new Map<string, TemplateRequirement>();
  for (const requirement of requirements) {
    const key = `${requirement.requirement_kind}:${requirement.requirement_key}`;
    const existing = by_key.get(key);
    if (!existing || (existing.is_optional && !requirement.is_optional))
      by_key.set(key, requirement);
  }
  return [...by_key.values()];
}

/**
 * The install questions: the ones the author wrote, then the ones the folder implies.
 *
 * The timezone question is implied rather than written, because the workspace default is the most
 * common Slack member timezone falling back to UTC — silently wrong for a workspace without Slack.
 * It comes last: it is ours, not the author's, and the author's questions are the ones that say
 * what this listing is about.
 */
export function derive_setup_input_schema(folder: SkillFolder): TemplateSetupInput {
  const sidecar = sidecar_or_default(folder);
  const asks_for_timezone = sidecar.starts_when.some(
    (start) => start.read_timezone_from === 'ask_the_installer',
  );
  return {
    ask_the_installer_for: [
      ...sidecar.asks_you_for,
      ...(asks_for_timezone
        ? [
            {
              input_key: 'timezone',
              label: describe_timezone_question(sidecar.starts_when),
              input_type: 'timezone',
              is_required: true,
              default_value: 'Europe/London',
              help_text: 'Its schedule follows this, not the server clock.',
            },
          ]
        : []),
    ],
  };
}

function derive_facets(folder: SkillFolder): TemplateFacet[] {
  const sidecar = sidecar_or_default(folder);
  const from_apps = derive_requirements(folder)
    .filter((requirement) => requirement.requirement_kind === 'app_connection')
    .map((requirement) => ({
      facet_kind: 'app' as const,
      facet_key: requirement.requirement_key,
      is_primary: false,
    }));
  const seen = new Set<string>();
  return [...sidecar.facets, ...from_apps].filter((facet) => {
    const key = `${facet.facet_kind}:${facet.facet_key}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function derive_display_name(folder: SkillFolder) {
  const from_metadata = folder.frontmatter.metadata?.display_name;
  if (typeof from_metadata === 'string' && from_metadata.length > 0) return from_metadata;
  const words = folder.folder_name.split('-');
  const [first = '', ...rest] = words;
  return [first.charAt(0).toUpperCase() + first.slice(1), ...rest].join(' ');
}

async function publish_skill_folder(
  db: Database,
  input: { folder: SkillFolder; actor_id: string },
) {
  const { folder } = input;
  reject_bundle_with_credentials(folder.manifest, folder.folder_name);

  const sidecar = sidecar_or_default(folder);
  const payload = build_template_payload(folder);
  const facets = derive_facets(folder);

  return publish_global_template(db, {
    template_slug: folder.frontmatter.name,
    template_kind: derive_template_kind(folder),
    template_name: derive_display_name(folder),
    summary_text: sidecar.summary_text || folder.frontmatter.description,
    readme_markdown: folder.instruction_markdown,
    model_facing_description: folder.frontmatter.description,
    payload,
    setup_input_schema: derive_setup_input_schema(folder),
    requirements: derive_requirements(folder),
    facets,
    category_slugs: facets
      .filter((facet) => facet.facet_kind === 'category')
      .map((facet) => facet.facet_key),
    tags: folder.discovery_phrases,
    display_config: { icon: sidecar.icon },
    listing_state: sidecar.listing_state,
    ...platform_publisher,
    metadata: { published_from_folder: folder.folder_name },
    actor_id: input.actor_id,
  });
}

/** Publishes every folder in a library directory, nested skills included, in slug order. */
export async function publish_library(
  db: Database,
  input: { library_path: string; actor_id: string },
) {
  const published: Awaited<ReturnType<typeof publish_skill_folder>>[] = [];
  for (const folder of read_library_folders(input.library_path)) {
    for (const nested of folder.bundled_skills) {
      published.push(await publish_skill_folder(db, { folder: nested, actor_id: input.actor_id }));
    }
    published.push(await publish_skill_folder(db, { folder, actor_id: input.actor_id }));
  }
  return published;
}
