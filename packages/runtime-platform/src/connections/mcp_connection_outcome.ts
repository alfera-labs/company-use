export type McpConnectionOutcome =
  | { kind: 'connected'; app_id: string; app_name: string; tool_count: number }
  | {
      kind: 'needs_authorization';
      app_id: string;
      app_key: string;
      app_name: string;
      icon_url?: string | undefined;
      connection_id: string;
      start_url: string;
    }
  | { kind: 'refused'; because: string };
