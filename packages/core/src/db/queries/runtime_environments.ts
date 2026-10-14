import { createHash } from 'node:crypto';
import type { Database } from '@coworker/core/db/connection';
import {
  type RuntimeEnvironmentData,
  type RuntimeEnvironmentExplicitPreview,
  type RuntimeEnvironmentPreview,
  runtime_environments,
  sessions,
} from '@coworker/core/db/schema';
import { and, asc, desc, eq, isNotNull, notInArray, or, sql } from 'drizzle-orm';

export type SandboxUrlPreview = {
  sandbox_url_preview_id: string;
  runtime_environment_id: string;
  environment_provider: string;
  environment_status: string;
  preview_name: string;
  preview_url: string;
  preview_domain: string;
  sandbox_key: string;
  source: 'active' | 'explicit' | 'generated';
  last_updated_time: Date;
  port?: number;
  preview_kind?: 'browser_live_view';
  live_view_token?: string;
};

export type SandboxUrlPreviewOptions = {
  preview_base_domain: string;
  preview_protocol: 'https' | 'http';
  default_port: number;
  use_provider_host?: boolean;
};

export type SandboxUrlPreviewRoute = SandboxUrlPreview & {
  workspace_id: string;
  port: number;
};

export type SandboxPreviewUrlInput = {
  runtime_environment_id: string;
  provider_environment_id?: string | null;
  preview_base_domain: string;
  preview_protocol: 'https' | 'http';
  default_port: number;
  port: number;
  subdomain_seed?: string;
};

type RuntimeEnvironment = typeof runtime_environments.$inferSelect;

const preview_item_keys = [
  'sandbox_url_previews',
  'url_previews',
  'preview_urls',
  'previews',
] as const;
const subdomain_seed_keys = [
  'preview_subdomain',
  'sandbox_subdomain',
  'project_slug',
  'app_slug',
  'project_name',
  'app_name',
  'project_description',
  'app_description',
  'description',
] as const;
const preview_hash_suffix_length = 8;
const inactive_preview_environment_statuses = ['stopped', 'destroyed', 'failed'];
const browser_live_view_kind = 'browser_live_view';

export function list_running_e2b_environments_for_volume(
  db: Database,
  input: {
    workspace_id: string;
    agent_id: string;
    volume_id: string;
    volume_workspace_path: string;
  },
) {
  return db.query.runtime_environments.findMany({
    where: and(
      eq(runtime_environments.workspace_id, input.workspace_id),
      or(
        eq(runtime_environments.agent_id, input.agent_id),
        sql`${runtime_environments.environment_metadata}->>'agent_workspace_path' = ${input.volume_workspace_path}`,
      ),
      eq(runtime_environments.environment_provider, 'e2b'),
      eq(runtime_environments.environment_status, 'running'),
      isNotNull(runtime_environments.provider_environment_id),
      sql`${runtime_environments.environment_metadata}->>'volume_id' = ${input.volume_id}`,
    ),
    orderBy: (table) => [desc(table.last_started_time), desc(table.created_time)],
  });
}

export async function list_session_sandbox_url_previews(
  db: Database,
  input: {
    workspace_id: string;
    session_id: string;
    options: SandboxUrlPreviewOptions;
  },
) {
  const session = await db.query.sessions.findFirst({
    where: and(
      eq(sessions.workspace_id, input.workspace_id),
      eq(sessions.session_id, input.session_id),
    ),
  });
  if (!session) return null;

  const session_environment_filter = eq(runtime_environments.session_id, input.session_id);
  const environment_filter = session.runtime_environment_id
    ? or(
        session_environment_filter,
        eq(runtime_environments.runtime_environment_id, session.runtime_environment_id),
      )
    : session_environment_filter;

  const environments = await db.query.runtime_environments.findMany({
    where: and(
      eq(runtime_environments.workspace_id, input.workspace_id),
      eq(runtime_environments.environment_provider, 'e2b'),
      environment_filter,
    ),
    orderBy: (table) => [asc(table.created_time)],
  });

  return dedupe_previews(
    environments.flatMap((environment) => create_sandbox_url_previews(environment, input.options)),
  );
}

export async function resolve_sandbox_url_preview_route(
  db: Database,
  input: {
    preview_host: string;
    options: SandboxUrlPreviewOptions;
  },
): Promise<SandboxUrlPreviewRoute | null> {
  const preview_host = normalize_preview_host(input.preview_host);
  const preview_base_domain = strip_protocol(input.options.preview_base_domain).toLowerCase();
  if (!preview_host.endsWith(`.${preview_base_domain}`)) return null;

  const environments = await db.query.runtime_environments.findMany({
    where: and(
      eq(runtime_environments.environment_provider, 'e2b'),
      isNotNull(runtime_environments.provider_environment_id),
      notInArray(runtime_environments.environment_status, inactive_preview_environment_statuses),
    ),
    orderBy: (table) => [asc(table.created_time)],
  });

  for (const environment of environments) {
    const preview = create_sandbox_url_previews(environment, input.options).find(
      (preview): preview is SandboxUrlPreview & { port: number } =>
        preview.preview_domain.toLowerCase() === preview_host && preview.port !== undefined,
    );
    if (preview) return { ...preview, workspace_id: environment.workspace_id };
  }

  return null;
}

