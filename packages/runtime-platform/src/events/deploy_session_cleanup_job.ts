import { read_company_use_deploy_env } from '@coworker/config/company_use_deploy_env';
import type { Database } from '@coworker/core';
import { delete_expired_deploy_sessions } from '@coworker/core/db/queries/company_use_deploy_sessions';

export async function delete_expired_deploy_sessions_when_the_page_is_on(db: Database) {
  if (read_company_use_deploy_env().page_origins.length === 0) return { deleted_count: 0 };
  return { deleted_count: await delete_expired_deploy_sessions(db) };
}
