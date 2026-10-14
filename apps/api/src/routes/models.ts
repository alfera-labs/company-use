import type { ApiEnv } from '@api/lib/context';
import { ok } from '@api/lib/response';
import { read_workspace_model_catalog_environment } from '@api/services/models/model_catalog';
import { list_models_for_the_picker } from '@api/services/models/model_picker_catalog';
import { Hono } from 'hono';

export const model_routes = new Hono<ApiEnv>().get('/v1/models', async (c) => {
  const model_environment = await read_workspace_model_catalog_environment(
    c.get('db'),
    c.get('workspace_id'),
  );
  return c.json(ok(await list_models_for_the_picker(model_environment)));
});