function create_sandbox_url_previews(
  environment: RuntimeEnvironment,
  options: SandboxUrlPreviewOptions,
): SandboxUrlPreview[] {
  if (environment.environment_provider !== 'e2b') return [];
  if (is_inactive_preview_environment_status(environment.environment_status)) return [];

  const previews = dedupe_previews([
    ...create_active_previews(environment, options),
    ...create_explicit_previews(environment),
  ]);
  if (!options.use_provider_host) return previews;
  return previews.map((preview) => with_provider_host_url(preview, environment));
}

function with_provider_host_url(
  preview: SandboxUrlPreview,
  environment: RuntimeEnvironment,
): SandboxUrlPreview {
  const provider_host = get_provider_preview_host(environment.environment_metadata);
  if (!provider_host) return preview;
  if (
    preview.port !== undefined &&
    provider_host.port !== undefined &&
    preview.port !== provider_host.port
  ) {
    return preview;
  }
  return {
    ...preview,
    preview_url: `https://${provider_host.host}`,
    preview_domain: provider_host.host,
  };
}

function get_provider_preview_host(metadata: RuntimeEnvironmentData) {
  const host = metadata.provider_preview_host;
  if (!host) return undefined;
  const port_match = /^(\d+)-/u.exec(host);
  return { host, port: port_match ? Number(port_match[1]) : undefined };
}

function is_inactive_preview_environment_status(status: string) {
  return inactive_preview_environment_statuses.some(
    (inactive_status) => inactive_status === status,
  );
}

export function create_sandbox_url_preview_url(input: SandboxPreviewUrlInput) {
  return `${input.preview_protocol}://${create_sandbox_url_preview_domain(input)}`;
}

function create_sandbox_url_preview_domain(input: SandboxPreviewUrlInput) {
  const sandbox_key = input.provider_environment_id ?? input.runtime_environment_id;
  return create_preview_domain({
    base_domain: input.preview_base_domain,
    port: input.port,
    sandbox_key,
    default_port: input.default_port,
    subdomain_seed: input.subdomain_seed ?? sandbox_key,
  });
}

function create_active_previews(
  environment: RuntimeEnvironment,
  options: SandboxUrlPreviewOptions,
): SandboxUrlPreview[] {
  const previews = list_active_previews(environment.environment_metadata);
  return previews.map((preview) => {
    const sandbox_key = environment.provider_environment_id ?? environment.runtime_environment_id;
    const preview_kind =
      preview.preview_kind === browser_live_view_kind ? browser_live_view_kind : undefined;
    const live_view_token =
      preview_kind === browser_live_view_kind && typeof preview.live_view_token === 'string'
        ? preview.live_view_token
        : undefined;
    const stored_url = get_preview_url(preview, options.preview_base_domain);
    const preview_url =
      stored_url ??
      create_sandbox_url_preview_url({
        runtime_environment_id: environment.runtime_environment_id,
        provider_environment_id: environment.provider_environment_id,
        preview_base_domain: options.preview_base_domain,
        preview_protocol: options.preview_protocol,
        default_port: options.default_port,
        port: preview.port,
        subdomain_seed:
          preview.subdomain_seed ??
          find_environment_subdomain_seed(environment) ??
          preview.preview_name ??
          sandbox_key,
      });
    const parsed_url = new URL(preview_url);

    return {
      sandbox_url_preview_id: `${environment.runtime_environment_id}:active:${preview.port}`,
      runtime_environment_id: environment.runtime_environment_id,
      environment_provider: environment.environment_provider,
      environment_status: environment.environment_status,
      preview_name:
        preview.preview_name ??
        preview.app_name ??
        preview.name ??
        (preview.port === options.default_port ? 'App preview' : `Port ${preview.port}`),
      preview_url,
      preview_domain: parsed_url.host,
      sandbox_key,
      source: 'active',
      port: preview.port,
      ...(preview_kind ? { preview_kind } : {}),
      ...(live_view_token ? { live_view_token } : {}),
      last_updated_time: environment.last_updated_time,
    };
  });
}

function create_explicit_previews(environment: RuntimeEnvironment): SandboxUrlPreview[] {
  const items = [
    ...list_explicit_preview_items(environment.environment_config),
    ...list_explicit_preview_items(environment.environment_metadata),
  ];

  return items.flatMap((item, index): SandboxUrlPreview[] => {
    const preview = create_explicit_preview(environment, item, index);
    return preview ? [preview] : [];
  });
}

