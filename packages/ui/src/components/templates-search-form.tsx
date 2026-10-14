import { Search } from 'lucide-react';
import type { FormEvent } from 'react';

export function TemplatesSearchForm({
  action,
  query,
  className,
  on_search,
}: {
  action: string;
  query: string;
  className: string;
  on_search?: ((query: string) => void) | undefined;
}) {
  const search_without_reload = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    on_search?.(String(new FormData(event.currentTarget).get('q') ?? ''));
  };
  return (
    <form
      action={action}
      method="get"
      className={className}
      onSubmit={on_search ? search_without_reload : undefined}
    >
      <label className="sr-only" htmlFor="templates-search">
        Search templates
      </label>
      <Search
        className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden="true"
      />
      <input
        key={query}
        id="templates-search"
        name="q"
        type="search"
        defaultValue={query}
        placeholder="Search templates or apps"
        className="field h-8 w-full pl-8 pr-2.5 text-sm"
      />
    </form>
  );
}
