import { product_brand_config } from '@coworker/config';
import { apps, type Database, nodes } from '@coworker/core';
import {
  build_node_key,
  catalog_app_name_max_length,
  catalog_node_version_maximum,
  create_id,
  id_prefixes,
  maximum_node_name_length,
  normalize_machine_name,
} from '@coworker/shared';
import { auth_type_for_connection_profile } from '@runtime-platform/tools/connection_profile_auth_type';
import { get_all_tools } from '@runtime-platform/tools/tool_registry';
import type {
  RuntimeToolConnectionProfile,
  RuntimeToolDefinition,
} from '@runtime-platform/tools/types';
import { and, eq, isNull } from 'drizzle-orm';

const actor_id = 'system:runtime_tool_catalog';

const app_icon_urls_by_name: Record<string, string> = {
  slack: '/logos/slack.svg',
};

type AppSeed = {
  app_name: string;
  app_display_name: string;
  app_category: string;
  auth_type: 'none' | 'api_key' | 'oauth2' | 'internal';
  provider_configs: Array<{
    provider_key: string;
    provider_config_key: string;
    version: number;
    status: 'active';
    provider_app_key: string;
    setup_defaults: Record<string, unknown>;
    connection_profiles: AppSeedConnectionProfile[];
  }>;
};

type AppSeedConnectionProfile = Omit<
  RuntimeToolConnectionProfile,
  'provider_key' | 'provider_config_key'
> & {
  version: number;
  status: 'active';
};

export async function seed_runtime_tool_catalog(db: Database) {
  const tools_by_app = group_tools_by_app(get_all_tools());

  for (const [app_name, app_tools] of tools_by_app) {
    const app = await upsert_runtime_catalog_app(db, build_app_seed(app_name, app_tools));

    for (const tool of app_tools) {
      await upsert_runtime_catalog_node(db, app, tool);
    }
  }
}

function group_tools_by_app(tools: RuntimeToolDefinition[]) {
  const grouped = new Map<string, RuntimeToolDefinition[]>();
  for (const tool of tools) {
    const current = grouped.get(tool.app_name) ?? [];
    current.push(tool);
    grouped.set(tool.app_name, current);
  }
  return grouped;
}

function build_app_seed(app_name: string, app_tools: RuntimeToolDefinition[]): AppSeed {
  const normalized_app_name = normalize_machine_name(app_name, {
    maximum_length: catalog_app_name_max_length,
  });
  const provider_configs = build_provider_configs(normalized_app_name, app_tools);
  if (normalized_app_name === 'runtime') {
    return {
      app_name: normalized_app_name,
      app_display_name: `${product_brand_config.product_brand_name} runtime`,
      app_category: 'internal',
      auth_type: 'internal',
      provider_configs,
    };
  }

  return {
    app_name: normalized_app_name,
    app_display_name: format_app_display_name(normalized_app_name),
    app_category: app_tools[0]?.category ?? 'tools',
    auth_type: auth_type_for_tools(app_tools),
    provider_configs,
  };
}

function build_provider_configs(app_name: string, app_tools: RuntimeToolDefinition[]) {
  const connection_profiles = unique_connection_profiles(app_tools);
  if (connection_profiles.length === 0) {
    return [
      {
        provider_key: 'native',
        provider_config_key: `native:${app_name}`,
        version: 1,
        status: 'active' as const,
        provider_app_key: app_name,
        setup_defaults: {},
        connection_profiles: [],
      },
    ];
  }

  const profiles_by_config = new Map<
    string,
    { provider_key: string; provider_config_key: string; profiles: RuntimeToolConnectionProfile[] }
  >();
  for (const profile of connection_profiles) {
    const key = `${profile.provider_key}:${profile.provider_config_key}`;
    const entry = profiles_by_config.get(key) ?? {
      provider_key: profile.provider_key,
      provider_config_key: profile.provider_config_key,
      profiles: [],
    };
    entry.profiles.push(profile);
    profiles_by_config.set(key, entry);
  }

  return [...profiles_by_config.values()].map((entry) => {
    return {
      provider_key: entry.provider_key,
      provider_config_key: entry.provider_config_key,
      version: 1,
      status: 'active' as const,
      provider_app_key: app_name,
      setup_defaults: {},
      connection_profiles: entry.profiles.map(connection_profile_values),
    };
  });
}

function connection_profile_values(
  profile: RuntimeToolConnectionProfile,
): AppSeedConnectionProfile {
  return {
    connection_profile_key: profile.connection_profile_key,
    auth_method_key: profile.auth_method_key,
    setup_strategy: profile.setup_strategy,
    runtime_credential_strategy: profile.runtime_credential_strategy,
    default_scopes: profile.default_scopes,
    version: 1,
    status: 'active',
  };
}

function unique_connection_profiles(app_tools: RuntimeToolDefinition[]) {
  const profiles = new Map<string, RuntimeToolConnectionProfile>();
  for (const tool of app_tools) {
    if (!tool.connection_profile) continue;
    profiles.set(tool.connection_profile.connection_profile_key, tool.connection_profile);
  }
  return [...profiles.values()];
}

function auth_type_for_tools(app_tools: RuntimeToolDefinition[]): AppSeed['auth_type'] {
  const first_profile = app_tools.find((tool) => tool.connection_profile)?.connection_profile;
  if (!first_profile) return 'none';
  return auth_type_for_connection_profile(first_profile);
}

