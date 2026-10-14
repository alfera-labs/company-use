export type McpAuthenticationMode = 'always' | 'when_asked' | 'none';

export type InspectedMcpServer = {
  endpoint_url: string;
  server_name: string | null;
  icon_url: string | null;
  description: string | null;
  authentication: McpAuthenticationMode;
  offers_sign_in: boolean;
  supports_dynamic_registration: boolean;
};

export type AddedMcpServer =
  | { kind: 'connected'; app_id: string; app_name: string; tool_count: number }
  | {
      kind: 'needs_authorization';
      app_id: string;
      app_name: string;
      connection_id: string;
      start_url: string;
    };
