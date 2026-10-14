import { is_app_port_open_to_other_machines } from '@coworker/config/local_mode_switch';

/**
 * The address of the visitor, for the API's rate limits. Behind a proxy (the hosting platform,
 * or Caddy on a self-hosted install) it is the first X-Forwarded-For entry, which the proxy
 * writes. When the dashboard port is open to other machines with no proxy in front, a visitor
 * writes that header, so the address of the connection is used.
 */
export function read_client_address(request: Request): string | undefined {
  if (is_app_port_open_to_other_machines()) return connection_address_of(request);
  const forwarded_for = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return forwarded_for || request.headers.get('x-real-ip') || connection_address_of(request);
}

function connection_address_of(request: Request): string | undefined {
  return 'ip' in request && typeof request.ip === 'string' ? request.ip : undefined;
}
