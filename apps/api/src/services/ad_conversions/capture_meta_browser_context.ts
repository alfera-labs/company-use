import type { ApiEnv } from '@api/lib/context';
import type { Context } from 'hono';

export async function persist_request_meta_browser_context(
  _c: Context<ApiEnv>,
  _actor: { user_id: string },
) {}
