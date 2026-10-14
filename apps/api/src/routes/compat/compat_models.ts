import type { ApiEnv } from '@api/lib/context';
import { unix_seconds } from '@api/routes/compat/compat_wire';
import type { Context } from 'hono';

export const compat_model_id = 'alfera';

// GET /models answers both SDKs at once: the fields carry OpenAI's list envelope (`object`,
// `data[].object`, `owned_by`) and Anthropic's (`data[].type`, `display_name`, `first_id`/`last_id`)
// side by side, so `client.models.list()` parses on either.
export function openai_models(c: Context<ApiEnv>): Response {
  const created = unix_seconds();
  return c.json({
    object: 'list',
    data: [
      {
        id: compat_model_id,
        object: 'model',
        type: 'model',
        created,
        created_at: new Date(created * 1000).toISOString(),
        owned_by: 'alfera',
        display_name: 'Alfera',
      },
    ],
    has_more: false,
    first_id: compat_model_id,
    last_id: compat_model_id,
  });
}
