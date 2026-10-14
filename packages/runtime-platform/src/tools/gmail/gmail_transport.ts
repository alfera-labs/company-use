import { AppError } from '@coworker/shared';
import {
  composio_is_configured,
  get_composio_client,
} from '@runtime-platform/composio/composio_client';
import { read_connected_account_id } from '@runtime-platform/composio/composio_connect';
import { create_composio_gmail_transport } from '@runtime-platform/tools/gmail/composio_gmail_transport';
import type { GmailTransport } from '@runtime-platform/tools/gmail/gmail_api';
import type { GmailConnection } from '@runtime-platform/tools/gmail/gmail_connection';

type TransportContext = { workspace_id: string; signal?: AbortSignal | undefined };

const gmail_transport_builders: Record<
  string,
  (connection: GmailConnection, context: TransportContext) => GmailTransport
> = {
  composio: (connection, context) => {
    const connected_account_id = read_connected_account_id(connection);
    if (!composio_is_configured() || !connected_account_id) {
      throw unusable_connection(
        connection,
        'Composio is not configured or the account id is missing',
      );
    }
    return create_composio_gmail_transport({
      client: get_composio_client(),
      connected_account_id,
      signal: context.signal,
    });
  },
};

export function create_gmail_transport(
  connection: GmailConnection,
  context: TransportContext,
): GmailTransport {
  const build = gmail_transport_builders[connection.provider_key];
  if (!build)
    throw unusable_connection(
      connection,
      `provider ${connection.provider_key} has no Gmail transport`,
    );
  return build(connection, context);
}

function unusable_connection(connection: GmailConnection, reason: string) {
  return new AppError(
    'connection_incomplete',
    `The Gmail connection ${connection.connection_id} cannot be used: ${reason}.`,
    409,
  );
}
