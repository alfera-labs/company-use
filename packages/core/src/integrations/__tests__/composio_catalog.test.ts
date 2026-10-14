import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  composio_tool_schema,
  composio_toolkit_detail_schema,
  composio_trigger_type_schema,
} from '@coworker/core/integrations/composio_api_records';
import {
  build_composio_action_node_seed,
  build_composio_app_seed,
  build_composio_provider_config,
  build_composio_proxy_node_seeds,
  build_composio_trigger_node_seed,
  composio_app_auth_type,
  composio_node_name,
  composio_unmanaged_oauth_disabled_reason,
} from '@coworker/core/integrations/composio_catalog';
import { describe, expect, it } from 'vitest';

const synced_time = new Date('2026-09-13T00:00:00.000Z');

const attio_toolkit = composio_toolkit_detail_schema.parse({
  slug: 'attio',
  name: 'Attio',
  composio_managed_auth_schemes: ['OAUTH2'],
  base_url: 'https://api.attio.com/v2',
  auth_config_details: [
    {
      name: 'attio_oauth',
      mode: 'OAUTH2',
      required_scopes: ['record_permission:read-write'],
      fields: {
        auth_config_creation: {
          required: [
            { name: 'client_id', displayName: 'Client id', description: 'Client id of the app' },
            { name: 'client_secret', displayName: 'Client secret' },
          ],
          optional: [],
        },
        connected_account_initiation: { required: [], optional: [] },
      },
    },
  ],
  meta: {
    description: "Attio is a fully customizable workspace for your team's relationships.",
    logo: 'https://logos.composio.dev/api/attio',
    app_url: 'https://attio.com',
    categories: [{ slug: 'crm', name: 'CRM' }],
    tools_count: 100,
    triggers_count: 0,
    version: '20260909_00',
  },
});

const serpapi_toolkit = composio_toolkit_detail_schema.parse({
  slug: 'serpapi',
  name: 'SerpApi',
  composio_managed_auth_schemes: [],
  base_url: 'https://serpapi.com/search',
  auth_config_details: [
    {
      mode: 'API_KEY',
      required_scopes: [],
      fields: {
        auth_config_creation: { required: [], optional: [] },
        connected_account_initiation: {
          required: [
            {
              name: 'generic_api_key',
              displayName: 'API Key',
              description: 'Your SerpApi key',
              required: true,
              is_secret: true,
            },
          ],
          optional: [{ name: 'account_label' }],
        },
      },
    },
  ],
  meta: {
    description: 'Search engine results API.',
    logo: 'https://logos.composio.dev/api/serpapi',
    categories: [{ slug: 'analytics', name: 'Analytics' }],
    tools_count: 48,
    triggers_count: 0,
    version: '20260623_00',
  },
});

const stripe_toolkit = composio_toolkit_detail_schema.parse({
  slug: 'stripe',
  name: 'Stripe',
  composio_managed_auth_schemes: ['OAUTH2'],
  base_url: 'https://api.stripe.com/v1',
  auth_config_details: [
    {
      mode: 'API_KEY',
      required_scopes: [],
      fields: {
        auth_config_creation: { required: [], optional: [] },
        connected_account_initiation: {
          required: [{ name: 'generic_api_key', required: true, is_secret: true }],
          optional: [],
        },
      },
    },
    {
      mode: 'OAUTH2',
      required_scopes: [],
      fields: {
        auth_config_creation: {
          required: [{ name: 'client_id' }, { name: 'client_secret' }],
          optional: [],
        },
        connected_account_initiation: { required: [], optional: [] },
      },
    },
  ],
  meta: {
    logo: 'https://logos.composio.dev/api/stripe',
    categories: [{ slug: 'payment-processing', name: 'Payment Processing' }],
    tools_count: 426,
    triggers_count: 40,
    version: '20260911_00',
  },
});

const unmanaged_oauth_toolkit = composio_toolkit_detail_schema.parse({
  slug: 'notion',
  name: 'Notion',
  composio_managed_auth_schemes: [],
  auth_config_details: [
    {
      mode: 'OAUTH2',
      required_scopes: [],
      fields: {
        auth_config_creation: {
          required: [{ name: 'client_id' }, { name: 'client_secret' }],
          optional: [],
        },
        connected_account_initiation: { required: [], optional: [] },
      },
    },
  ],
  meta: { categories: [] },
});

