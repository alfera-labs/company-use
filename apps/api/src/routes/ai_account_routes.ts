import type { ApiEnv } from '@api/lib/context';
import { install_model_provider_account_routes } from '@api/routes/install_model_provider_accounts';
import { model_provider_account_routes } from '@api/routes/model_provider_accounts';
import { Hono } from 'hono';

export const ai_account_routes = new Hono<ApiEnv>()
  .route('/', model_provider_account_routes)
  .route('/', install_model_provider_account_routes);
