import type { TemplateCard, TemplateCatalog, TemplateFilterOption } from '@coworker/shared';
import { AppLogo } from '@coworker/ui/components/app-logo';
import { buttonVariants } from '@coworker/ui/components/button';
import { TemplatesSearchForm } from '@coworker/ui/components/templates-search-form';
import { cn } from '@coworker/ui/lib/utils';
import { Check, ChevronDown, ChevronRight, ListChecks, Sparkles } from 'lucide-react';
import type { ComponentType, ReactNode } from 'react';

/**
 * The templates catalogue.
 *
 * Same vocabulary as /integrations on both hosts: one page title, a tab strip, a count beside a
 * search field, then quiet rows in two columns with a square mark, a name and a muted line. No
 * stylesheet of its own — every value here is a shadcn token, so the surface takes the theme of
 * whichever app renders it and keeps taking it when the theme changes.
 *
 * Every filter is a link and every link is a GET: the back button works, a filtered catalogue is
 * a URL you can send to a colleague, and the page needs no client JavaScript of its own. The host
 * injects its link component, which turns those GETs into client navigations rather than reloads.
 */

export type TemplateFilterPatch = {
  kind?: string | null;
  category?: string | null;
  app?: string | null;
  sort?: string | null;
};

export type TemplatesHrefs = {
  catalog: string;
  listing: (slug: string) => string;
  filter: (patch: TemplateFilterPatch) => string;
};

export type TemplateLinkProps = {
  href: string;
  className?: string | undefined;
  'aria-current'?: 'true' | 'page' | undefined;
  children?: ReactNode;
};
export type TemplateLink = ComponentType<TemplateLinkProps>;

export const plain_link: TemplateLink = ({ children, ...props }) => <a {...props}>{children}</a>;

export function TemplatesCatalogView({
  catalog,
  hrefs,
  brand_name,
  link: Link = plain_link,
  with_header = true,
  ask_href,
  asked_for_action,
  on_search,
}: {
  catalog: TemplateCatalog;
  hrefs: TemplatesHrefs;
  brand_name: string;
  link?: TemplateLink;
  with_header?: boolean;
  ask_href?: string;
  asked_for_action?: string;
  on_search?: (query: string) => void;
}) {
  const is_browsing =
    !catalog.query &&
    catalog.categories.every((category) => !category.is_active) &&
    catalog.apps.every((app) => !app.is_active);

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col pb-10">
      {with_header ? (
        <>
          <h1 className="mt-1 text-xl font-semibold text-balance">Templates</h1>
          <p className="mt-2 max-w-xl text-sm text-muted-foreground text-pretty">
            Every job {brand_name} can take on. Add one and it runs on your own tools.
          </p>
        </>
      ) : null}

      <div className={with_header ? 'mt-7 flex flex-col gap-5' : 'flex flex-col gap-5'}>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-baseline gap-2 text-base font-medium tabular-nums">
            {catalog.filtered_count === catalog.total_count
              ? `${catalog.total_count} templates`
              : `${catalog.filtered_count} of ${catalog.total_count} templates`}
            {catalog.installed_count > 0 ? (
              <span className="text-sm font-normal text-muted-foreground">
                · {catalog.installed_count} added
              </span>
            ) : null}
          </div>
          <TemplatesSearchForm
            action={hrefs.catalog}
            query={catalog.query ?? ''}
            className={with_header ? 'relative w-full sm:w-64' : 'hidden'}
            on_search={on_search}
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {catalog.categories.map((category) => (
            <Link
              key={category.key}
              href={hrefs.filter({ category: category.is_active ? null : category.key })}
              aria-current={category.is_active ? 'true' : undefined}
              className={cn(
                'inline-flex h-7 items-center rounded-xl px-2.5 text-[13px] transition-colors',
                category.is_active
                  ? 'bg-sunken text-foreground shadow-[inset_0_0_0_1px_var(--border)]'
                  : 'text-muted-foreground hover:bg-hover hover:text-foreground',
              )}
            >
              {category.label}
            </Link>
          ))}
          <span className="ml-auto flex items-center gap-2">
            <FilterMenu
              label={active_app_label(catalog.apps)}
              options={catalog.apps}
              link={Link}
              href={(option) => hrefs.filter({ app: option.is_active ? null : option.key })}
            />
            <FilterMenu
              label={`Sort: ${catalog.sorts.find((sort) => sort.is_active)?.label ?? 'Recommended'}`}
              options={catalog.sorts}
              link={Link}
              href={(option) => hrefs.filter({ sort: option.key })}
            />
          </span>
        </div>

        {catalog.listings.length > 0 ? (
          is_browsing ? (
            <div className="flex flex-col gap-7">
              {group_by_category(catalog).map((group) => (
                <ListingGroup
                  key={group.key}
                  title={group.title}
                  dot={group.key}
                  count={group.listings.length}
                >
                  {group.listings.map((listing) => (
                    <TemplateRow
                      key={listing.slug}
                      listing={listing}
                      href={hrefs.listing(listing.slug)}
                      link={Link}
                    />
                  ))}
                </ListingGroup>
              ))}
            </div>
          ) : (
            <ListingGroup title={catalog.heading} count={catalog.filtered_count}>
              {catalog.listings.map((listing) => (
                <TemplateRow
                  key={listing.slug}
                  listing={listing}
                  href={hrefs.listing(listing.slug)}
                  link={Link}
                />
              ))}
            </ListingGroup>
          )
        ) : (
          <section>
            <h2 className="mb-3 text-xs font-medium uppercase text-muted-foreground">
              {catalog.heading}
            </h2>
            {catalog.query ? (
              <AskAlfera
                query={catalog.query}
                brand_name={brand_name}
                ask_href={ask_href}
                asked_for_action={asked_for_action}
              />
            ) : (
              <EmptyFilter clear_href={hrefs.catalog} link={Link} />
            )}
          </section>
        )}
      </div>
    </main>
  );
}