const assert_company_tool = composio_tool_schema.parse({
  slug: 'ATTIO_ASSERT_COMPANY',
  name: 'Assert Company (Create or Update)',
  description: 'Create or update a company record.',
  toolkit: { slug: 'attio', name: 'attio' },
  input_parameters: {
    type: 'object',
    title: 'AssertCompanyRequest',
    required: ['matching_attribute'],
    properties: { matching_attribute: { type: 'string', title: 'Matching attribute' } },
  },
  output_parameters: { type: 'object', properties: { data: { type: 'object' } } },
  scopes: [
    'record_permission:read-write',
    'object_configuration:read',
    'https://mail.example/a',
    'https://mail.example/b',
  ],
  scope_requirements: {
    all_of: [
      { any_of: ['record_permission:read-write'] },
      { any_of: ['object_configuration:read'] },
      { any_of: ['https://mail.example/a', 'https://mail.example/b'] },
    ],
  },
  tags: ['important', 'createHint', 'updateHint'],
  version: '20260909_00',
});

const deprecated_tool = composio_tool_schema.parse({
  slug: 'ATTIO_LIST_RECORDS_OLD',
  name: 'List records (old)',
  toolkit: { slug: 'attio' },
  is_deprecated: true,
  no_auth: true,
});

const gmail_trigger = composio_trigger_type_schema.parse({
  slug: 'GMAIL_EMAIL_SENT_TRIGGER',
  name: 'Email Sent',
  description: 'Triggers when a Gmail message is sent by the authenticated user.',
  instructions: 'Optionally provide a search query.',
  type: 'poll',
  toolkit: { slug: 'gmail' },
  config: {
    type: 'object',
    properties: { interval: { type: 'number', default: 2 } },
  },
  payload: { type: 'object', properties: { subject: { type: 'string' } } },
  version: '20260911_00',
});

