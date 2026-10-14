import { env, require_rivet_connection } from '@coworker/config';
import { type Database, get_database } from '@coworker/core';
import type { FindEventJobHandler, RivetEngineAccess } from '@coworker/jobs';
import { find_event_job_handler } from '@coworker/runtime-platform';
import { create_logger } from '@coworker/shared';

export type WorkerServices = {
  db: Database;
  find_event_job_handler: FindEventJobHandler;
  log: ReturnType<typeof create_logger>;
  now: () => Date;
  rivet_region: string | undefined;
  rivet_key_scope: string;
  rivet_engine: RivetEngineAccess;
};

export function create_worker_services(): WorkerServices {
  const connection = require_rivet_connection();
  return {
    db: get_database(),
    find_event_job_handler,
    log: create_logger('worker'),
    now: () => new Date(),
    rivet_region: env.RIVET_REGION,
    rivet_key_scope: connection.pool,
    rivet_engine: connection,
  };
}
