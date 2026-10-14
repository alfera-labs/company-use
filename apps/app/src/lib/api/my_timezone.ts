import { api_client, no_store_request, read_api_data } from '@/lib/api/client';

const my_timezone = api_client.v1.me.timezone;

export async function get_my_timezone() {
  return read_api_data<{ timezone: string | null }>(
    await my_timezone.$get(undefined, no_store_request),
    { method: 'GET', path: '/v1/me/timezone' },
  );
}

export async function set_my_timezone(timezone: string) {
  return read_api_data<{ timezone: string }>(await my_timezone.$put({ json: { timezone } }), {
    method: 'PUT',
    path: '/v1/me/timezone',
  });
}
