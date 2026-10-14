import { Button } from '@coworker/ui/components/button';
import { ArrowRight, Globe, ShieldCheck } from 'lucide-react';

/** The catalog request's outcome, in the three states the display rule cares about. */
export type CatalogRequestStatus = 'loading' | 'error' | 'success';

export type WebsiteFallbackConditions = {
  is_integrations_tab: boolean;
  search_query: string;
  catalog_status: CatalogRequestStatus;
  matching_integration_count: number;
};

/**
 * Reads the catalog query's outcome. A query that is neither loading nor errored
 * has answered, even when the answer is an empty list, and only then may the
 * fallback speak.
 */
export function read_catalog_request_status(query: {
  isLoading: boolean;
  isError: boolean;
  isPlaceholderData?: boolean;
}): CatalogRequestStatus {
  if (query.isLoading || query.isPlaceholderData) return 'loading';
  if (query.isError) return 'error';
  return 'success';
}

/**
 * The whole display rule, in one place. The offer only makes sense when the person
 * searched for something real, the catalog answered, and the answer was empty.
 */
export function should_offer_website_fallback(conditions: WebsiteFallbackConditions): boolean {
  if (!conditions.is_integrations_tab) return false;
  if (conditions.search_query.trim() === '') return false;
  if (conditions.catalog_status !== 'success') return false;
  return conditions.matching_integration_count === 0;
}

export function WebsiteFallbackPanel({
  website_name,
  on_use_website,
  learn_more_href,
}: {
  website_name: string;
  on_use_website: () => void;
  learn_more_href: string;
}) {
  const name = website_name.trim();
  return (
    <section className="flex flex-col gap-3">
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.8fr)]">
        <div className="flex flex-col justify-center gap-5 rounded-xl border border-border bg-muted/30 p-6">
          <div className="flex items-start gap-4">
            <span className="grid size-11 shrink-0 place-items-center rounded-xl border border-border bg-background">
              <Globe className="size-5 text-muted-foreground" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <h2 className="text-lg font-semibold text-balance">No connector needed.</h2>
              <p className="mt-1 text-sm text-muted-foreground text-pretty">
                Alfera can open {name} and use the website.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              className="min-h-11 rounded-2xl px-5"
              size="lg"
              type="button"
              onClick={on_use_website}
            >
              Use {name}
            </Button>
            <a
              className="inline-flex min-h-11 items-center gap-1.5 rounded-2xl px-3 text-sm font-medium underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              href={learn_more_href}
              rel="noreferrer"
              target="_blank"
            >
              See how this works
              <ArrowRight className="size-4" aria-hidden="true" />
            </a>
          </div>
        </div>
        <WebsitePreview websiteName={name} />
      </div>
      <p className="flex items-center justify-center gap-2 text-xs text-muted-foreground text-pretty">
        <ShieldCheck className="size-3.5 shrink-0" aria-hidden="true" />
        Runs in a controlled browser · You can review every action
      </p>
    </section>
  );
}

function WebsitePreview({ websiteName }: { websiteName: string }) {
  return (
    <div
      className="hidden overflow-hidden rounded-xl border border-border bg-muted/40 lg:block"
      aria-hidden="true"
    >
      <div className="flex items-center gap-2 border-b border-border bg-background/70 px-3 py-2">
        <span className="flex gap-1">
          <span className="size-2 rounded-full bg-muted-foreground/30" />
          <span className="size-2 rounded-full bg-muted-foreground/30" />
          <span className="size-2 rounded-full bg-muted-foreground/30" />
        </span>
        <span className="mx-auto max-w-[70%] truncate rounded-full bg-muted px-3 py-0.5 text-[11px] text-muted-foreground">
          {websiteName}
        </span>
      </div>
      <div className="flex flex-col items-center gap-2.5 px-6 py-6">
        <p className="text-sm font-semibold">{websiteName}</p>
        <p className="text-[11px] text-muted-foreground">Sign in to your account</p>
        <span className="h-7 w-full max-w-56 rounded-xl border border-border bg-background" />
        <span className="h-7 w-full max-w-56 rounded-xl border border-border bg-background" />
        <span className="h-7 w-full max-w-56 rounded-xl bg-primary/85" />
      </div>
    </div>
  );
}
