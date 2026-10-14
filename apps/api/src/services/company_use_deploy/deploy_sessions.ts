import { createHash, timingSafeEqual } from 'node:crypto';
import type {
  new_deploy_session_schema,
  ProgressReport,
} from '@api/services/company_use_deploy/deploy_schemas';
import type { Database } from '@coworker/core';
import {
  append_deploy_progress_line,
  count_live_deploy_sessions,
  find_live_deploy_session,
  insert_deploy_session,
} from '@coworker/core/db/queries/company_use_deploy_sessions';
import { AppError } from '@coworker/shared';
import type { z } from 'zod';

const minutes_a_session_waits_for_its_first_report = 60;
const days_a_session_is_kept_after_its_first_report = 7;
export const most_progress_lines = 200;
export const most_live_deploy_sessions = 10_000;

const sha256_hex = (text: string) => createHash('sha256').update(text).digest('hex');

function same_text(given: string, expected: string) {
  const given_bytes = Buffer.from(given);
  const expected_bytes = Buffer.from(expected);
  return (
    given_bytes.length === expected_bytes.length && timingSafeEqual(given_bytes, expected_bytes)
  );
}

export async function start_deploy_session(
  db: Database,
  input: z.infer<typeof new_deploy_session_schema>,
) {
  if ((await count_live_deploy_sessions(db)) >= most_live_deploy_sessions) {
    throw new AppError('too_many_deploys', 'Too many servers are in setup. Try again later.', 503);
  }
  const expires_time = new Date(Date.now() + minutes_a_session_waits_for_its_first_report * 60_000);
  const stored = await insert_deploy_session(db, { ...input, expires_time });
  if (!stored || !same_text(input.report_token_hash, stored.report_token_hash)) {
    throw new AppError('install_exists', 'This install id is taken.', 409);
  }
  return { install_id: input.install_id };
}

export async function require_matching_report_token(
  db: Database,
  input: { report_token: string; install_id: string },
) {
  const session = await find_live_deploy_session(db, input.install_id);
  if (!session || !same_text(sha256_hex(input.report_token), session.report_token_hash)) {
    throw new AppError('wrong_token', 'The report token does not match this install.', 401);
  }
}

export async function record_progress_report(db: Database, report: ProgressReport) {
  const is_recorded = await append_deploy_progress_line(db, {
    install_id: report.install_id,
    line: report,
    most_lines: most_progress_lines,
    expires_time_after_first_line: new Date(
      Date.now() + days_a_session_is_kept_after_its_first_report * 86_400_000,
    ),
  });
  if (!is_recorded)
    throw new AppError('unknown_install', 'No server is set up under this id.', 404);
  return { recorded: true };
}

export async function read_deploy_status(db: Database, install_id: string) {
  const session = await find_live_deploy_session(db, install_id);
  if (!session) throw new AppError('unknown_install', 'No server is set up under this id.', 404);
  return { reports: session.progress_lines, site_time: Date.now() };
}
