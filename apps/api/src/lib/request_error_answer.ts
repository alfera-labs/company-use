import type { ApiEnv } from '@api/lib/context';
import { error_body } from '@api/lib/response';
import { capture_api_exception } from '@api/lib/sentry';
import { AppError, create_logger, ValidationError } from '@coworker/shared';
import type { ErrorHandler } from 'hono';
import { HTTPException } from 'hono/http-exception';

const log = create_logger('api');

/** Answers a request that threw: an AppError keeps its status, anything else is a logged 500. */
export const answer_request_error: ErrorHandler<ApiEnv> = (error, c) => {
  const request_error =
    error instanceof HTTPException &&
    error.status === 400 &&
    error.message === 'Malformed JSON in request body'
      ? new ValidationError('Request body must be valid JSON')
      : error;

  if (request_error instanceof AppError) {
    log.info('request rejected', {
      request_id: c.get('requestId'),
      method: c.req.method,
      path: c.req.path,
      status_code: request_error.status,
      error_code: request_error.code,
      error_message: request_error.message,
    });
    return c.json(
      error_body(request_error.code, request_error.message, request_error.details),
      request_error.status,
    );
  }

  log.error('unhandled request error', {
    request_id: c.get('requestId'),
    method: c.req.method,
    path: c.req.path,
    status_code: 500,
    error: request_error,
  });
  capture_api_exception(request_error, c);
  return c.json(error_body('internal_error', 'An unexpected error occurred'), 500);
};
