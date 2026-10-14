const connectable_auth_types = new Set(['oauth2', 'api_key']);

export function app_needs_a_connection(auth_type: string | null | undefined) {
  return connectable_auth_types.has(auth_type ?? '');
}
