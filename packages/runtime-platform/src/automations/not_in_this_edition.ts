import type { EventJobHandlerResult } from '@coworker/jobs';
import { AppError } from '@coworker/shared';

export const not_in_this_edition_code = 'not_in_this_edition';

export function not_in_this_edition_error() {
  return new AppError(not_in_this_edition_code, 'This feature runs on Alfera Cloud.', 404);
}

export async function finish_job_of_a_removed_feature(): Promise<EventJobHandlerResult> {
  return { job_status: 'done', result_data: { ran: false, code: not_in_this_edition_code } };
}