describe('composio provider config', () => {
  it('offers the hosted OAuth way to connect even though its auth config needs a client', () => {
    const config = build_composio_provider_config(attio_toolkit);

    expect(config.provider_key).toBe('composio');
    expect(config.provider_config_key).toBe('composio:attio');
    expect(config.provider_app_key).toBe('attio');
    expect(config.connection_profiles).toHaveLength(1);
    const [profile] = config.connection_profiles;
    expect(profile).toMatchObject({
      connection_profile_key: 'composio:attio:oauth2',
      version: 1,
      status: 'active',
      auth_method_key: 'composio_managed_oauth',
      default_scopes: ['record_permission:read-write'],
      runtime_credential_strategy: {
        type: 'provider_account_reference',
        send_to_provider_as: 'connected_account_id',
      },
    });
    expect(profile?.setup_strategy).toEqual({
      type: 'hosted_connect_link',
      auth_scheme: 'OAUTH2',
      auth_config_source: 'composio_managed',
      connected_account_fields: [],
    });
    expect(composio_app_auth_type(config)).toBe('oauth2');
  });

  it('offers an unhosted API key because creating its auth config asks us for nothing', () => {
    const config = build_composio_provider_config(serpapi_toolkit);
    const [profile] = config.connection_profiles;

    expect(profile).toMatchObject({
      connection_profile_key: 'composio:serpapi:api_key',
      status: 'active',
      auth_method_key: 'composio_custom_auth',
    });
    expect(profile?.setup_strategy).toEqual({
      type: 'hosted_connect_link',
      auth_scheme: 'API_KEY',
      auth_config_source: 'custom',
      connected_account_fields: [
        {
          name: 'generic_api_key',
          display_name: 'API Key',
          required: true,
          is_secret: true,
          description: 'Your SerpApi key',
        },
        { name: 'account_label', display_name: 'account_label', required: false, is_secret: false },
      ],
    });
    expect(composio_app_auth_type(config)).toBe('api_key');
  });

  it('refuses an OAuth app Composio does not host and says why', () => {
    const config = build_composio_provider_config(unmanaged_oauth_toolkit);
    const [profile] = config.connection_profiles;

    expect(profile?.status).toBe('disabled');
    expect(profile?.auth_method_key).toBe('composio_custom_auth');
    expect(profile?.setup_strategy.disabled_reason).toBe(composio_unmanaged_oauth_disabled_reason);
    expect(composio_app_auth_type(config)).toBe('none');
  });

  it('orders OAuth ahead of the API key even when the API responds the other way round', () => {
    const config = build_composio_provider_config(stripe_toolkit);

    expect(config.connection_profiles.map((profile) => profile.connection_profile_key)).toEqual([
      'composio:stripe:oauth2',
      'composio:stripe:api_key',
    ]);
    expect(config.connection_profiles.every((profile) => profile.status === 'active')).toBe(true);
  });

  it('falls back to a single NO_AUTH way to connect when the toolkit has no auth detail', () => {
    const toolkit = composio_toolkit_detail_schema.parse({
      slug: 'weathermap',
      name: 'Weather Map',
      meta: { categories: [] },
    });
    const config = build_composio_provider_config(toolkit);

    expect(config.connection_profiles).toHaveLength(1);
    expect(config.connection_profiles[0]).toMatchObject({
      connection_profile_key: 'composio:weathermap:no_auth',
      status: 'active',
      auth_method_key: 'none',
    });
    expect(composio_app_auth_type(config)).toBe('none');
  });

  it('falls back to the schemes Composio hosts when the toolkit lists no auth detail', () => {
    const toolkit = composio_toolkit_detail_schema.parse({
      slug: 'linkedin',
      name: 'LinkedIn',
      composio_managed_auth_schemes: ['OAUTH2'],
      meta: { categories: [] },
    });
    const config = build_composio_provider_config(toolkit);

    expect(config.connection_profiles).toHaveLength(1);
    expect(config.connection_profiles[0]).toMatchObject({
      connection_profile_key: 'composio:linkedin:oauth2',
      status: 'active',
      auth_method_key: 'composio_managed_oauth',
    });
  });
});

describe('composio app seed', () => {
  it('carries the toolkit display fields, its origin, and one provider config', () => {
    const seed = build_composio_app_seed({ toolkit: attio_toolkit, app_name: 'attio' });

    expect(seed).toMatchObject({
      app_name: 'attio',
      app_key: 'attio',
      provider_app_key: 'attio',
      app_display_name: 'Attio',
      app_category: 'CRM',
      auth_type: 'oauth2',
      allowed_request_origins: ['https://api.attio.com'],
    });
    expect(seed.metadata).toMatchObject({
      source: 'composio',
      sourced_from: {
        provider: 'composio',
        provider_app_id: 'attio',
        provider_app_slug: 'attio',
      },
      icon_url: 'https://logos.composio.dev/api/attio',
      categories: ['CRM'],
      app_url: 'https://attio.com',
      composio: {
        toolkit_version: '20260909_00',
        tools_count: 100,
        triggers_count: 0,
        auth_schemes: ['OAUTH2'],
        composio_managed_auth_schemes: ['OAUTH2'],
        base_url: 'https://api.attio.com/v2',
      },
      auth_config: {
        auth_methods: [
          {
            auth_method_type: 'oauth2',
            managed_by: 'composio',
            provider: { provider_type: 'composio', provider_app_slug: 'attio' },
            auth_scheme: 'OAUTH2',
          },
        ],
      },
    });
    expect(seed.metadata.provider_configs).toHaveLength(1);
    expect(seed.metadata.provider_configs?.[0]?.provider_config_key).toBe('composio:attio');
  });

  it('leaves the allowed origins empty when the toolkit has no static base url', () => {
    const seed = build_composio_app_seed({
      toolkit: unmanaged_oauth_toolkit,
      app_name: 'notion',
    });

    expect(seed.allowed_request_origins).toEqual([]);
    expect(seed.auth_type).toBe('none');
  });
});

