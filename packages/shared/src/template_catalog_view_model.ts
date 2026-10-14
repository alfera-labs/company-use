/**
 * The one read model behind every templates surface.
 *
 * Composed server-side so both renderers stay dumb: the public marketing pages and the in-app
 * gallery render the same shape, and if they ever fork we maintain two marketplaces forever.
 * Task and skill share one envelope; four slots differ — what you get versus what it changes,
 * when it runs versus when it gets used, the guidance table, and the CTA verb.
 */

export type TemplateKind = 'task' | 'skill';

/** Whether a stranger can switch this listing on unaided. Everything on the shelf is ready. */
export type TemplateListingState = 'ready' | 'built_with_you';

/** An app a listing touches. `is_connected` is null on public pages, where there is no viewer. */
export type TemplateAppRef = {
  app_key: string;
  label: string;
  is_optional: boolean;
  is_connected: boolean | null;
};

export type TemplatePublisher = {
  display_name: string;
  is_platform: boolean;
};

/** One row of the catalogue. The whole row: kind, name, one line, apps, when it acts, publisher. */
export type TemplateCard = {
  kind: TemplateKind;
  slug: string;
  name: string;
  summary: string;
  listing_state: TemplateListingState;
  category: { facet_key: string; title: string } | null;
  when_line: string;
  apps: TemplateAppRef[];
  publisher: TemplatePublisher;
  is_installed: boolean;
};

/** One choice in the toolbar: a kind tab, a category chip, an app, a sort order. */
export type TemplateFilterOption = {
  key: string;
  label: string;
  listing_count: number | null;
  is_active: boolean;
};

/**
 * The catalogue page, whichever way it is filtered.
 *
 * One shape for the index, a category, a role, an app and a search, because they are one query
 * with a different filter — which is how 38 listings become a few hundred pages.
 */
export type TemplateCatalog = {
  total_count: number;
  filtered_count: number;
  installed_count: number;
  heading: string;
  query: string | null;
  kinds: TemplateFilterOption[];
  categories: TemplateFilterOption[];
  apps: TemplateFilterOption[];
  sorts: TemplateFilterOption[];
  listings: TemplateCard[];
};

export type TemplateAppRequirement = {
  app_key: string;
  label: string;
  why: string;
  is_optional: boolean;
  connection_status: 'connected' | 'not_connected' | 'unknown';
};

export type TemplateRisk = 'reads_data' | 'changes_data' | 'reaches_outside';

/** One line under "Access": what it may do, and the plainest name for the risk in doing it. */
export type TemplateAccessLine = {
  label: string;
  risk: TemplateRisk;
  risk_label: string;
};

/** One block under "When it runs". `token` is the same start in its shortest form. */
export type TemplateStartBlock = {
  icon: 'calendar' | 'bolt' | 'chat';
  title: string;
  token: string;
  note: string;
};

/** The icon beside an install question. Derived from its input type, never authored. */
export type TemplateSetupIcon = 'document' | 'table' | 'clock' | 'text' | 'list' | 'chat' | 'mail';

export type TemplateSetupQuestion = {
  input_key: string;
  label: string;
  icon: TemplateSetupIcon;
  example_answer: string | null;
};

/** One row of "The guidance" — a skill's rule table. */
export type TemplateGuidanceLine = { label: string; value: string };

type TemplateBundleEntry = {
  file_path: string;
  file_role: string;
  byte_size: number;
  note: string;
  preview_text: string | null;
};

export type TemplateListing = {
  kind: TemplateKind;
  slug: string;
  name: string;
  summary: string;
  outcome: string;
  setup_message: string;
  listing_state: TemplateListingState;
  category: { facet_key: string; title: string } | null;
  publisher: TemplatePublisher;

  what_you_get: string[];
  what_it_does: string[];
  guidance: TemplateGuidanceLine[];
  caveat: string | null;

  starts_when: TemplateStartBlock[];
  used_when: {
    summary: string;
    discovery_phrases: string[];
    note: string;
  } | null;

  apps: TemplateAppRequirement[];
  access: TemplateAccessLine[];
  setup_questions: TemplateSetupQuestion[];

  whats_inside: {
    file_count: number;
    total_bytes: number;
    contains_scripts: boolean;
    runs_shell_at_load: boolean;
    tree: TemplateBundleEntry[];
  };

  install: {
    template_id: string;
    state: 'ready' | 'needs_connections';
    cta_label: string;
    blocking: string[];
    will_create: { object_kind: string; count: number }[];
    authority_prompt: string;
    is_installed: boolean;
  };

  proof: null;
  reliability: {
    runs_counted: number;
    clean_runs: number;
    needed_you: number;
    median_minutes: number;
    most_common_correction: string;
  } | null;

  related: TemplateCard[];
  facets: { facet_kind: string; facet_key: string; is_primary: boolean }[];
  seo: { title: string; description: string; canonical_path: string };
};
