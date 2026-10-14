import { app_needs_a_connection } from '@coworker/shared';
import type { ProjectedChatToolPart } from '@/components/app/chat_stream_projection';
import type { CatalogApp } from '@/lib/api';
import { app_icon_url } from '@/lib/catalog_app';

const app_match_key_separator_re = /[_\s-]+/gu;

export function is_runtime_pseudo_app(name: string | undefined) {
  const normalized = name?.trim().toLowerCase();
  return normalized === 'runtime' || normalized === 'alfera runtime';
}

export function tool_part_place_name(part: ProjectedChatToolPart, apps: CatalogApp[]) {
  const app = find_tool_part_app(part, apps);
  if (!app || !app_needs_a_connection(app.auth_type)) return undefined;
  return is_runtime_pseudo_app(app.app_name) ? undefined : app.app_display_name;
}

export function tool_part_display(part: ProjectedChatToolPart, apps: CatalogApp[]) {
  const app = find_tool_part_app(part, apps);
  const icon_url = part.display?.iconUrl ?? (app ? app_icon_url(app) : undefined);
  const subtitle = app?.app_display_name ?? part.display?.subtitle;
  if (is_runtime_pseudo_app(app?.app_name) || is_runtime_pseudo_app(subtitle)) {
    return part.display?.title ? { title: part.display.title } : undefined;
  }

  if (!part.display && !icon_url && !subtitle) return undefined;
  return {
    ...(part.display?.appName ? { appName: part.display.appName } : {}),
    ...(icon_url ? { iconUrl: icon_url } : {}),
    ...(subtitle ? { subtitle } : {}),
    ...(part.display?.title ? { title: part.display.title } : {}),
  };
}

const normalized_apps_cache = new WeakMap<CatalogApp[], NormalizedApp[]>();

type NormalizedApp = { app: CatalogApp; nameKey: string; displayKey: string };

function normalized_apps_for_match(apps: CatalogApp[]): NormalizedApp[] {
  const cached = normalized_apps_cache.get(apps);
  if (cached) return cached;

  const normalized = apps.map((app) => ({
    app,
    nameKey: normalize_app_match_key(app.app_name) ?? '',
    displayKey: normalize_app_match_key(app.app_display_name) ?? '',
  }));
  normalized_apps_cache.set(apps, normalized);
  return normalized;
}

function find_tool_part_app(part: ProjectedChatToolPart, apps: CatalogApp[]) {
  const app_id = part.display?.appId;
  const app_name = part.display?.appName;
  const normalized_subtitle = normalize_app_match_key(part.display?.subtitle);

  return normalized_apps_for_match(apps).find(({ app, nameKey, displayKey }) => {
    if (app_id && app.app_id === app_id) return true;
    if (app_name && app.app_name === app_name) return true;
    if (!normalized_subtitle) return false;
    return nameKey === normalized_subtitle || displayKey === normalized_subtitle;
  })?.app;
}

function normalize_app_match_key(value: string | undefined) {
  return value?.trim().toLowerCase().replace(app_match_key_separator_re, '-');
}
