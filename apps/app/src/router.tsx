import * as Sentry from '@sentry/tanstackstart-react';
import { createRouter, Link } from '@tanstack/react-router';
import { track_third_party_page_view } from '@/lib/third_party_trackers';
import { routeTree } from '@/routeTree.gen';

export function getRouter() {
  const router = createRouter({
    routeTree,
    defaultPreload: 'intent',
    scrollRestoration: true,
    defaultPendingMs: 150,
    defaultPendingMinMs: 300,
    defaultNotFoundComponent: BareNotFound,
  });

  // Navigation spans need THE router instance, and this function is the only place it exists:
  // StartClient builds the router here during hydration and accepts no router prop. Sentry.init
  // has already run in client.tsx by then, so the integration joins afterwards.
  if (typeof document !== 'undefined') {
    Sentry.addIntegration(Sentry.tanstackRouterBrowserTracingIntegration(router));
    track_third_party_page_view(window.location.pathname);
    router.subscribe('onResolved', (event) => {
      if (event.pathChanged) track_third_party_page_view(event.toLocation.pathname);
    });
  }

  return router;
}

function BareNotFound() {
  return (
    <div className="grid min-h-dvh place-items-center bg-background text-center text-foreground">
      <div className="space-y-2">
        <h1 className="text-base font-medium">Page not found</h1>
        <p className="text-sm text-muted-foreground">
          That page doesn’t exist.{' '}
          <Link to="/" className="text-foreground underline underline-offset-4">
            Back to home
          </Link>
        </p>
      </div>
    </div>
  );
}
