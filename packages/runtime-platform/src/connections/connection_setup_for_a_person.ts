import type { Database } from '@coworker/core';
import { with_access_for_a_new_connection } from '@coworker/core/db/queries/connection_access';
import { create_pending_connection_setup } from '@coworker/core/db/queries/connection_management';

/**
 * Starts the setup of a connection a person asked for, in the dashboard or through the
 * coworker in a chat. In team mode the account is that person's alone unless they chose
 * otherwise, and they share it afterwards. A connection the install sets up for the whole team
 * (its Slack app, an MCP server an admin adds) does not go through here.
 */
export function create_connection_setup_for_a_person(
  db: Database,
  input: Parameters<typeof create_pending_connection_setup>[1],
) {
  return create_pending_connection_setup(db, with_access_for_a_new_connection(input));
}
