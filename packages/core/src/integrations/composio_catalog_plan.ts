import { build_provider_app_names } from '@coworker/core/integrations/provider_catalog_identity';

export type ProviderAppUsage = {
  app_id: string;
  app_name: string;
  app_display_name: string;
  provider_app_slug: string | null;
  connections: number;
  active_connections: number;
  tool_calls: number;
  last_tool_call_time: string | null;
  enabled_node_refs: number;
};

export type ComposioToolkitAction = {
  toolkit_slug: string;
  action: 'create' | 'update_composio';
  app_name: string;
  triggers_only?: boolean;
};

export type ComposioCatalogPlan = {
  toolkit_actions: ComposioToolkitAction[];
  native_toolkits_triggers_only: string[];
};

const native_only_toolkit_slugs: ReadonlySet<string> = new Set(['slack', 'slackbot']);

export function provider_app_is_in_use(usage: ProviderAppUsage) {
  return usage.connections > 0 || usage.tool_calls > 0 || usage.enabled_node_refs > 0;
}

export type ExistingComposioApp = { app_name: string; provider_app_slug: string | null };

export function plan_composio_catalog_migration(input: {
  toolkits: Array<{ slug: string; name?: string }>;
  composio_apps?: readonly ExistingComposioApp[];
  reserved_app_names: ReadonlySet<string>;
}): ComposioCatalogPlan {
  const native_toolkits_triggers_only = input.toolkits
    .map((toolkit) => toolkit.slug)
    .filter((slug) => native_only_toolkit_slugs.has(slug));
  const toolkit_slugs = input.toolkits
    .map((toolkit) => toolkit.slug)
    .filter((slug) => !native_only_toolkit_slugs.has(slug));
  const planned_slugs = [...toolkit_slugs, ...native_toolkits_triggers_only];
  const matched_actions = match_toolkits_to_existing_composio_apps(
    planned_slugs,
    input.composio_apps ?? [],
  );
  const created_app_names = build_provider_app_names(
    planned_slugs.filter((toolkit_slug) => !matched_actions.has(toolkit_slug)),
    new Set([
      ...input.reserved_app_names,
      ...native_toolkits_triggers_only,
      ...[...matched_actions.values()].map((action) => action.app_name),
    ]),
    { collision_prefix: 'composio_' },
  );

  return {
    toolkit_actions: planned_slugs.map((toolkit_slug) => {
      const action =
        matched_actions.get(toolkit_slug) ?? build_create_action(toolkit_slug, created_app_names);
      return native_only_toolkit_slugs.has(toolkit_slug)
        ? { ...action, triggers_only: true }
        : action;
    }),
    native_toolkits_triggers_only,
  };
}

function match_toolkits_to_existing_composio_apps(
  toolkit_slugs: readonly string[],
  composio_apps: readonly ExistingComposioApp[],
) {
  const app_name_by_slug = new Map(
    composio_apps.flatMap((app) =>
      app.provider_app_slug ? [[app.provider_app_slug, app.app_name] as const] : [],
    ),
  );
  return new Map<string, ComposioToolkitAction>(
    toolkit_slugs.flatMap((toolkit_slug) => {
      const app_name = app_name_by_slug.get(toolkit_slug);
      return app_name
        ? [[toolkit_slug, { toolkit_slug, action: 'update_composio', app_name }]]
        : [];
    }),
  );
}

function build_create_action(
  toolkit_slug: string,
  created_app_names: ReadonlyMap<string, string>,
): ComposioToolkitAction {
  const app_name = created_app_names.get(toolkit_slug);
  if (!app_name) throw new Error(`Composio toolkit identity was not prepared: ${toolkit_slug}`);
  return { toolkit_slug, action: 'create', app_name };
}
