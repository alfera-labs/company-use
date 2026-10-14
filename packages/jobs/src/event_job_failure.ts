import { AppError } from '@coworker/shared';

type EventJobFailureTags = Record<string, string>;

class EventJobFailure extends Error {
  override readonly name = 'EventJobFailure';

  constructor(
    public readonly code: string,
    message: string,
    public readonly safe_tags: EventJobFailureTags = {},
  ) {
    super(message);
  }
}

export type EventJobFailureDetails = {
  code: string;
  message: string;
  safe_tags: EventJobFailureTags;
};

export function read_event_job_failure(error: unknown): EventJobFailureDetails | null {
  if (error instanceof EventJobFailure) {
    return { code: error.code, message: error.message, safe_tags: error.safe_tags };
  }
  if (error instanceof AppError) return { code: error.code, message: error.message, safe_tags: {} };
  return null;
}
