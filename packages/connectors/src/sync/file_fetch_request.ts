import type { ConnectorSyncFile, ConnectorSyncObject } from '@connectors/sync_types';
import type { ValueScope } from '@connectors/value_expression';
import { evaluate_value_expression } from '@connectors/value_expression';

export type FileFetchInputExpressions = NonNullable<ConnectorSyncObject['file_fetch_input']>;

export type FileFetchRequest = {
  file: ConnectorSyncFile;
  input: Record<string, unknown>;
};

function build_file_fetch_input(
  file_fetch_input: FileFetchInputExpressions,
  file: ConnectorSyncFile,
): Record<string, unknown> {
  const scope: ValueScope = { file, item: file };
  return Object.fromEntries(
    Object.entries(file_fetch_input).map(([key, expression]) => [
      key,
      evaluate_value_expression(expression, scope),
    ]),
  );
}

export function build_file_fetch_requests(
  file_fetch_input: FileFetchInputExpressions,
  files: readonly ConnectorSyncFile[],
): readonly FileFetchRequest[] {
  return files.map((file) => ({
    file,
    input: build_file_fetch_input(file_fetch_input, file),
  }));
}