function ListingGroup({
  title,
  count,
  dot,
  children,
}: {
  title: string;
  count: number;
  dot?: string;
  children: ReactNode;
}) {
  return (
    <section>
      <h2 className="mb-3 flex items-center gap-2 text-xs font-medium uppercase text-muted-foreground">
        {dot ? (
          <span
            aria-hidden="true"
            className={cn('size-1.5 rounded-full', category_dots[dot] ?? 'bg-muted-foreground/40')}
          />
        ) : null}
        {title}
        <span className="tabular-nums text-muted-foreground/60">{count}</span>
      </h2>
      <div className="grid gap-x-8 gap-y-1 md:grid-cols-2">{children}</div>
    </section>
  );
}

/** The five shelves, in the order the toolbar lists them. */
export const category_dots: Record<string, string> = {
  sales: 'bg-rose-400',
  support: 'bg-blue-400',
  operations: 'bg-emerald-400',
  finance: 'bg-violet-400',
  events: 'bg-amber-400',
};

/**
 * The listings split by shelf, in the toolbar's order, keeping the order they arrived in inside
 * each one. A listing on no shelf still gets a home rather than dropping off the page.
 */
export function group_by_category(catalog: TemplateCatalog) {
  const groups = catalog.categories.map((category) => ({
    key: category.key,
    title: category.label,
    listings: catalog.listings.filter((listing) => listing.category?.facet_key === category.key),
  }));
  const placed = new Set(groups.flatMap((group) => group.listings.map((l) => l.slug)));
  const rest = catalog.listings.filter((listing) => !placed.has(listing.slug));
  return [
    ...groups.filter((group) => group.listings.length > 0),
    ...(rest.length > 0 ? [{ key: 'other', title: 'Everything else', listings: rest }] : []),
  ];
}

function active_app_label(apps: TemplateFilterOption[]) {
  return apps.find((app) => app.is_active)?.label ?? 'Apps';
}

function FilterMenu({
  label,
  options,
  href,
  link: Link,
}: {
  label: string;
  options: TemplateFilterOption[];
  href: (option: TemplateFilterOption) => string;
  link: TemplateLink;
}) {
  if (options.length === 0) return null;
  return (
    <details className="relative [&>summary::-webkit-details-marker]:hidden [&>summary]:list-none">
      <summary className="field inline-flex h-8 cursor-pointer items-center gap-1.5 px-2.5 text-sm">
        {label}
        <ChevronDown className="size-4 text-muted-foreground" aria-hidden="true" />
      </summary>
      <div className="absolute right-0 z-20 mt-1 max-h-80 w-64 overflow-y-auto rounded-2xl bg-popover p-1 shadow-float ring-1 ring-strong">
        {options.map((option) => (
          <Link
            key={option.key}
            href={href(option)}
            aria-current={option.is_active ? 'true' : undefined}
            className={cn(
              'flex min-h-7.5 items-center justify-between gap-3 rounded-xl px-2 py-1 text-sm text-foreground transition-colors hover:bg-hover',
            )}
          >
            <span className="truncate">{option.label}</span>
            <span className="flex items-center gap-2">
              {option.listing_count === null ? null : (
                <span className="text-xs tabular-nums text-muted-foreground">
                  {option.listing_count}
                </span>
              )}
              {option.is_active ? <Check className="size-4" aria-hidden="true" /> : null}
            </span>
          </Link>
        ))}
      </div>
    </details>
  );
}

