import type { ApiEnv } from '@api/lib/context';
import { auth_routes } from '@api/routes/auth';
import { install_setup_routes } from '@api/routes/install_setup';
import { own_recovery_code_routes } from '@api/routes/own_recovery_code';
import { team_routes } from '@api/routes/team';
import { team_password_sign_in_routes } from '@api/routes/team_password_sign_in';
import { team_sign_in_routes } from '@api/routes/team_sign_in';
import { Hono } from 'hono';

/**
 * Every route that decides who a person is and who is on the team. Team mode's own routes come
 * first: they hold the guards that close the sign-in provider's routes while team mode is on,
 * and a guard only covers a route mounted after it.
 */
export const sign_in_routes = new Hono<ApiEnv>()
  .route('/', install_setup_routes)
  .route('/', team_sign_in_routes)
  .route('/', team_password_sign_in_routes)
  .route('/', own_recovery_code_routes)
  .route('/', team_routes)
  .route('/', auth_routes);
