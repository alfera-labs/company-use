import '@coworker/ui/globals.css';
import '@coworker/ui/rewards.css';
import '@/styles/fonts.css';
import { public_brand_config } from '@coworker/config/public_env';
import { Button } from '@coworker/ui/components/button';
import * as Sentry from '@sentry/tanstackstart-react';
import {
  createRootRoute,
  type ErrorComponentProps,
  HeadContent,
  Scripts,
} from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { useEffect } from 'react';
import { AppProviders } from '@/components/providers/app_providers';

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: public_brand_config.product_brand_name },
      { name: 'robots', content: 'noindex, nofollow' },
    ],
    links: [{ rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' }],
  }),
  shellComponent: RootDocument,
  errorComponent: RouteError,
});

function RouteError({ error, reset }: ErrorComponentProps) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <div className="flex h-full min-h-[50vh] flex-col items-center justify-center gap-4 p-8 text-center">
      <p className="text-muted-foreground text-sm">Something went wrong.</p>
      <Button onClick={reset}>Try again</Button>
    </div>
  );
}

function AppCrashed() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 p-8 text-center">
      <p className="text-muted-foreground text-sm">Something went wrong.</p>
      <Button onClick={() => window.location.reload()}>Reload</Button>
    </div>
  );
}

function RootDocument({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className="font-sans">
      <head>
        <HeadContent />
      </head>
      <body>
        <Sentry.ErrorBoundary fallback={<AppCrashed />}>
          <AppProviders>{children}</AppProviders>
        </Sentry.ErrorBoundary>
        <Scripts />
      </body>
    </html>
  );
}
