import type { ApiEnv } from '@api/lib/context';
import { channel_config_routes as channel_settings_routes } from '@api/routes/channels/configs';
import { channel_event_routes as channel_webhook_routes } from '@api/routes/channels/events';
import { connection_short_link_routes } from '@api/routes/connection_short_link_routes';
import { Hono } from 'hono';

export const channel_event_routes = new Hono<ApiEnv>()
  .route('/', channel_webhook_routes)
  .route('/', connection_short_link_routes);

export const channel_config_routes = new Hono<ApiEnv>().route('/', channel_settings_routes);