describe('composio node seeds', () => {
  it('names a tool after its action, without the toolkit prefix', () => {
    expect(composio_node_name('ATTIO_ASSERT_COMPANY', 'attio', 40)).toBe('assert_company');
    expect(composio_node_name('SEARCH_THE_WEB', 'serpapi', 40)).toBe('search_the_web');
  });

  it('maps a tool into an action node', () => {
    const seed = build_composio_action_node_seed({
      toolkit: attio_toolkit,
      tool: assert_company_tool,
      app_name: 'attio',
      node_name: 'assert_company',
      synced_time,
    });

    expect(seed).toMatchObject({
      app_name: 'attio',
      node_name: 'assert_company',
      node_key: 'attio-assert_company-1',
      node_version: 1,
      node_kind: 'action',
      node_status: 'active',
      node_runtime: 'connected_app',
      runtime_handler: 'composio.ATTIO_ASSERT_COMPANY',
      required_scopes: ['record_permission:read-write', 'object_configuration:read'],
    });
    expect(seed.metadata.scope_requirements).toEqual(assert_company_tool.scope_requirements);
    expect(seed.node_config).toEqual({
      sourced_from: {
        provider: 'composio',
        provider_app_id: 'attio',
        provider_component_id: 'ATTIO_ASSERT_COMPANY',
        provider_component_version: '20260909_00',
        synced_from_catalog_time: synced_time.toISOString(),
      },
      composio: { toolkit_slug: 'attio', tool_slug: 'ATTIO_ASSERT_COMPANY', pinned_version: null },
    });
    expect(seed.metadata).toMatchObject({
      source: 'composio',
      app_name: 'attio',
      required_connection: true,
      annotations: { tags: ['important', 'createHint', 'updateHint'] },
      provider_definition: assert_company_tool,
    });
    expect(seed.input_schema.properties).toHaveProperty('matching_attribute');
  });

  it('requires no scope when every alternative of a recorded tool needs a different pair', () => {
    const recorded = JSON.parse(
      readFileSync(
        resolve(import.meta.dirname, 'fixtures', 'composio_hubspot_update_list_memberships.json'),
        'utf8',
      ),
    );
    const tool = composio_tool_schema.parse(recorded);

    const seed = build_composio_action_node_seed({
      toolkit: attio_toolkit,
      tool,
      app_name: 'hubspot',
      node_name: 'update_list_memberships',
      synced_time,
    });

    expect(seed.required_scopes).toEqual([]);
    expect(seed.metadata.scope_requirements).toEqual(recorded.scope_requirements);
  });

  it('requires a bare scope and every scope that all alternatives share', () => {
    const tool = composio_tool_schema.parse({
      slug: 'HUBSPOT_UPDATE_LIST_MEMBERSHIPS',
      name: 'Update list memberships',
      toolkit: { slug: 'hubspot' },
      scope_requirements: {
        all_of: [
          'oauth',
          {
            any_of: [
              { all_of: ['crm.lists.read', 'crm.lists.write'] },
              { all_of: ['crm.lists.read', 'crm.segments.write'] },
            ],
          },
          { any_of: ['crm.objects.contacts.read', 'crm.objects.companies.read'] },
        ],
      },
    });

    const seed = build_composio_action_node_seed({
      toolkit: attio_toolkit,
      tool,
      app_name: 'hubspot',
      node_name: 'update_list_memberships',
      synced_time,
    });

    expect(seed.required_scopes).toEqual(['oauth', 'crm.lists.read']);
  });

  it('marks a deprecated tool deprecated and a no_auth tool as needing no connection', () => {
    const seed = build_composio_action_node_seed({
      toolkit: attio_toolkit,
      tool: deprecated_tool,
      app_name: 'attio',
      node_name: 'list_records_old',
      synced_time,
    });

    expect(seed.node_status).toBe('deprecated');
    expect(seed.metadata.required_connection).toBe(false);
  });

  it('adds five proxy nodes for a toolkit with a static base url', () => {
    const seeds = build_composio_proxy_node_seeds({
      toolkit: attio_toolkit,
      app_name: 'attio',
      maximum_length: 40,
      synced_time,
    });

    expect(seeds.map((seed) => seed.node_name)).toEqual([
      'get_api_proxy',
      'post_api_proxy',
      'put_api_proxy',
      'patch_api_proxy',
      'delete_api_proxy',
    ]);
    expect(seeds.every((seed) => seed.runtime_handler === 'composio.api_proxy')).toBe(true);
    expect(seeds[0]?.approval_policy.mode).toBe('none');
    expect(seeds[1]?.approval_policy.mode).toBe('manual_review');
    expect(seeds[0]?.node_config.proxy).toEqual({
      method: 'get',
      url_mode: 'static_domain',
      base_proxy_target_url: 'https://api.attio.com/v2',
    });
    expect(seeds[0]?.node_config.sourced_from?.provider_component_id).toBe(
      'composio:api_proxy:get',
    );
    expect(seeds[1]?.input_schema.properties).toHaveProperty('body');
    expect(seeds[0]?.input_schema.properties).not.toHaveProperty('body');
  });

  it('adds no proxy node when the toolkit has a templated or missing base url', () => {
    const templated_toolkit = composio_toolkit_detail_schema.parse({
      slug: 'shopify',
      name: 'Shopify',
      base_url: 'https://{{shop}}.myshopify.com/admin/api',
      meta: { categories: [] },
    });

    expect(
      build_composio_proxy_node_seeds({
        toolkit: templated_toolkit,
        app_name: 'shopify',
        maximum_length: 40,
      }),
    ).toEqual([]);
    expect(
      build_composio_proxy_node_seeds({
        toolkit: unmanaged_oauth_toolkit,
        app_name: 'notion',
        maximum_length: 40,
      }),
    ).toEqual([]);
  });

  it('maps a trigger type into a trigger node', () => {
    const toolkit = composio_toolkit_detail_schema.parse({
      slug: 'gmail',
      name: 'Gmail',
      composio_managed_auth_schemes: ['OAUTH2'],
      meta: { categories: [] },
    });
    const seed = build_composio_trigger_node_seed({
      toolkit,
      trigger: gmail_trigger,
      app_name: 'gmail',
      node_name: 'email_sent_trigger',
      synced_time,
    });

    expect(seed).toMatchObject({
      node_kind: 'trigger',
      node_name: 'email_sent_trigger',
      node_key: 'gmail-email_sent_trigger-1',
      runtime_handler: 'composio.trigger.GMAIL_EMAIL_SENT_TRIGGER',
      approval_policy: { mode: 'none', reason: 'composio_trigger_definition' },
    });
    expect(seed.output_schema).toEqual(gmail_trigger.payload);
    expect(seed.input_schema.properties).toHaveProperty('interval');
    expect(seed.metadata).toMatchObject({
      trigger_mechanism: 'poll',
      instructions: 'Optionally provide a search query.',
      required_connection: true,
    });
    expect(seed.node_config.composio).toEqual({
      toolkit_slug: 'gmail',
      trigger_slug: 'GMAIL_EMAIL_SENT_TRIGGER',
    });
  });

  it('writes the subject field the payload describes onto the trigger node', () => {
    const stripe = composio_toolkit_detail_schema.parse({
      slug: 'stripe',
      name: 'Stripe',
      meta: { categories: [] },
    });
    const charge_failed = composio_trigger_type_schema.parse({
      slug: 'STRIPE_CHARGE_FAILED',
      name: 'Charge failed',
      type: 'webhook',
      toolkit: { slug: 'stripe', name: 'stripe' },
      config: {},
      payload: {
        type: 'object',
        properties: {
          account: { type: 'string' },
          data: {
            type: 'object',
            properties: { object: { type: 'object', properties: { id: { type: 'string' } } } },
          },
        },
      },
    });

    const seed = build_composio_trigger_node_seed({
      toolkit: stripe,
      trigger: charge_failed,
      app_name: 'stripe',
      node_name: 'charge_failed',
      synced_time,
    });

    expect(seed.node_config.subject_field).toBe('data.object.id');
  });

  it('leaves the subject field off a trigger whose payload has no conversation in it', () => {
    const toolkit = composio_toolkit_detail_schema.parse({
      slug: 'gmail',
      name: 'Gmail',
      meta: { categories: [] },
    });
    const seed = build_composio_trigger_node_seed({
      toolkit,
      trigger: gmail_trigger,
      app_name: 'gmail',
      node_name: 'email_sent_trigger',
      synced_time,
    });

    expect(seed.node_config.subject_field).toBeUndefined();
  });
});

