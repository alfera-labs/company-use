import { public_env } from '@coworker/config/public_env';

export function build_connection_start_url(input: {
  connection_id: string;
  setup_token: string | undefined;
}): string | null {
  if (!input.setup_token) return null;

  const url = new URL('/connect/start', public_env.NEXT_PUBLIC_APP_URL);
  url.searchParams.set('connection_id', input.connection_id);
  url.searchParams.set('setup_token', input.setup_token);
  return url.toString();
}
