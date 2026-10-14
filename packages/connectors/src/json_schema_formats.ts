import { file_fetch_host_entry_is_allowed } from '@connectors/sync/file_host_policy';

export const file_fetch_host_format = 'connector_file_fetch_host';

export const json_schema_formats: Record<string, (value: string) => boolean> = {
  [file_fetch_host_format]: file_fetch_host_entry_is_allowed,
};
