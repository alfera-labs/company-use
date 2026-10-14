import type { ApiEnv } from '@api/lib/context';
import { project_channel_routes } from '@api/routes/projects/project_channel_routes';
import { project_core_routes } from '@api/routes/projects/project_core_routes';
import { project_file_routes } from '@api/routes/projects/project_file_routes';
import { project_member_routes } from '@api/routes/projects/project_member_routes';
import { Hono } from 'hono';

export const project_routes = new Hono<ApiEnv>()
  .route('/', project_core_routes)
  .route('/', project_member_routes)
  .route('/', project_file_routes)
  .route('/', project_channel_routes);
