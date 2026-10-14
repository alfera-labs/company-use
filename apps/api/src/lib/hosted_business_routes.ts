import type { ApiEnv } from '@api/lib/context';
import { not_in_this_edition_error } from '@api/lib/not_in_this_edition';
import { Hono } from 'hono';

export function create_hosted_business_routes(paths: readonly string[]) {
  const routes = new Hono<ApiEnv>();
  for (const path of paths) {
    routes.all(path, () => {
      throw not_in_this_edition_error();
    });
  }
  return routes;
}
