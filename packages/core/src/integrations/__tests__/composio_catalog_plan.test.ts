import {
  type ProviderAppUsage,
  plan_composio_catalog_migration,
  provider_app_is_in_use,
} from '@coworker/core/integrations/composio_catalog_plan';
import { describe, expect, it } from 'vitest';

function provider_app(overrides: Partial<ProviderAppUsage> & { app_name: string }) {
  return {
    app_id: `app_${overrides.app_name}`,
    app_display_name: overrides.app_name,
    provider_app_slug: overrides.app_name,
    connections: 0,
    active_connections: 0,
    tool_calls: 0,
    last_tool_call_time: null,
    enabled_node_refs: 0,
    ...overrides,
  } satisfies ProviderAppUsage;
}

describe('provider app usage', () => {
  it('counts a connection, a tool call, or an enabled tool as production use', () => {
    expect(provider_app_is_in_use(provider_app({ app_name: 'gmail', connections: 1 }))).toBe(true);
    expect(provider_app_is_in_use(provider_app({ app_name: 'gmail', tool_calls: 1 }))).toBe(true);
    expect(provider_app_is_in_use(provider_app({ app_name: 'gmail', enabled_node_refs: 1 }))).toBe(
      true,
    );
    expect(provider_app_is_in_use(provider_app({ app_name: 'gmail' }))).toBe(false);
  });
});

describe('composio catalog migration plan', () => {
  it('plans a toolkit Alfera serves natively as triggers only', () => {
    const plan = plan_composio_catalog_migration({
      toolkits: [{ slug: 'slack' }, { slug: 'slackbot' }, { slug: 'attio' }],
      reserved_app_names: new Set(['slack']),
    });

    expect(plan.native_toolkits_triggers_only).toEqual(['slack', 'slackbot']);
    expect(plan.toolkit_actions).toEqual([
      { toolkit_slug: 'attio', action: 'create', app_name: 'attio' },
      { toolkit_slug: 'slack', action: 'create', app_name: 'composio_slack', triggers_only: true },
      {
        toolkit_slug: 'slackbot',
        action: 'create',
        app_name: 'composio_slackbot',
        triggers_only: true,
      },
    ]);
  });

  it('never marks an ordinary toolkit triggers_only', () => {
    const plan = plan_composio_catalog_migration({
      toolkits: [{ slug: 'attio' }],
      reserved_app_names: new Set(),
    });

    expect(plan.toolkit_actions.every((action) => action.triggers_only === undefined)).toBe(true);
  });

  it('creates a new app for a toolkit no app row matches, around reserved names', () => {
    const plan = plan_composio_catalog_migration({
      toolkits: [{ slug: 'attio' }, { slug: 'serpapi' }],
      reserved_app_names: new Set(['serpapi']),
    });

    expect(plan.toolkit_actions).toEqual([
      { toolkit_slug: 'attio', action: 'create', app_name: 'attio' },
      { toolkit_slug: 'serpapi', action: 'create', app_name: 'composio_serpapi' },
    ]);
  });

  it('keeps a created app_name off a name a matched toolkit already claims', () => {
    const plan = plan_composio_catalog_migration({
      toolkits: [{ slug: 'gmail' }, { slug: 'gmail_v2' }],
      composio_apps: [{ app_name: 'gmail_v2', provider_app_slug: 'gmail' }],
      reserved_app_names: new Set(['gmail']),
    });

    expect(plan.toolkit_actions[0]).toMatchObject({
      action: 'update_composio',
      app_name: 'gmail_v2',
    });
    expect(plan.toolkit_actions[1]).toEqual({
      toolkit_slug: 'gmail_v2',
      action: 'create',
      app_name: 'composio_gmail_v2',
    });
  });
});

describe('plan_composio_catalog_migration re-runs', () => {
  it('keeps the name of a Composio app a previous sync wrote, even when it is reserved', () => {
    const plan = plan_composio_catalog_migration({
      toolkits: [{ slug: 'attio' }, { slug: 'serpapi' }],
      composio_apps: [{ app_name: 'attio', provider_app_slug: 'attio' }],
      reserved_app_names: new Set(['attio']),
    });
    expect(plan.toolkit_actions).toEqual([
      { toolkit_slug: 'attio', action: 'update_composio', app_name: 'attio' },
      { toolkit_slug: 'serpapi', action: 'create', app_name: 'serpapi' },
    ]);
  });
});
