import type { CatalogApp, Connection } from '@/lib/api/types';

/**
 * The names the connection page shows, each said once. The title holds the name of the
 * connection, so the breadcrumb holds only what is above it: the app, when the app has
 * another name. The line under the title is the account, or the app when the breadcrumb does
 * not say it, or else the address of an MCP server, or nothing.
 */
export function read_connection_page_names(connection: Connection) {
  const app = connection.app as CatalogApp | null;
  const app_name = app?.app_display_name ?? connection.connection_name ?? 'Connection';
  const title = connection.connection_name ?? connection.external_account_name ?? app_name;
  const breadcrumb = app_name === title ? [] : [app_name];
  const under_the_title = connection.external_account_name ?? app_name;
  const is_said_already = under_the_title === title || breadcrumb.includes(under_the_title);
  return {
    app_name,
    title,
    breadcrumb,
    under_the_title: is_said_already ? read_mcp_server_address(connection) : under_the_title,
  };
}

/**
 * The address of the MCP server behind a connection, without a query or a password, which can
 * hold a key. Null for a connection that is not an MCP server.
 */
export function read_mcp_server_address(connection: Connection): string | null {
  const app = connection.app as { metadata?: { provider_configs?: unknown } } | null;
  const configs = Array.isArray(app?.metadata?.provider_configs)
    ? app.metadata.provider_configs
    : [];
  const mcp = configs.find((config) => config?.provider_key === 'mcp');
  const address = mcp?.setup_defaults?.url;
  if (typeof address !== 'string' || !URL.canParse(address)) return null;
  const { origin, pathname } = new URL(address);
  return `${origin}${pathname}`;
}
