import * as Sentry from '@sentry/tanstackstart-react';
import { createStartHandler, defaultStreamHandler } from '@tanstack/react-start/server';
import { decrypt_vercel_runtime_env } from '@/instrumentation_node';
import { relay_client_disconnect } from '@/lib/client_disconnect';
import { drop_control_flow_throws_and_scrub_secrets } from '@/lib/sentry_control_flow';
import { scrub_sign_in_links_in_report } from '@/lib/sign_in_link_scrub';

decrypt_vercel_runtime_env();
await init_server_sentry();

async function init_server_sentry() {
  if (process.env.NODE_ENV === 'development') return;
  const { read_sentry_config } = await import('@coworker/config');
  const sentry_config = read_sentry_config();
  if (!sentry_config) return;

  // Node auto-instrumentation of http and undici needs the `--import
  // @sentry/tanstackstart-react/import` preload, which Vercel functions do not run.
  // Incoming requests are still traced through the wrapped fetch below, but spans for
  // outgoing HTTP calls are best effort.
  Sentry.init({
    dsn: sentry_config.dsn,
    environment: sentry_config.environment,
    release: sentry_config.release,
    tracesSampleRate: sentry_config.traces_sample_rate ?? 0.1,
    enableLogs: true,
    integrations: [Sentry.consoleLoggingIntegration({ levels: ['error'] })],
    sendDefaultPii: false,
    beforeSend: drop_control_flow_throws_and_scrub_secrets,
    beforeSendTransaction: scrub_sign_in_links_in_report,
  });
}

const start_fetch = createStartHandler(defaultStreamHandler);

// A dropped request must answer 499, not log an unhandled 500. See client_disconnect.ts.
// Sentry's ServerEntry types the second argument as `unknown`, so the forward casts it back to
// the handler's own option type.
const fetch = (request: Request, options?: unknown) => {
  relay_client_disconnect(request);
  return start_fetch(request, options as Parameters<typeof start_fetch>[1]);
};

export default Sentry.wrapFetchWithSentry({ fetch });
