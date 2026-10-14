import type { TemplateRow } from '@coworker/core/db/queries/template_catalog';
import { find_template_category } from '@coworker/core/templates/catalog_categories';
import {
  capitalize,
  describe_start_title,
  describe_start_token,
  describe_when_line,
  start_mode_icon,
} from '@coworker/core/templates/starts_when';
import {
  type BundleFile,
  type SetupQuestion,
  type StartsWhenEntry,
  type TemplateRequirement,
  template_facets_schema,
  template_requirements_schema,
  template_setup_input_schema,
} from '@coworker/core/templates/template_object';
import {
  type ParsedTemplatePayload,
  read_template_payload,
} from '@coworker/core/templates/template_payload';
import type {
  TemplateAccessLine,
  TemplateAppRef,
  TemplateAppRequirement,
  TemplateCard,
  TemplateKind,
  TemplateListing,
  TemplateListingState,
  TemplatePublisher,
  TemplateRisk,
  TemplateSetupIcon,
  TemplateSetupQuestion,
  TemplateStartBlock,
} from '@coworker/shared';
import { create_logger } from '@coworker/shared';

const log = create_logger('catalog_view_model');

/** What the current viewer already has. Absent on public pages, where there is no viewer. */
export type CatalogViewer = {
  connected_app_keys: Set<string>;
  installed_template_ids: Set<string>;
};

export const anonymous_viewer: CatalogViewer = {
  connected_app_keys: new Set(),
  installed_template_ids: new Set(),
};

function read_kind(template: TemplateRow): TemplateKind {
  return template.template_kind === 'skill' ? 'skill' : 'task';
}

function read_listing_state(template: TemplateRow): TemplateListingState {
  return template.listing_state === 'ready' ? 'ready' : 'built_with_you';
}

function read_publisher(template: TemplateRow): TemplatePublisher {
  return {
    display_name: template.publisher_display_name || 'Alfera',
    is_platform: template.publisher_kind === 'platform',
  };
}

function cta_label(kind: TemplateKind) {
  return kind === 'skill' ? 'Add skill' : 'Add template';
}

function build_setup_message(input: {
  name: string;
  payload: ParsedTemplatePayload;
  kind: TemplateKind;
  apps: TemplateAppRequirement[];
  questions: TemplateSetupQuestion[];
}): string {
  const { name, payload, kind, apps, questions } = input;
  const ask =
    kind === 'skill'
      ? `Learn this skill for our workspace. Ask me for anything it leaves blank, then save it.`
      : `Set up this task for me. Ask me for the details you need, then schedule it.`;

  const parts = [`${ask}\n\nTemplate: ${name}`];

  if (apps.length > 0) {
    const lines = apps.map(
      (app) => `- ${app.label}${app.is_optional ? ' (optional)' : ''}: ${app.why}`,
    );
    parts.push(
      `It needs these connections — check them, and help me connect any that are missing:\n${lines.join('\n')}`,
    );
  }

  if (questions.length > 0) {
    parts.push(
      `Ask me before you create anything:\n${questions.map((question) => `- ${question.label}`).join('\n')}`,
    );
  }

  const starts = payload.starts_when.map(describe_start_for_setup).filter(Boolean);
  if (starts.length > 0) {
    parts.push(`It should run:\n${starts.map((line) => `- ${line}`).join('\n')}`);
  }

  parts.push(payload.instruction_markdown);
  return parts.join('\n\n');
}

function describe_start_for_setup(entry: StartsWhenEntry): string {
  if (entry.start_mode === 'you_ask') return 'on request, whenever I ask';
  if (entry.start_mode === 'on_a_schedule') {
    return `on the schedule \`${entry.schedule_expression ?? ''}\` (${entry.label ?? 'a schedule'}) — confirm the time and timezone with me first`;
  }
  return `${entry.label ?? 'when the event happens'} — if you cannot listen for that event yet, say so and offer me the closest schedule instead`;
}

/**
 * The same card, or null when the row's payload is not a listing this renderer understands.
 *
 * Only `publish_global_template` writes these rows, so an unrenderable one is a publishing bug —
 * and one bad row must not take down the whole shelf, which is what a throw here would do.
 */
export function build_template_card_or_skip(
  template: TemplateRow,
  viewer: CatalogViewer = anonymous_viewer,
): TemplateCard | null {
  try {
    return build_template_card(template, viewer);
  } catch {
    log.warn('skipped an unrenderable listing', {
      template_id: template.template_id,
      template_slug: template.template_slug,
    });
    return null;
  }
}

