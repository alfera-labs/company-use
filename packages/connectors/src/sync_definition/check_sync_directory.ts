import { find_json_schema_violation } from '@connectors/json_schema_validation';
import {
  sync_directory_schema,
  sync_file_fetch_schema,
} from '@connectors/sync_definition/sync_extension_schemas';
import type { ConnectorSyncDirectory } from '@connectors/sync_types';
import type { ConnectorApp } from '@connectors/types';
import { evaluate_value_expression } from '@connectors/value_expression';
import { format_error_message } from '@coworker/shared';

const empty_expression_scope = { item: {}, scope: {}, response: {} };

function list_directory_expressions(directory: ConnectorSyncDirectory): unknown[] {
  return [
    directory.page.items,
    directory.page.next_cursor,
    directory.identity,
    directory.display_name,
    directory.email,
    directory.person_kind?.bot,
    directory.person_kind?.guest,
  ].filter((expression) => expression !== undefined);
}

export function check_sync_directory(app: ConnectorApp, source_path: string) {
  const directory = app.sync?.directory;
  if (!directory) return;
  const where = `${source_path}: sync directory`;
  const violation = find_json_schema_violation(sync_directory_schema, directory, 'directory');
  if (violation) throw new Error(`${where} is invalid: ${violation}`);
  for (const expression of list_directory_expressions(directory)) {
    try {
      evaluate_value_expression(expression, empty_expression_scope);
    } catch (error) {
      throw new Error(
        `${where} holds a malformed value expression: ${format_error_message(error)}`,
      );
    }
  }
}

export function check_sync_file_fetch(app: ConnectorApp, source_path: string) {
  const file_fetch = app.sync?.file_fetch;
  if (!file_fetch) return;
  const violation = find_json_schema_violation(sync_file_fetch_schema, file_fetch, 'file_fetch');
  if (violation) throw new Error(`${source_path}: sync file_fetch is invalid: ${violation}`);
}
