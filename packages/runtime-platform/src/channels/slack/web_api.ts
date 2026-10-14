import { connections, type Database } from '@coworker/core';
import type { ConnectionCredentialData } from '@coworker/core/db/schema/json_column_types';
import { read_connection_credential_value } from '@coworker/core/integrations/credential_envelope';
import { AppError } from '@coworker/shared';
import { WebClient } from '@slack/web-api';
import { and, eq } from 'drizzle-orm';

export async function create_slack_web_api(
  db: Database,
  workspace_id: string,
  connection_id: string,
  options?: ConstructorParameters<typeof WebClient>[1],
) {
  const connection = await db.query.connections.findFirst({
    where: and(
      eq(connections.workspace_id, workspace_id),
      eq(connections.connection_id, connection_id),
      eq(connections.connection_status, 'active'),
    ),
  });
  const token = read_slack_bot_token(connection?.credentials);
  if (!token) {
    throw new AppError(
      'slack_connection_incomplete',
      'Slack channel connection is missing a bot token.',
      400,
    );
  }
  return new WebClient(token, options);
}

function read_slack_bot_token(credentials: ConnectionCredentialData | null | undefined) {
  return (
    read_connection_credential_value(credentials, 'bot_token') ??
    read_connection_credential_value(credentials, 'access_token')
  );
}
