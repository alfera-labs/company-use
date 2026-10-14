import type { ApiEnv } from '@api/lib/context';
import { ok } from '@api/lib/response';
import { validate_json, validate_query } from '@api/lib/validate';
import {
  allow_only_the_deploy_page,
  limit_deploy_requests,
  read_bearer_token,
  require_under_rate_limit,
} from '@api/services/company_use_deploy/deploy_request_guards';
import {
  deploy_status_query_schema,
  digitalocean_code_schema,
  digitalocean_token_schema,
  new_deploy_session_schema,
  progress_report_schema,
  report_token_schema,
} from '@api/services/company_use_deploy/deploy_schemas';
import {
  read_deploy_status,
  record_progress_report,
  require_matching_report_token,
  start_deploy_session,
} from '@api/services/company_use_deploy/deploy_sessions';
import {
  exchange_digitalocean_code,
  revoke_digitalocean_token,
} from '@api/services/company_use_deploy/digitalocean_oauth';
import { AppError } from '@coworker/shared';
import { Hono, type MiddlewareHandler } from 'hono';
import { bodyLimit } from 'hono/body-limit';

const deploy_path = '/v1/company-use/deploy';
const small_body = bodyLimit({ maxSize: 4096 });

function require_report_token(): MiddlewareHandler<ApiEnv> {
  return async (c, next) => {
    if (!report_token_schema.safeParse(read_bearer_token(c)).success) {
      throw new AppError('missing_token', 'The report needs its bearer token.', 401);
    }
    await next();
  };
}

export const company_use_deploy_routes = new Hono<ApiEnv>()
  .use(`${deploy_path}/*`, allow_only_the_deploy_page())
  .post(
    `${deploy_path}/start`,
    limit_deploy_requests('start'),
    small_body,
    validate_json(new_deploy_session_schema),
    async (c) => c.json(ok(await start_deploy_session(c.get('db'), c.req.valid('json'))), 201),
  )
  .post(
    `${deploy_path}/report`,
    limit_deploy_requests('report'),
    require_report_token(),
    small_body,
    validate_json(progress_report_schema),
    async (c) => {
      const report = c.req.valid('json');
      await require_matching_report_token(c.get('db'), {
        report_token: read_bearer_token(c),
        install_id: report.install_id,
      });
      require_under_rate_limit(c, 'report_per_install', report.install_id);
      return c.json(ok(await record_progress_report(c.get('db'), report)), 201);
    },
  )
  .get(
    `${deploy_path}/status`,
    limit_deploy_requests('status'),
    validate_query(deploy_status_query_schema),
    async (c) => {
      c.header('Cache-Control', 'no-store');
      return c.json(ok(await read_deploy_status(c.get('db'), c.req.valid('query').install_id)));
    },
  )
  .post(
    `${deploy_path}/digitalocean/token`,
    limit_deploy_requests('digitalocean_token'),
    small_body,
    validate_json(digitalocean_code_schema),
    async (c) => {
      c.header('Cache-Control', 'no-store');
      return c.json(ok(await exchange_digitalocean_code(c.req.valid('json'))));
    },
  )
  .post(
    `${deploy_path}/digitalocean/revoke`,
    limit_deploy_requests('digitalocean_revoke'),
    small_body,
    validate_json(digitalocean_token_schema),
    async (c) => c.json(ok(await revoke_digitalocean_token(c.req.valid('json').token))),
  );
