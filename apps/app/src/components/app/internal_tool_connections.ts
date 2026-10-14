import { z } from 'zod';
import {
  type InternalToolDefinition,
  type InternalToolView,
  safe_http_url,
} from '@/components/app/internal_tool_view';

const connection_output = z.object({
  result_count: z.number(),
  connections: z.array(
    z.object({
      app_display_name: z.string(),
      connection_name: z.string().optional(),
      external_account_name: z.string().optional(),
      connection_status: z.string(),
      health_status: z.string().optional(),
      accessible: z.boolean().optional(),
    }),
  ),
});

const add_mcp_output = z.object({
  type: z.string().optional(),
  kind: z.string(),
  app_name: z.string().optional(),
  tool_count: z.number().optional(),
  message_for_user: z.string(),
});

const propose_output = z.object({
  ready: z.boolean(),
  connect_url: z.string().optional(),
  asks_for: z.array(z.string()).optional(),
  message_for_user: z.string().optional(),
  because: z.string().optional(),
});

const refresh_output = z.object({
  refreshed: z.boolean(),
  host: z.string(),
  message: z.string(),
  exchanged: z.boolean(),
  retry_allowed_after_time: z.string().optional(),
  hosts_now_authenticated: z.array(z.string()).optional(),
  attached_to_the_wrong_sandbox: z.boolean().optional(),
  browser_note: z.string().optional(),
});

export const connection_tool_definitions = {
  'runtime-list_connections': connection_definition('Connections', connections_view),
  'runtime-add_mcp_server': connection_definition('Connection setup', add_mcp_view),
  'runtime-propose_app_sign_in': connection_definition('App sign-in', propose_view),
  'runtime-refresh_app_credential': connection_definition('App sign-in', refresh_view),
} satisfies Record<string, InternalToolDefinition>;

function connection_definition(
  title: string,
  read_view: (output: unknown) => InternalToolView | null,
): InternalToolDefinition {
  return { family: 'connections', title, read_view: (_input, output) => read_view(output) };
}

function connections_view(output: unknown): InternalToolView | null {
  const parsed = connection_output.safeParse(output);
  if (!parsed.success) return null;
  const data = parsed.data;
  return {
    summary: `${data.result_count} ${data.result_count === 1 ? 'connection' : 'connections'}`,
    items: data.connections.map((connection) => ({
      title: connection.app_display_name,
      detail: connection_detail(connection),
    })),
    ...(data.connections.length === 0 ? { empty_message: 'No connections were found.' } : {}),
  };
}

function connection_detail(connection: z.infer<typeof connection_output>['connections'][number]) {
  const account = connection.external_account_name || connection.connection_name;
  const status = [connection.connection_status, connection.health_status]
    .filter(Boolean)
    .join(' · ');
  return [account, status, connection.accessible === false ? 'Restricted' : '']
    .filter(Boolean)
    .join(' · ');
}

function add_mcp_view(output: unknown): InternalToolView | null {
  const parsed = add_mcp_output.safeParse(output);
  if (!parsed.success || parsed.data.type === 'connection_setup') return null;
  const data = parsed.data;
  return {
    summary: data.message_for_user,
    fields: [
      ...(data.app_name ? [{ label: 'Server', value: data.app_name }] : []),
      ...(data.tool_count === undefined
        ? []
        : [{ label: 'Tools added', value: String(data.tool_count) }]),
    ],
  };
}

function propose_view(output: unknown): InternalToolView | null {
  const parsed = propose_output.safeParse(output);
  if (!parsed.success) return null;
  const data = parsed.data;
  const connect_url = safe_http_url(data.connect_url);
  return {
    summary: data.ready ? data.message_for_user || 'Sign-in is ready.' : 'Sign-in is not ready.',
    ...(!data.ready ? { notice: data.because || 'The sign-in could not be prepared.' } : {}),
    items: connect_url ? [{ title: 'Open sign-in', url: connect_url }] : [],
    fields: [
      { label: 'Ready', value: data.ready ? 'Yes' : 'No' },
      ...(data.asks_for?.length ? [{ label: 'Requests', value: data.asks_for.join(', ') }] : []),
    ],
  };
}

function refresh_view(output: unknown): InternalToolView | null {
  const parsed = refresh_output.safeParse(output);
  if (!parsed.success) return null;
  const data = parsed.data;
  return {
    summary: `${data.host} · ${data.refreshed ? 'Refreshed' : 'Not refreshed'}`,
    ...(data.browser_note
      ? { notice: data.browser_note }
      : !data.refreshed
        ? { notice: data.message }
        : {}),
    fields: [
      { label: 'Host', value: data.host },
      { label: 'Refreshed', value: data.refreshed ? 'Yes' : 'No' },
      { label: 'Signed in again', value: data.exchanged ? 'Yes' : 'No' },
      ...(data.attached_to_the_wrong_sandbox ? [{ label: 'Available here', value: 'No' }] : []),
      ...(data.retry_allowed_after_time
        ? [{ label: 'Retry after', value: data.retry_allowed_after_time }]
        : []),
    ],
    items: (data.hosts_now_authenticated ?? []).map((host) => ({ title: host })),
  };
}