describe('composio output schema parity with the earlier import', () => {
  const permissive_output_schema = {
    type: 'object',
    properties: {},
    additionalProperties: true,
  };

  it('gives a tool with no output parameters the permissive object schema', () => {
    const tool_without_output = composio_tool_schema.parse({
      slug: 'ATTIO_PING',
      name: 'Ping',
      toolkit: { slug: 'attio', name: 'attio' },
      input_parameters: { type: 'object', properties: {} },
    });

    const seed = build_composio_action_node_seed({
      toolkit: attio_toolkit,
      tool: tool_without_output,
      app_name: 'attio',
      node_name: 'ping',
      synced_time,
    });

    expect(seed.output_schema).toEqual(permissive_output_schema);
  });

  it('keeps the output schema a tool does describe, file markers and all', () => {
    const seed = build_composio_action_node_seed({
      toolkit: attio_toolkit,
      tool: assert_company_tool,
      app_name: 'attio',
      node_name: 'assert_company',
      synced_time,
    });

    expect(seed.output_schema).toEqual(assert_company_tool.output_parameters);
  });

  it('gives a trigger with no payload the permissive object schema', () => {
    const toolkit = composio_toolkit_detail_schema.parse({
      slug: 'gmail',
      name: 'Gmail',
      meta: { categories: [] },
    });
    const trigger_without_payload = composio_trigger_type_schema.parse({
      slug: 'GMAIL_NEW_LABEL_TRIGGER',
      name: 'New label',
      type: 'poll',
      toolkit: { slug: 'gmail', name: 'gmail' },
      config: {},
    });

    const seed = build_composio_trigger_node_seed({
      toolkit,
      trigger: trigger_without_payload,
      app_name: 'gmail',
      node_name: 'new_label_trigger',
      synced_time,
    });

    expect(seed.output_schema).toEqual(permissive_output_schema);
    expect(seed.input_schema).toEqual({ type: 'object', properties: {} });
  });

  it('gives every proxy node the same permissive output schema', () => {
    const seeds = build_composio_proxy_node_seeds({
      toolkit: attio_toolkit,
      app_name: 'attio',
      maximum_length: 40,
      synced_time,
    });

    expect(seeds).toHaveLength(5);
    expect(seeds.every((seed) => seed.node_config.sourced_from !== undefined)).toBe(true);
    for (const seed of seeds) {
      expect(seed.output_schema).toEqual(permissive_output_schema);
    }
  });

  it('stamps provider component id, version, and sync time on every node kind', () => {
    const toolkit = composio_toolkit_detail_schema.parse({
      slug: 'gmail',
      name: 'Gmail',
      base_url: 'https://gmail.googleapis.com',
      meta: { categories: [] },
    });
    const seeds = [
      build_composio_action_node_seed({
        toolkit: attio_toolkit,
        tool: assert_company_tool,
        app_name: 'attio',
        node_name: 'assert_company',
        synced_time,
      }),
      build_composio_trigger_node_seed({
        toolkit,
        trigger: gmail_trigger,
        app_name: 'gmail',
        node_name: 'email_sent_trigger',
        synced_time,
      }),
      ...build_composio_proxy_node_seeds({
        toolkit,
        app_name: 'gmail',
        maximum_length: 40,
        synced_time,
      }),
    ];

    for (const seed of seeds) {
      expect(seed.node_config.sourced_from).toMatchObject({
        provider: 'composio',
        synced_from_catalog_time: synced_time.toISOString(),
      });
      expect(seed.node_config.sourced_from?.provider_component_id).toBeTruthy();
      expect(seed.node_config.sourced_from).toHaveProperty('provider_component_version');
      expect(seed.metadata).toMatchObject({ source: 'composio', app_name: seed.app_name });
      expect(seed.node_runtime).toBe('connected_app');
    }
  });
});
