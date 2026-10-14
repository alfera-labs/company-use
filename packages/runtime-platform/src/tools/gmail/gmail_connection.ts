import type { Database } from '@coworker/core';
import type { Participants } from '@coworker/core/access/may_use_resource';
import {
  get_composio_app_by_toolkit,
  resolve_catalog_tool,
} from '@coworker/core/db/queries/catalog';
import { build_node_key } from '@coworker/shared';

const composio_gmail_toolkit_slug = 'gmail';
const gmail_read_proxy_node_name = 'get_api_proxy';

export type GmailConnectionRequest = {
  workspace_id: string;
  connection_id?: string | undefined;
  participants?: Participants | undefined;
  room_private_to?: string | null | undefined;
};

type CatalogResolution = Awaited<ReturnType<typeof resolve_catalog_tool>>;
export type GmailConnection = NonNullable<CatalogResolution['connection']>;

export type FoundGmailConnection =
  | { ok: true; connection: GmailConnection }
  | { ok: false; code: string; message: string };

/**
 * Finds the Gmail connection this conversation may use, through the Gmail
 * API-proxy catalog tool of its provider, so the same connection
 * matching, sharing grants, participant and private-room checks apply as for any catalog tool.
 * Composio's app name differs per environment, so it is looked up by toolkit.
 */
export async function find_gmail_connection(
  db: Database,
  request: GmailConnectionRequest,
): Promise<FoundGmailConnection> {
  const node_keys = await list_gmail_proxy_node_keys(db, request.workspace_id);
  const resolutions = await Promise.all(
    node_keys.map((node_key) =>
      resolve_catalog_tool(db, {
        workspace_id: request.workspace_id,
        node_key,
        ...(request.connection_id ? { connection_id: request.connection_id } : {}),
        ...(request.participants ? { participants: request.participants } : {}),
        room_private_to: request.room_private_to,
      }),
    ),
  );
  const usable = resolutions.find((resolved) => resolved.connection && resolved.compatibility.ok);
  if (usable?.connection) return { ok: true, connection: usable.connection };
  return explain_missing_connection(resolutions, request);
}

async function list_gmail_proxy_node_keys(db: Database, workspace_id: string) {
  const composio_app = await get_composio_app_by_toolkit(db, {
    workspace_id,
    toolkit_slug: composio_gmail_toolkit_slug,
  });
  const app_names = composio_app ? [composio_app.app_name] : [];
  return app_names.map((app_name) =>
    build_node_key({ app_name, node_name: gmail_read_proxy_node_name, node_version: 1 }),
  );
}

function explain_missing_connection(
  resolutions: CatalogResolution[],
  request: GmailConnectionRequest,
): FoundGmailConnection {
  if (resolutions.some((resolved) => resolved.access_denied)) {
    return {
      ok: false,
      code: 'access_denied',
      message:
        "The Gmail connection is private to its owner and you're not on its access list, so I can't use it for you. Ask them to share it, or connect your own Gmail.",
    };
  }
  const unusable = resolutions.find((resolved) => resolved.connection);
  if (unusable && !unusable.compatibility.ok) {
    return {
      ok: false,
      code: unusable.compatibility.reason,
      message: `The Gmail connection ${unusable.connection?.connection_id} cannot be used (${unusable.compatibility.reason}). Reconnect Gmail.`,
    };
  }
  return {
    ok: false,
    code: 'connection_required',
    message: request.connection_id
      ? `${request.connection_id} is not an active Gmail connection this conversation may use.`
      : 'No active Gmail connection is available here. Connect Gmail first.',
  };
}
