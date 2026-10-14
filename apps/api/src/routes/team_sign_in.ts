import type { ApiEnv } from '@api/lib/context';
import { verify_machine_caller } from '@api/lib/proxy_identity';
import { ok } from '@api/lib/response';
import { only_in_team_mode } from '@api/lib/team_mode_routes';
import { validate_json, validate_query } from '@api/lib/validate';
import {
  authenticate_team_session,
  end_team_session,
  find_workspace_session_was_removed_from,
  make_owner_sign_in_link,
  preview_team_sign_in_link,
  redeem_team_sign_in_link,
} from '@api/services/team/team_sign_in';
import { AppError } from '@coworker/shared';
import { Hono, type MiddlewareHandler } from 'hono';
import { z } from 'zod';

const base64url_of_32_bytes = /^[A-Za-z0-9_-]{43}$/u;
const team_secret_schema = z.string().regex(base64url_of_32_bytes);
const link_token_schema = z.object({ token: team_secret_schema }).strict();
const session_token_schema = z.object({ session_token: team_secret_schema }).strict();
const owner_link_query_schema = z.strictObject({
  minutes: z.coerce.number().int().min(1).max(60).default(60),
});

const machine_caller: MiddlewareHandler<ApiEnv> = async (c, next) => {
  verify_machine_caller(c);
  await next();
};

function one_answer_for_every_bad_link() {
  return new AppError('team_link_not_valid', 'This link is not valid any more', 404);
}

/**
 * How a browser with no session gets one. Only the app server and the helper on this machine
 * call these, with the proxy secret and no person. A link that never existed, was used, ran
 * out, or whose person was removed gets one and the same answer. A session is different: the
 * holder of a session that was valid until its person was removed is told so, by name of the
 * workspace, so the app can say that and not ask for a sign-in link.
 */
export const team_sign_in_routes = new Hono<ApiEnv>()
  .use('/v1/team-sign-in/*', only_in_team_mode, machine_caller)
  .post('/v1/team-sign-in/link/preview', validate_json(link_token_schema), async (c) => {
    const preview = await preview_team_sign_in_link(c.get('db'), c.req.valid('json').token);
    if (!preview) throw one_answer_for_every_bad_link();
    return c.json(ok(preview));
  })
  .post('/v1/team-sign-in/link/redeem', validate_json(link_token_schema), async (c) => {
    const session = await redeem_team_sign_in_link(c.get('db'), c.req.valid('json').token);
    if (!session) throw one_answer_for_every_bad_link();
    return c.json(ok(session), 201);
  })
  .post('/v1/team-sign-in/session', validate_json(session_token_schema), async (c) => {
    const { session_token } = c.req.valid('json');
    const person = await authenticate_team_session(c.get('db'), session_token);
    if (person) return c.json(ok(person));
    const workspace_name = await find_workspace_session_was_removed_from(
      c.get('db'),
      session_token,
    );
    if (workspace_name === null) {
      throw new AppError('unauthorized', 'This session is not valid', 401);
    }
    throw new AppError('team_member_removed', 'This person was removed from the workspace', 401, {
      workspace_name,
    });
  })
  .post('/v1/team-sign-in/session/end', validate_json(session_token_schema), async (c) => {
    await end_team_session(c.get('db'), c.req.valid('json').session_token);
    return c.json(ok({ ended: true }));
  })
  .post('/v1/team-sign-in/owner-link', validate_query(owner_link_query_schema), async (c) => {
    const { minutes } = c.req.valid('query');
    return c.json(ok(await make_owner_sign_in_link(c.get('db'), minutes * 60_000)), 201);
  });
