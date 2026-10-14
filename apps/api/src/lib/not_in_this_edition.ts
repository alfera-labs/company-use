import { AppError } from '@coworker/shared';

export const runs_on_alfera_cloud_sentence = 'This feature runs on Alfera Cloud.';

export function not_in_this_edition_error() {
  return new AppError('not_in_this_edition', runs_on_alfera_cloud_sentence, 404);
}
