import { read_public_sentry_config } from '@coworker/config/public_env';
import * as Sentry from '@sentry/tanstackstart-react';
import { StartClient } from '@tanstack/react-start/client';
import { StrictMode, startTransition } from 'react';
import { hydrateRoot } from 'react-dom/client';
import { ApiError } from '@/lib/api/client';
import { offer_a_clipboard_on_plain_http } from '@/lib/copy_text';
import { is_product_demo_path } from '@/lib/product_demo_path';
import { start_product_tracking } from '@/lib/product_tracking';
import { scrub_sign_in_links_in_report } from '@/lib/sign_in_link_scrub';
import { reload_when_the_team_session_ended } from '@/lib/team_session_ended';

const sentry_config = read_public_sentry_config();
const is_product_demo = is_product_demo_path(window.location.pathname);

// `release` is missing on purpose. The build plugin writes the release id into the bundle as
// `window.SENTRY_RELEASE.id` (bundler-plugins/build/esm/core/utils.js), and the browser SDK
// reads it as the default release (browser/build/npm/esm/*/client.js). Its id comes from the one
// rule in vite.config.ts. The router tracing integration is added in router.tsx, which is the
// only place the live router instance exists.
if (sentry_config && process.env.NODE_ENV !== 'development') {
  Sentry.init({
    dsn: sentry_config.dsn,
    environment: sentry_config.environment,
    tracesSampleRate: sentry_config.traces_sample_rate ?? 0.1,
    enableLogs: true,
    integrations: [Sentry.consoleLoggingIntegration({ levels: ['error'] })],
    sendDefaultPii: false,
    beforeSend: (event, hint) => {
      if (hint.originalException instanceof ApiError && hint.originalException.status === 402) {
        return null;
      }
      return scrub_sign_in_links_in_report(remove_secret_headers_from_sentry_event(event));
    },
    beforeSendTransaction: scrub_sign_in_links_in_report,
  });
}

offer_a_clipboard_on_plain_http();
reload_when_the_team_session_ended();

// Tracking must start before hydration: TanStack's history wraps pushState after the tracker
// wraps it, so a later start would miss client-side navigation pageviews.
if (!is_product_demo) start_product_tracking();

startTransition(() => {
  hydrateRoot(
    document,
    <StrictMode>
      <StartClient />
    </StrictMode>,
  );
});

function remove_secret_headers_from_sentry_event<T extends SentryEventWithRequestHeaders>(
  event: T,
) {
  remove_secret_headers(event.request?.headers);
  return event;
}

type SentryEventWithRequestHeaders = {
  request?: {
    headers?: Record<string, unknown>;
  };
};

function remove_secret_headers(headers: Record<string, unknown> | undefined) {
  if (!headers) return;

  for (const key of Object.keys(headers)) {
    const normalized_key = key.toLowerCase();
    if (
      normalized_key === 'authorization' ||
      normalized_key === 'cookie' ||
      normalized_key === 'x-coworker-api-secret'
    ) {
      delete headers[key];
    }
  }
}
