import type { ApiEnv } from '@api/lib/context';
import {
  has_proxy_identity,
  read_proxy_identity,
  verify_proxy_secret,
} from '@api/lib/proxy_identity';
import {
  attribution_cookie_name,
  parse_attribution_cookie,
} from '@api/services/ad_conversions/attribution';
import { persist_request_meta_browser_context } from '@api/services/ad_conversions/capture_meta_browser_context';
import {
  parse_referral_cookie,
  persist_referral_attribution,
  referral_cookie_name,
} from '@api/services/referral_capture';
import { env } from '@coworker/config';
import {
  has_test_runner_marks,
  is_team_mode_switched_on,
} from '@coworker/config/local_mode_switch';
import { persist_ad_attribution } from '@coworker/core/db/queries/ad_attribution';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import { find_team_actor } from '@coworker/core/db/queries/team_workspace';
import { find_or_provision_workspace_for_identity } from '@coworker/core/db/queries/workspace_provisioning';
import { AppError, create_logger } from '@coworker/shared';
import type { Context, MiddlewareHandler } from 'hono';
import { getCookie } from 'hono/cookie';

const log = create_logger('ad_attribution');

export function attach_workspace(): MiddlewareHandler<ApiEnv> {
  return async (c, next) => {
    const actor = await resolve_request_actor(c);

    c.set('workspace_id', actor.workspace_id);
    c.set('user_id', actor.user_id);
    c.set('agent_id', actor.agent_id);

    await persist_request_ad_attribution(c, actor);
    await persist_request_referral_attribution(c, actor);
    await persist_request_meta_browser_context(c, actor);

    await next();
  };
}

async function resolve_request_actor(c: Context<ApiEnv>) {
  if (can_use_test_workspace() && !has_proxy_identity(c)) {
    return bootstrap_default_workspace(c.get('db'));
  }

  verify_proxy_secret(c);
  const identity = read_proxy_identity(c);
  if (!identity) {
    throw new AppError('unauthorized', 'Missing authenticated user context', 401);
  }

  if (is_team_mode_switched_on()) return require_team_actor(c, identity.provider_user_id);

  if (!identity.organization_id) {
    throw new AppError('unauthorized', 'Missing organization context', 401);
  }

  return find_or_provision_workspace_for_identity(c.get('db'), identity);
}

async function require_team_actor(c: Context<ApiEnv>, user_id: string) {
  const actor = await find_team_actor(c.get('db'), { user_id });
  if (!actor) throw new AppError('unauthorized', 'This person is not on the team', 401);
  return actor;
}

async function persist_request_ad_attribution(
  c: Context<ApiEnv>,
  actor: { user_id: string; workspace_id: string },
) {
  const attribution = parse_attribution_cookie(getCookie(c, attribution_cookie_name));
  if (!attribution) return;

  try {
    await persist_ad_attribution(c.get('db'), {
      user_id: actor.user_id,
      workspace_id: actor.workspace_id,
      actor_id: actor.user_id,
      attribution,
    });
  } catch (error) {
    log.error('failed to persist request attribution', error);
  }
}

const settled_referral_workspaces = new Set<string>();

async function persist_request_referral_attribution(
  c: Context<ApiEnv>,
  actor: { user_id: string; workspace_id: string },
) {
  if (settled_referral_workspaces.has(actor.workspace_id)) return;
  const referrer_workspace_id = parse_referral_cookie(getCookie(c, referral_cookie_name));
  if (!referrer_workspace_id) return;

  settled_referral_workspaces.add(actor.workspace_id);
  await persist_referral_attribution(c.get('db'), {
    referrer_workspace_id,
    invitee_workspace_id: actor.workspace_id,
    actor_id: actor.user_id,
  });
}

function can_use_test_workspace() {
  return serves_the_test_workspace(env.NODE_ENV);
}

/**
 * The test workspace answers a request that names nobody and holds no secret. Only the test
 * runner may get it: the runner's own marks and NODE_ENV=test, both. A container that has
 * VITEST=true in its environment by mistake serves nobody without the secret.
 */
export function serves_the_test_workspace(node_env: string): boolean {
  return node_env === 'test' && has_test_runner_marks();
}
