import type { TemplateCatalog } from '@coworker/shared';

/** The catalogue an install with no app catalogue key can use: no listing and no filter that needs an app. */
export function keep_listings_that_need_no_app(catalog: TemplateCatalog): TemplateCatalog {
  const listings = catalog.listings.filter((listing) => listing.apps.length === 0);
  return {
    ...catalog,
    listings,
    apps: [],
    filtered_count: listings.length,
    total_count: listings.length,
  };
}
