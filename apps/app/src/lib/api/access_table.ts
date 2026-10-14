import { api_client, no_store_request, read_api_data } from '@/lib/api/client';
import type { ApiSuccess } from '@/lib/api/types';

export type AccessTable = ApiSuccess<typeof api_client.v1.access.table.$get>;
export type AccessTableCell = AccessTable['connections'][number]['cells'][number];

export async function get_access_table(): Promise<AccessTable> {
  return read_api_data<AccessTable>(
    await api_client.v1.access.table.$get(undefined, no_store_request),
    { method: 'GET', path: '/v1/access/table' },
  );
}
