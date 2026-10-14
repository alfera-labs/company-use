import { Skeleton } from '@coworker/ui/components/skeleton';

const placeholder_keys = (count: number) =>
  Array.from({ length: count }, (_, index) => `placeholder-${index}`);

export function TemplatesCatalogSkeleton({ rows = 10 }: { rows?: number }) {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col pb-10" aria-busy="true">
      <h1 className="mt-1 text-3xl font-semibold text-balance">Templates</h1>
      <Skeleton className="mt-3 h-4 w-96 max-w-full" />

      <div className="mt-7 flex flex-col gap-5">
        <div className="inline-flex h-9 w-fit items-center gap-1 rounded-2xl bg-muted p-1 text-sm text-muted-foreground">
          <span className="rounded-xl bg-background px-3 py-1 font-medium text-foreground">
            All
          </span>
          <span className="px-3 py-1">Tasks</span>
          <span className="px-3 py-1">Skills</span>
        </div>

        <div className="flex items-center justify-between gap-3">
          <Skeleton className="h-5 w-28" />
          <Skeleton className="h-9 w-64 rounded-2xl" />
        </div>

        <div className="flex flex-wrap gap-2">
          {placeholder_keys(5).map((key) => (
            <Skeleton key={key} className="h-8 w-24 rounded-full" />
          ))}
        </div>

        <div>
          <Skeleton className="mb-3 h-3 w-24" />
          <div className="grid gap-x-8 gap-y-1 md:grid-cols-2">
            {placeholder_keys(rows).map((key) => (
              <div key={key} className="px-2 py-2.5">
                <div className="min-w-0 space-y-2">
                  <Skeleton className="h-4 w-40 max-w-full" />
                  <Skeleton className="h-3.5 w-64 max-w-full" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}

export function TemplateListingSkeleton() {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col pb-10" aria-busy="true">
      <Skeleton className="h-4 w-56" />

      <div className="mt-6 grid gap-10 lg:grid-cols-[minmax(0,1fr)_320px] lg:gap-12">
        <div className="min-w-0">
          <Skeleton className="h-9 w-80 max-w-full" />
          <Skeleton className="mt-3 h-4 w-full max-w-xl" />
          <Skeleton className="mt-4 h-4 w-72" />

          {placeholder_keys(3).map((key) => (
            <section key={key} className="mt-8 border-t pt-6">
              <Skeleton className="mb-4 h-3 w-24" />
              <Skeleton className="h-4 w-full max-w-2xl" />
              <Skeleton className="mt-3 h-4 w-3/4 max-w-xl" />
            </section>
          ))}
        </div>

        <aside>
          <div className="rounded-xl border bg-card p-5">
            <Skeleton className="h-4 w-32" />
            <div className="mt-4 space-y-4 border-t pt-4">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
            <Skeleton className="mt-5 h-9 w-full rounded-2xl" />
          </div>
        </aside>
      </div>
    </main>
  );
}
