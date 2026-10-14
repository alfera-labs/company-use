import type { ApiEnv } from '@api/lib/context';
import { ok } from '@api/lib/response';
import { list_redacted_connections } from '@coworker/core/db/queries/connection_management';
import { template_sort_orders } from '@coworker/core/db/queries/template_catalog';
import {
  build_template_catalog,
  build_template_listing_by_slug,
  type CatalogQuery,
  read_catalog_viewer,
  render_template_listing_markdown,
} from '@coworker/core/templates';
import { Hono } from 'hono';
import { z } from 'zod';

const catalog_query_schema = z.object({
  q: z.string().max(200).optional(),
  facet_kind: z.enum(['category', 'role', 'app', 'topic']).optional(),
  facet_key: z.string().max(80).optional(),
  kind: z.enum(['task', 'skill']).optional(),
  sort: z.enum(template_sort_orders).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

function read_catalog_query(url: string): CatalogQuery {
  const parsed = catalog_query_schema.safeParse(
    Object.fromEntries(new URL(url).searchParams.entries()),
  );
  const query = parsed.success ? parsed.data : {};
  return {
    facet_kind: query.facet_kind ?? null,
    facet_key: query.facet_key ?? null,
    query: query.q,
    template_kind: query.kind,
    sort_order: query.sort,
    limit: query.limit,
    offset: query.offset,
  };
}

export const public_templates_routes = new Hono<ApiEnv>()
  .get('/public/templates', async (c) => {
    return c.json(ok(await build_template_catalog(c.get('db'), read_catalog_query(c.req.url))));
  })
  .get('/public/templates/:slug', async (c) => {
    return c.json(
      ok(await build_template_listing_by_slug(c.get('db'), { template_slug: c.req.param('slug') })),
    );
  })
  .get('/public/templates/:slug/markdown', async (c) => {
    const listing = await build_template_listing_by_slug(c.get('db'), {
      template_slug: c.req.param('slug'),
    });
    return c.text(render_template_listing_markdown(listing), 200, {
      'Content-Type': 'text/markdown; charset=utf-8',
    });
  });

export const templates_routes = new Hono<ApiEnv>()
  .get('/v1/templates', async (c) => {
    return c.json(
      ok(
        await build_template_catalog(c.get('db'), {
          ...read_catalog_query(c.req.url),
          viewer: await workspace_viewer(c.get('db'), c.get('workspace_id')),
        }),
      ),
    );
  })
  .get('/v1/templates/:slug', async (c) => {
    return c.json(
      ok(
        await build_template_listing_by_slug(c.get('db'), {
          template_slug: c.req.param('slug'),
          viewer: await workspace_viewer(c.get('db'), c.get('workspace_id')),
        }),
      ),
    );
  });

async function workspace_viewer(
  db: Parameters<typeof read_catalog_viewer>[0],
  workspace_id: string,
) {
  const connections = await list_redacted_connections(db, workspace_id);
  return read_catalog_viewer(db, {
    workspace_id,
    connected_app_keys: connections
      .filter((connection) => connection.connection_status === 'active')
      .map((connection) => connection.app?.app_name)
      .filter((app_name): app_name is string => typeof app_name === 'string'),
  });
}
