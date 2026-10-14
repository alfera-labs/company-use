import definition from '@connectors/apps/google_drive/export_files/v1/node.json' with {
  type: 'json',
};
import type {
  ConnectorError,
  ConnectorNodeContext,
  ConnectorResponseFormat,
} from '@connectors/types';
import type { JsonSchema } from '@coworker/shared';

export type ExportDriveFilesInput = {
  files: Array<{ file_id: string; mime_type: string }>;
};

const files_export = definition.requests.files_export;
const response_format = files_export.response_format as ConnectorResponseFormat;
const response_schema = files_export.response_schema as JsonSchema;

const missing_fan_out_result: ConnectorError = {
  code: 'node_failed',
  message: 'The fan-out returned no result for this file.',
  retryable: false,
};

export async function execute(input: ExportDriveFilesInput, context: ConnectorNodeContext) {
  const results = await context.fan_out({
    items: input.files,
    limits: context.app.rate_limits,
    call_one: (file) =>
      context.send_request<string>({
        method: 'GET',
        path: `files/${encodeURIComponent(file.file_id)}/export`,
        query: { mimeType: file.mime_type },
        response_format,
        response_schema,
      }),
  });

  return {
    files: input.files.map((file, index) => {
      const result = results[index];
      if (result?.ok) {
        return {
          ok: true as const,
          file_id: file.file_id,
          mime_type: file.mime_type,
          text: result.data,
        };
      }
      return {
        ok: false as const,
        file_id: file.file_id,
        error: result?.error ?? missing_fan_out_result,
      };
    }),
  };
}
