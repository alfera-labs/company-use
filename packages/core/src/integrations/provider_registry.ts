const integration_provider_keys = ['native', 'mcp', 'composio', 'custom_http'] as const;

export type IntegrationProviderKey = (typeof integration_provider_keys)[number];
