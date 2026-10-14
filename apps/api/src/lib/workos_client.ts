import { env } from '@coworker/config';
import { WorkOS } from '@workos-inc/node';

export function resolve_workos_client(): WorkOS | null {
  const api_key = env.WORKOS_API_KEY;
  if (!api_key) return null;
  return new WorkOS(api_key);
}