function icon_display_config(app_name: string) {
  const icon_url = app_icon_urls_by_name[app_name];
  return icon_url ? { icon_url } : {};
}

async function upsert_runtime_catalog_app(db: Database, seed: AppSeed) {
  const values = {
    app_name: seed.app_name,
    app_key: seed.app_name,
    catalog_scope: 'global',
    app_display_name: seed.app_display_name,
    app_category: seed.app_category,
    auth_type: seed.auth_type,
    app_status: 'active',
    display_config: icon_display_config(seed.app_name),
    metadata: {
      sourced_from: {
        provider: 'native',
        provider_app_id: `native:${seed.app_name}`,
      },
      provider_configs: seed.provider_configs,
    },
  };

  const existing_app = await db.query.apps.findFirst({
    where: and(
      eq(apps.app_name, seed.app_name),
      eq(apps.catalog_scope, 'global'),
      isNull(apps.workspace_id),
    ),
  });

  if (existing_app) {
    const [app] = await db
      .update(apps)
      .set({
        ...values,
        last_updated_time: new Date(),
        last_updated_by: actor_id,
      })
      .where(eq(apps.app_id, existing_app.app_id))
      .returning();
    if (!app) throw new Error(`App seed failed: ${seed.app_name}`);
    return app;
  }

  const [app] = await db
    .insert(apps)
    .values({
      app_id: create_id(id_prefixes.app),
      ...values,
      created_by: actor_id,
      last_updated_by: actor_id,
    })
    .returning();
  if (!app) throw new Error(`App seed failed: ${seed.app_name}`);
  return app;
}

async function upsert_runtime_catalog_node(
  db: Database,
  app: typeof apps.$inferSelect,
  tool: RuntimeToolDefinition,
) {
  const values = runtime_node_values(app, tool);
  const [node] = await db
    .insert(nodes)
    .values({
      node_id: create_id(id_prefixes.node),
      ...values,
      created_by: actor_id,
      last_updated_by: actor_id,
    })
    .onConflictDoUpdate({
      target: [nodes.app_id, nodes.node_name],
      set: {
        ...values,
        last_updated_time: new Date(),
        last_updated_by: actor_id,
      },
    })
    .returning({ node_id: nodes.node_id });

  if (!node) {
    throw new Error(`Node seed failed: ${tool.node_key}`);
  }
}

function runtime_node_values(app: typeof apps.$inferSelect, tool: RuntimeToolDefinition) {
  const app_name = normalize_machine_name(tool.app_name, {
    maximum_length: catalog_app_name_max_length,
  });
  const node_name = normalize_machine_name(tool.node_name, {
    maximum_length: maximum_node_name_length(app_name, catalog_node_version_maximum),
  });
  const node_key = build_node_key({ app_name, node_name, node_version: 1 });
  if (node_key !== tool.node_key) {
    throw new Error(`Runtime tool node_key does not match its fields: ${tool.node_key}`);
  }
  return {
    app_id: app.app_id,
    app_key: app.app_key,
    catalog_scope: 'global',
    node_key,
    node_version: 1,
    node_name,
    node_display_name: tool.display_name,
    node_kind: 'tool',
    input_schema: tool.input_schema,
    output_schema: tool.output_schema,
    approval_policy: tool.approval_policy,
    runtime_handler: tool.runtime_handler,
    node_runtime: tool.required_connection ? 'connected_app' : 'native_tool',
    node_status: 'active',
    discovery_status: 'visible',
    provider_key: provider_key_for_tool(tool),
    provider_config_key: provider_config_key_for_tool(tool),
    provider_config_version: 1,
    connection_profile_key: tool.required_connection
      ? (tool.connection_profile?.connection_profile_key ??
        `${provider_key_for_tool(tool)}:${app_name}:default`)
      : null,
    connection_profile_version: tool.required_connection ? 1 : null,
    required_scopes: tool.required_scopes ?? tool.connection_profile?.default_scopes ?? [],
    required_account_properties: [],
    node_config: {
      sourced_from: {
        provider: provider_key_for_tool(tool),
        provider_app_id: provider_config_key_for_tool(tool),
        provider_component_id: tool.runtime_handler,
        provider_component_version: '1',
      },
    },
    metadata: {
      source: 'runtime_tool_registry',
      node_key: tool.node_key,
      description: tool.description,
      category: tool.category,
      app_name,
      required_connection: tool.required_connection,
      ...tool.metadata,
    },
  };
}

const provider_keys_by_runtime_handler_prefix: ReadonlyArray<[string, string]> = [['mcp.', 'mcp']];

function provider_key_for_tool(tool: RuntimeToolDefinition) {
  if (tool.connection_profile) return tool.connection_profile.provider_key;
  const match = provider_keys_by_runtime_handler_prefix.find(([prefix]) =>
    tool.runtime_handler.startsWith(prefix),
  );
  return match?.[1] ?? 'native';
}

function provider_config_key_for_tool(tool: RuntimeToolDefinition) {
  if (tool.connection_profile) return tool.connection_profile.provider_config_key;
  const provider_key = provider_key_for_tool(tool);
  if (provider_key === 'mcp') return `mcp:${tool.app_name}:first_party`;
  return `${provider_key}:${tool.app_name}`;
}

function format_app_display_name(app_name: string) {
  return app_name
    .split(/[_-]/u)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}