/**
 * One row: the name, what it does, and the apps it touches.
 *
 * No mark on the left. Every template would carry the same two glyphs — one for a task, one for a
 * skill — and a column that only ever holds two values is a column that says nothing. The kind is
 * already the tab you filtered by, and it is stated on the listing.
 */
export function TemplateRow({
  listing,
  href,
  link: Link = plain_link,
  size = 'compact',
}: {
  listing: TemplateCard;
  href: string;
  link?: TemplateLink;
  size?: 'compact' | 'roomy';
}) {
  const roomy = size === 'roomy';
  return (
    <Link
      href={href}
      className={cn(
        'grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3 rounded-xl transition-colors hover:bg-muted/40',
        roomy ? 'px-3 py-3.5' : 'px-2 py-2.5',
      )}
    >
      <span className="min-w-0">
        <span className={cn('block truncate font-medium', roomy ? 'text-base' : 'text-sm')}>
          {listing.name}
        </span>
        <span
          className={cn(
            'mt-0.5 line-clamp-2 block text-muted-foreground',
            roomy ? 'text-[15px] leading-snug' : 'text-sm',
          )}
        >
          {listing.summary}
        </span>
      </span>
      <span className={cn('flex items-center gap-2.5', roomy ? 'pt-1' : 'pt-0.5')}>
        {listing.is_installed ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-400">
            <Check className="size-3" aria-hidden="true" />
            Added
          </span>
        ) : (
          <span className="hidden items-center gap-1.5 sm:flex">
            {listing.apps.slice(0, 3).map((app) => (
              <AppLogo
                key={app.app_key}
                app_key={app.app_key}
                label={app.label}
                size={roomy ? 18 : 16}
              />
            ))}
          </span>
        )}
        <ChevronRight className="size-4 shrink-0 text-muted-foreground/60" aria-hidden="true" />
      </span>
    </Link>
  );
}

/** A filter that matched nothing. Nobody typed anything here, so nobody is pitched anything. */
export function EmptyFilter({
  clear_href,
  link: Link = plain_link,
}: {
  clear_href: string;
  link?: TemplateLink;
}) {
  return (
    <div className="flex flex-col items-center gap-1 rounded-4xl border border-border border-dashed px-6 py-12 text-center">
      <span className="mb-2 grid size-11 place-items-center rounded-2xl bg-sunken text-muted-foreground">
        <ListChecks className="size-[18px]" aria-hidden="true" />
      </span>
      <p className="text-sm font-medium">No templates match this filter</p>
      <p className="text-xs text-muted-foreground">Clear it, or try another category.</p>
      <Link href={clear_href} className={cn(buttonVariants({ variant: 'outline' }), 'mt-3')}>
        Show all templates
      </Link>
    </div>
  );
}

/**
 * The miss is a first-class screen, not an error state.
 *
 * A search that returns nothing is the highest-intent moment in the product, and most search pages
 * render "no results found" there. There is no catalogue answer, but there is a product one: the
 * thing that writes these templates is the same thing you can ask for one. The phrase is logged
 * on the way through, because what somebody typed here is the shelf's next listing.
 */
export function AskAlfera({
  query,
  brand_name,
  ask_href,
  asked_for_action,
}: {
  query: string;
  brand_name: string;
  ask_href?: string | undefined;
  asked_for_action?: string | undefined;
}) {
  const ask = query
    ? `Nothing on the shelf does “${query}”.`
    : 'Nothing on the shelf does that yet.';
  return (
    <div className="flex flex-col items-center rounded-2xl border px-6 py-14 text-center">
      <span className="mb-3 grid size-10 place-items-center rounded-2xl border bg-background text-muted-foreground">
        <Sparkles className="size-[18px]" aria-hidden="true" />
      </span>
      <h3 className="text-base font-semibold text-balance">{ask}</h3>
      <p className="mt-1.5 max-w-md text-sm text-muted-foreground text-pretty">
        Describe the job in a chat and {brand_name} will build the task with you — your tools, your
        rules, running on your schedule.
      </p>
      {ask_href ? (
        <a className={cn(buttonVariants(), 'mt-5')} href={ask_href}>
          Ask {brand_name} to create it
        </a>
      ) : null}
      {asked_for_action ? (
        <form action={asked_for_action} method="post" className="mt-3">
          <input type="hidden" name="asked_phrase" value={query} />
          <button
            type="submit"
            className="text-xs text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline"
          >
            Or tell us to add it to the shelf
          </button>
        </form>
      ) : null}
    </div>
  );
}