function build_template_card(
  template: TemplateRow,
  viewer: CatalogViewer = anonymous_viewer,
): TemplateCard {
  const payload = read_template_payload(template.payload);
  const kind = read_kind(template);
  return {
    kind,
    slug: template.template_slug,
    name: template.template_name,
    summary: template.summary_text,
    listing_state: read_listing_state(template),
    category: read_category(template),
    when_line: describe_when(payload, kind),
    apps: build_app_refs(template, viewer),
    publisher: read_publisher(template),
    is_installed: viewer.installed_template_ids.has(template.template_id),
  };
}

function describe_when(payload: ParsedTemplatePayload, kind: TemplateKind) {
  if (kind === 'skill') return payload.used_when_text ?? 'Used whenever it applies';
  return describe_when_line(payload.starts_when);
}

function build_app_refs(template: TemplateRow, viewer: CatalogViewer): TemplateAppRef[] {
  return read_app_requirements(template).map((requirement) => ({
    app_key: requirement.requirement_key,
    label: requirement.requirement_label || requirement.requirement_key,
    is_optional: requirement.is_optional,
    is_connected:
      viewer === anonymous_viewer
        ? null
        : viewer.connected_app_keys.has(requirement.requirement_key),
  }));
}

function read_app_requirements(template: TemplateRow): TemplateRequirement[] {
  return template_requirements_schema
    .parse(template.requirements)
    .filter((requirement) => requirement.requirement_kind === 'app_connection');
}

export function build_template_listing(
  template: TemplateRow,
  input: { viewer?: CatalogViewer; related?: TemplateRow[] } = {},
): TemplateListing {
  const viewer = input.viewer ?? anonymous_viewer;
  const payload = read_template_payload(template.payload);
  const kind = read_kind(template);
  const listing_state = read_listing_state(template);
  const apps = read_app_requirements(template).map((requirement) =>
    to_app_requirement(requirement, viewer),
  );

  return {
    kind,
    slug: template.template_slug,
    name: template.template_name,
    summary: template.summary_text,
    outcome: payload.outcome_text,
    setup_message: build_setup_message({
      name: template.template_name,
      payload,
      kind,
      apps,
      questions: read_setup_questions(template),
    }),
    listing_state,
    category: read_category(template),
    publisher: read_publisher(template),

    what_you_get: kind === 'skill' ? payload.what_it_does : payload.what_you_get,
    what_it_does: kind === 'skill' ? [] : payload.what_it_does,
    guidance: payload.guidance,
    caveat: payload.caveat_text,

    starts_when: kind === 'task' ? payload.starts_when.map(to_start_block) : [],
    used_when:
      kind === 'skill'
        ? {
            summary: 'Used automatically when relevant',
            discovery_phrases: payload.discovery_phrases,
            note: 'You never name it. It gets read whenever it applies, in any task and any chat.',
          }
        : null,

    apps,
    access: payload.it_will_be_able_to.map((entry) => to_access_line(entry, kind)),
    setup_questions: read_setup_questions(template),

    whats_inside: {
      file_count: payload.bundle_manifest.file_count,
      total_bytes: payload.bundle_manifest.total_bytes,
      contains_scripts: payload.bundle_manifest.files.some((file) => file.file_role === 'script'),
      runs_shell_at_load: false,
      tree: payload.bundle_manifest.files.map(to_tree_entry),
    },

    install: {
      template_id: template.template_id,
      state: build_install_state(apps),
      cta_label: cta_label(kind),
      blocking: apps
        .filter((app) => !app.is_optional && app.connection_status === 'not_connected')
        .map((app) => `Connect ${app.label} first.`),
      will_create: build_will_create(payload, kind),
      authority_prompt: build_authority_prompt(payload),
      is_installed: viewer.installed_template_ids.has(template.template_id),
    },

    proof: null,
    reliability: null,

    related: (input.related ?? []).map((row) => build_template_card(row, viewer)),
    facets: template_facets_schema.parse(template.facets),
    seo: {
      title: `${template.template_name} · Alfera templates`,
      description: template.summary_text,
      canonical_path: `/templates/${template.template_slug}`,
    },
  };
}