function create_explicit_preview(
  environment: RuntimeEnvironment,
  item: string | RuntimeEnvironmentExplicitPreview,
  index: number,
): SandboxUrlPreview | null {
  const record = typeof item === 'string' ? {} : item;
  const url =
    typeof item === 'string'
      ? item
      : (record.preview_url ?? record.url ?? record.public_url ?? record.app_url);
  if (!url || !is_http_url(url)) return null;

  const parsed_url = new URL(url);
  const preview_name =
    record.preview_name ?? record.app_name ?? record.label ?? record.name ?? `Preview ${index + 1}`;
  const port = record.port ?? port_from_url(parsed_url);
  const sandbox_key = environment.provider_environment_id ?? environment.runtime_environment_id;

  return {
    sandbox_url_preview_id: `${environment.runtime_environment_id}:explicit:${index}`,
    runtime_environment_id: environment.runtime_environment_id,
    environment_provider: environment.environment_provider,
    environment_status: environment.environment_status,
    preview_name,
    preview_url: parsed_url.toString(),
    preview_domain: parsed_url.host,
    sandbox_key,
    source: 'explicit',
    ...(port === undefined ? {} : { port }),
    last_updated_time: environment.last_updated_time,
  };
}

function get_preview_url(record: RuntimeEnvironmentPreview, base_domain: string) {
  const value = record.preview_url ?? record.url ?? record.public_url ?? record.app_url;
  if (!value || !is_http_url(value)) return undefined;

  const parsed_url = new URL(value);
  const preview_base_domain = strip_protocol(base_domain).toLowerCase();
  const is_branded_preview = parsed_url.host.toLowerCase().endsWith(`.${preview_base_domain}`);
  const is_direct_e2b_preview =
    record.preview_kind === browser_live_view_kind &&
    record.preview_transport === 'provider_direct' &&
    parsed_url.protocol === 'https:' &&
    parsed_url.hostname.toLowerCase().endsWith('.e2b.app');
  return is_branded_preview || is_direct_e2b_preview
    ? parsed_url.toString().replace(/\/$/u, '')
    : undefined;
}

function list_explicit_preview_items(data: RuntimeEnvironmentData) {
  return preview_item_keys.flatMap((key) => data[key] ?? []);
}

function list_active_previews(data: RuntimeEnvironmentData): RuntimeEnvironmentPreview[] {
  const previews = new Map<number, RuntimeEnvironmentPreview>();

  for (const preview of Object.values(data.active_previews ?? {})) {
    previews.set(preview.port, preview);
  }

  if (data.active_preview && !previews.has(data.active_preview.port)) {
    previews.set(data.active_preview.port, data.active_preview);
  }

  for (const port of data.active_preview_ports ?? []) {
    if (!previews.has(port)) previews.set(port, { port });
  }

  return [...previews.values()].sort((left, right) => left.port - right.port);
}

function create_preview_domain(input: {
  base_domain: string;
  sandbox_key: string;
  port: number;
  default_port: number;
  subdomain_seed: string;
}) {
  const base_label = to_host_label(input.subdomain_seed);
  const suffix = hash_string(`${input.sandbox_key}:${input.port}`);
  const port_segment = input.port === input.default_port ? '' : `-${input.port}`;
  const label_budget = 48 - suffix.length - 1 - port_segment.length;
  const host_label = `${trim_host_label(base_label, label_budget)}${port_segment}-${suffix}`;
  return `${host_label}.${strip_protocol(input.base_domain)}`;
}

function to_host_label(value: string) {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9-]/gu, '-')
    .replace(/-{2,}/gu, '-')
    .replace(/^-|-$/gu, '');
  const label = normalized || 'sandbox';
  return trim_host_label(label, 48);
}

function trim_host_label(label: string, max_length: number) {
  if (label.length <= max_length) return label;
  return label.slice(0, max_length).replace(/-$/gu, '');
}

function find_environment_subdomain_seed(environment: RuntimeEnvironment) {
  return (
    find_subdomain_seed(environment.environment_config) ??
    find_subdomain_seed(environment.environment_metadata)
  );
}

function find_subdomain_seed(data: RuntimeEnvironmentData) {
  for (const key of subdomain_seed_keys) {
    const value = data[key];
    if (value) return value;
  }

  return undefined;
}

function strip_protocol(value: string) {
  return value.replace(/^https?:\/\//u, '').replace(/\/+$/u, '');
}

function normalize_preview_host(value: string) {
  return value.trim().toLowerCase().replace(/:\d+$/u, '');
}

function dedupe_previews(previews: SandboxUrlPreview[]) {
  const seen_urls = new Set<string>();
  return previews.filter((preview) => {
    if (seen_urls.has(preview.preview_url)) return false;
    seen_urls.add(preview.preview_url);
    return true;
  });
}

function port_from_url(url: URL) {
  const port = Number(url.port);
  return is_valid_port(port) ? port : undefined;
}

function is_valid_port(value: number) {
  return Number.isInteger(value) && value >= 1 && value <= 65_535;
}

function is_http_url(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function hash_string(value: string) {
  return createHash('sha256').update(value).digest('hex').slice(0, preview_hash_suffix_length);
}
