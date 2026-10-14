import type { ApiEnv } from '@api/lib/context';
import { ok } from '@api/lib/response';
import { validate_query } from '@api/lib/validate';
import { read_what_this_install_has_set_up } from '@api/services/onboarding_snapshot';
import { connector_catalog_source, is_connector_app_held } from '@coworker/connectors';
import {
  list_apps,
  list_apps_by_normalized_keys,
  list_nodes,
  search_apps,
} from '@coworker/core/db/queries/catalog';
import {
  type AppToConnect,
  find_why_app_cannot_connect_here,
} from '@runtime-platform/connections/app_connection_availability';
import { Hono } from 'hono';
import { z } from 'zod';

const nodes_query_schema = z.object({
  keys: z
    .string()
    .optional()
    .transform((value) =>
      value
        ? value
            .split(',')
            .map((key) => key.trim())
            .filter(Boolean)
        : undefined,
    ),
  limit: z.coerce.number().int().min(1).max(500).optional(),
});

const apps_by_keys_query_schema = z.object({
  keys: z
    .string()
    .transform((value) =>
      value
        .split(',')
        .map((key) => key.trim())
        .filter(Boolean),
    )
    .pipe(z.array(z.string()).min(1).max(50)),
});

const app_search_query_schema = z.object({
  q: z.string().optional(),
  limit: z.coerce.number().int().positive().optional(),
  offset: z.coerce.number().int().nonnegative().optional(),
  cursor: z.string().optional(),
});

export const public_catalog_routes = new Hono<ApiEnv>().get(
  '/public/apps/search',
  validate_query(app_search_query_schema),
  async (c) => {
    const query = c.req.valid('query');
    return c.json(
      ok(
        await search_apps(c.get('db'), {
          ...(query.q ? { query: query.q } : {}),
          limit: query.limit,
          offset: query.offset,
          cursor: query.cursor,
        }),
      ),
    );
  },
);

function keep_apps_this_install_can_connect<App extends AppToConnect & { app_name: string }>(
  apps: App[],
) {
  if (read_what_this_install_has_set_up().app_provider_configured) return apps;
  return apps.filter(
    (app) =>
      !(app.metadata.source === connector_catalog_source && is_connector_app_held(app.app_name)) &&
      find_why_app_cannot_connect_here(app) === null,
  );
}

export const catalog_routes = new Hono<ApiEnv>()
  .get('/v1/apps/by-keys', validate_query(apps_by_keys_query_schema), async (c) => {
    const { keys } = c.req.valid('query');
    const apps = await list_apps_by_normalized_keys(c.get('db'), {
      keys,
      workspace_id: c.get('workspace_id'),
    });
    return c.json(ok(keep_apps_this_install_can_connect(apps)));
  })
  .get('/v1/apps/search', validate_query(app_search_query_schema), async (c) => {
    const query = c.req.valid('query');
    const page = await search_apps(c.get('db'), {
      workspace_id: c.get('workspace_id'),
      ...(query.q ? { query: query.q } : {}),
      limit: query.limit,
      offset: query.offset,
      cursor: query.cursor,
    });
    const items = keep_apps_this_install_can_connect(page.items);
    return c.json(ok({ ...page, items, total: page.total - (page.items.length - items.length) }));
  })
  .get('/v1/apps', async (c) => {
    return c.json(ok(await list_apps(c.get('db'), c.get('workspace_id'))));
  })
  .get('/v1/nodes', validate_query(nodes_query_schema), async (c) => {
    const { keys, limit } = c.req.valid('query');
    return c.json(
      ok(
        await list_nodes(c.get('db'), {
          workspace_id: c.get('workspace_id'),
          ...(keys ? { keys } : {}),
          ...(limit !== undefined ? { limit } : {}),
        }),
      ),
    );
  });
