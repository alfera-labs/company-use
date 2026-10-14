import {
  sentryGlobalFunctionMiddleware,
  sentryGlobalRequestMiddleware,
} from '@sentry/tanstackstart-react';
import { createCsrfMiddleware, createStart } from '@tanstack/react-start';
import { app_request_middleware } from '@/lib/request_middleware';

const csrf_middleware = createCsrfMiddleware({
  filter: (ctx) => ctx.handlerType === 'serverFn',
});

// Sentry goes first in both chains, so it reports whatever the later middleware or the handler
// throws. The build plugin's autoInstrumentMiddleware adds performance spans around these
// middlewares, but it only runs when the source-map credentials are set, so the error capture
// is wired by hand. See node_modules/@sentry/tanstackstart-react/build/types/server/
// globalMiddleware.d.ts, which asks for exactly this placement.
export const startInstance = createStart(() => ({
  requestMiddleware: [sentryGlobalRequestMiddleware, csrf_middleware, app_request_middleware],
  functionMiddleware: [sentryGlobalFunctionMiddleware],
}));