function read_category(template: TemplateRow) {
  const facets = template_facets_schema.parse(template.facets);
  const categories = facets.filter((facet) => facet.facet_kind === 'category');
  const primary = categories.find((facet) => facet.is_primary) ?? categories[0];
  if (!primary) return null;
  const category = find_template_category(primary.facet_key);
  return { facet_key: primary.facet_key, title: category?.title ?? capitalize(primary.facet_key) };
}

function to_start_block(start: ParsedTemplatePayload['starts_when'][number]): TemplateStartBlock {
  return {
    icon: start_mode_icon(start),
    title: describe_start_title(start),
    token: capitalize(describe_start_token(start)),
    note: start.note ?? '',
  };
}

const risk_labels: Record<TemplateRisk, string> = {
  reads_data: 'Reads data',
  changes_data: 'Changes data',
  reaches_outside: 'Uses the web',
};

function to_access_line(
  entry: { capability: string; risk: TemplateRisk },
  kind: TemplateKind,
): TemplateAccessLine {
  const is_guidance = kind === 'skill' && entry.risk === 'reads_data';
  return {
    label: capitalize(entry.capability),
    risk: entry.risk,
    risk_label: is_guidance ? 'Reads guidance' : risk_labels[entry.risk],
  };
}

const setup_icons: Record<string, TemplateSetupIcon> = {
  document: 'document',
  sheet: 'document',
  file: 'document',
  columns: 'table',
  table: 'table',
  timezone: 'clock',
  time_of_day: 'clock',
  choice: 'list',
  list: 'list',
  channel: 'chat',
  email: 'mail',
  text: 'text',
};

function read_setup_questions(template: TemplateRow): TemplateSetupQuestion[] {
  return template_setup_input_schema
    .parse(template.setup_input_schema)
    .ask_the_installer_for.map(to_setup_question);
}

function to_setup_question(question: SetupQuestion): TemplateSetupQuestion {
  return {
    input_key: question.input_key,
    label: question.label,
    icon: setup_icons[question.input_type] ?? 'text',
    example_answer: question.example_answer ?? null,
  };
}

function build_install_state(apps: TemplateAppRequirement[]): TemplateListing['install']['state'] {
  const missing = apps.some((app) => !app.is_optional && app.connection_status === 'not_connected');
  return missing ? 'needs_connections' : 'ready';
}

function to_app_requirement(
  requirement: TemplateRequirement,
  viewer: CatalogViewer,
): TemplateAppRequirement {
  return {
    app_key: requirement.requirement_key,
    label: requirement.requirement_label || requirement.requirement_key,
    why: requirement.requirement_config.explain_to_the_installer ?? '',
    is_optional: requirement.is_optional,
    connection_status:
      viewer === anonymous_viewer
        ? 'unknown'
        : viewer.connected_app_keys.has(requirement.requirement_key)
          ? 'connected'
          : 'not_connected',
  };
}

const file_role_notes: Record<string, string> = {
  instructions: 'the instructions, in plain English',
  sidecar: 'when it starts',
  reference: 'loaded when it needs it',
  script: 'runs in the sandbox',
  asset: 'bundled with it',
  bundled_skill: 'know-how scoped to this task',
};

const preview_byte_limit = 20 * 1024;

function to_tree_entry(file: BundleFile) {
  return {
    file_path: file.file_path,
    file_role: file.file_role,
    byte_size: file.byte_size,
    note: file_role_notes[file.file_role] ?? '',
    preview_text:
      file.inline_text !== undefined && file.byte_size <= preview_byte_limit
        ? file.inline_text
        : null,
  };
}

function build_will_create(payload: ParsedTemplatePayload, kind: TemplateKind) {
  if (kind === 'skill') return [{ object_kind: 'skill', count: 1 }];
  const trigger_count = payload.starts_when.filter(
    (start) => start.start_mode !== 'you_ask',
  ).length;
  return [
    { object_kind: 'task', count: 1 },
    ...(trigger_count > 0 ? [{ object_kind: 'trigger', count: trigger_count }] : []),
    ...(payload.bundled_skills.length > 0
      ? [{ object_kind: 'skill', count: payload.bundled_skills.length }]
      : []),
  ];
}

function build_authority_prompt(payload: ParsedTemplatePayload) {
  const changes = payload.it_will_be_able_to.filter((entry) => entry.risk !== 'reads_data');
  if (changes.length === 0) return 'It only reads. Nothing it does here changes your data.';
  return `It will ${changes.map((entry) => entry.capability).join(', and ')}.`;
}
