import { secure_strings_equal } from '@coworker/shared/secure_strings_equal';
import { serve } from '@hono/node-server';

export const worker_secret_header = 'x-alfera-worker-secret';

type HandleRequest = (request: Request) => Promise<Response>;

/** Answers 401 to a request without the worker secret, so rivetkit never reads it. */
export function refuse_requests_without_worker_secret(
  secret: string,
  handle: HandleRequest,
): HandleRequest {
  return async (request) => {
    const presented = request.headers.get(worker_secret_header) ?? '';
    if (!secure_strings_equal(presented, secret))
      return new Response('Unauthorized', { status: 401 });
    return handle(request);
  };
}

export function serve_rivet_over_http(input: {
  port: number | undefined;
  secret: string | undefined;
  handle: HandleRequest;
}) {
  if (!input.port || !input.secret) {
    throw new Error('A serverless worker needs PORT and WORKER_SERVERLESS_SECRET.');
  }
  const fetch = refuse_requests_without_worker_secret(input.secret, input.handle);
  return serve({ fetch, port: input.port, hostname: '0.0.0.0' });
}
