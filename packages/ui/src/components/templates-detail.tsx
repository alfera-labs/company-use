import type { TemplateListing, TemplateSetupIcon, TemplateStartBlock } from '@coworker/shared';
import { AppLogo } from '@coworker/ui/components/app-logo';
import { Button, buttonVariants } from '@coworker/ui/components/button';
import {
  plain_link,
  type TemplateLink,
  TemplateRow,
  type TemplatesHrefs,
} from '@coworker/ui/components/templates-catalog';
import { cn } from '@coworker/ui/lib/utils';
import {
  ArrowLeft,
  BookOpen,
  Calendar,
  Check,
  ChevronDown,
  Clock,
  FileText,
  List,
  ListChecks,
  Mail,
  MessageSquare,
  Settings2,
  Table2,
  Terminal,
  Type,
  Zap,
} from 'lucide-react';
import type { ReactNode } from 'react';

/** A URL to post to, or a server action. Kept structural so this file stays framework-free. */
export type InstallAction = string | ((form_data: FormData) => void | Promise<void>);

export function TemplateListingView({
  listing,
  hrefs,
  brand_name,
  link: Link = plain_link,
  install_action,
  cta_href,
}: {
  listing: TemplateListing;
  hrefs: TemplatesHrefs;
  brand_name: string;
  link?: TemplateLink;
  install_action?: InstallAction;
  cta_href?: string;
}) {
  const is_skill = listing.kind === 'skill';

  return (
    <main className="flex w-full flex-col pb-10">
      <Link
        href={hrefs.catalog}
        className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Back to templates
      </Link>

      <div className="mt-5 grid gap-8 lg:grid-cols-[minmax(0,1fr)_340px] lg:gap-12">
        <div className="min-w-0">
          <h1 className="text-3xl font-semibold tracking-tight text-balance">{listing.name}</h1>
          <MetaRow listing={listing} hrefs={hrefs} link={Link} />
          <p className="mt-4 max-w-2xl text-[15px] text-muted-foreground text-pretty">
            {listing.summary}
          </p>

          <div className="mt-6 flex flex-col gap-4">
            {listing.what_it_does.length > 0 ? (
              <Section label="What it does">
                <ol className="flex flex-col gap-2.5">
                  {listing.what_it_does.map((step, index) => (
                    <li key={step} className="flex items-start gap-3 text-sm">
                      <span className="grid size-5 shrink-0 place-items-center rounded-full border text-[11px] tabular-nums text-muted-foreground">
                        {index + 1}
                      </span>
                      <span>{step}</span>
                    </li>
                  ))}
                </ol>
              </Section>
            ) : null}

            {is_skill ? <UsedWhen listing={listing} brand_name={brand_name} /> : null}
            {is_skill ? <Guidance listing={listing} /> : <StartsWhen listing={listing} />}

            <Capabilities listing={listing} />
            <Files listing={listing} />
          </div>

          {listing.related.length > 0 ? (
            <section className="mt-8">
              <h2 className="mb-2 text-sm font-medium">
                More in {listing.category?.title ?? 'the catalogue'}
              </h2>
              <div className="-mx-2 flex flex-col">
                {listing.related.map((related) => (
                  <TemplateRow
                    key={related.slug}
                    listing={related}
                    href={hrefs.listing(related.slug)}
                    link={Link}
                  />
                ))}
              </div>
            </section>
          ) : null}
        </div>

        <SetupPanel
          listing={listing}
          brand_name={brand_name}
          install_action={install_action}
          cta_href={cta_href}
        />
      </div>
    </main>
  );
}

function Capabilities({ listing }: { listing: TemplateListing }) {
  if (listing.access.length === 0) return null;
  return (
    <Section label="What it will be able to do">
      <ul className="grid gap-2.5 sm:grid-cols-2 sm:gap-x-8">
        {listing.access.map((line) => (
          <li key={line.label} className="flex items-start gap-2.5 text-sm">
            <Check className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span className="min-w-0">
              {line.label}
              <span className="ml-1.5 text-muted-foreground">
                · {line.risk_label.toLowerCase()}
              </span>
            </span>
          </li>
        ))}
      </ul>
      {listing.caveat ? (
        <p className="mt-4 text-sm text-muted-foreground">{listing.caveat}</p>
      ) : null}
    </Section>
  );
}

function Files({ listing }: { listing: TemplateListing }) {
  const { tree, file_count, total_bytes } = listing.whats_inside;
  if (tree.length === 0) return null;
  return (
    <Section label="Files">
      <p className="text-sm text-muted-foreground">
        {file_count} {file_count === 1 ? 'file' : 'files'} · {describe_bytes(total_bytes)}.
        Everything the template ships. Open one to read it.
      </p>
      <ul className="mt-3 flex flex-col">
        {tree.map((file) => (
          <li key={file.file_path} className="border-b last:border-b-0">
            {file.preview_text ? (
              <details className="group">
                <summary className="flex cursor-pointer list-none items-center gap-3 py-2.5 text-sm">
                  <FileRoleIcon role={file.file_role} />
                  <span className="min-w-0 flex-1 truncate font-mono text-[13px]">
                    {file.file_path}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">{file.note}</span>
                  <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                    {describe_bytes(file.byte_size)}
                  </span>
                  <ChevronDown
                    className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180"
                    aria-hidden="true"
                  />
                </summary>
                <pre className="mb-3 max-h-96 overflow-auto rounded-2xl border bg-muted/40 p-4 font-mono text-xs leading-relaxed whitespace-pre-wrap">
                  {file.preview_text}
                </pre>
              </details>
            ) : (
              <div className="flex items-center gap-3 py-2.5 text-sm">
                <FileRoleIcon role={file.file_role} />
                <span className="min-w-0 flex-1 truncate font-mono text-[13px]">
                  {file.file_path}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">{file.note}</span>
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                  {describe_bytes(file.byte_size)}
                </span>
              </div>
            )}
          </li>
        ))}
      </ul>
    </Section>
  );
}

function describe_bytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

const file_role_icons: Record<string, ReactNode> = {
  instructions: <BookOpen className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />,
  bundled_skill: <BookOpen className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />,
  sidecar: <Settings2 className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />,
  script: <Terminal className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />,
};

function FileRoleIcon({ role }: { role: string }) {
  return (
    file_role_icons[role] ?? (
      <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
    )
  );
}

function MetaRow({
  listing,
  hrefs,
  link: Link,
}: {
  listing: TemplateListing;
  hrefs: TemplatesHrefs;
  link: TemplateLink;
}) {
  const timings = listing.used_when
    ? [listing.used_when.summary]
    : listing.starts_when.map((block) => block.token);
  const facts = [
    ...timings,
    listing.apps.length === 0
      ? 'No apps required'
      : `${listing.apps.length} app${listing.apps.length === 1 ? '' : 's'}`,
  ];

  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-2.5 gap-y-1.5 text-sm text-muted-foreground">
      <span className="flex items-center gap-2 text-foreground">
        <span className="grid size-5 shrink-0 place-items-center rounded bg-primary text-[10px] font-semibold text-primary-foreground">
          {listing.publisher.display_name.charAt(0)}
        </span>
        by {listing.publisher.display_name}
      </span>
      {listing.category ? (
        <>
          <span aria-hidden="true" className="text-muted-foreground/50">
            ·
          </span>
          <Link
            href={hrefs.filter({ category: listing.category.facet_key })}
            className="transition-colors hover:text-foreground"
          >
            {listing.category.title}
          </Link>
        </>
      ) : null}
      {facts.map((fact) => (
        <span key={fact} className="flex items-center gap-2.5">
          <span aria-hidden="true" className="text-muted-foreground/50">
            ·
          </span>
          {fact}
        </span>
      ))}
    </div>
  );
}

function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className="rounded-2xl border bg-card p-5 sm:p-6">
      <h2 className="mb-3 text-base font-semibold tracking-tight">{label}</h2>
      {children}
    </section>
  );
}

function StartsWhen({ listing }: { listing: TemplateListing }) {
  if (listing.starts_when.length === 0) return null;
  return (
    <Section label="When it runs">
      <div className="grid gap-4 sm:grid-cols-2 sm:gap-x-8">
        {listing.starts_when.map((block) => (
          <div key={block.title} className="flex items-start gap-3">
            <StartIcon icon={block.icon} />
            <div className="min-w-0">
              <p className="text-sm font-medium">{block.title}</p>
              {block.note ? (
                <p className="mt-0.5 text-sm text-muted-foreground">{block.note}</p>
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </Section>
  );
}

function UsedWhen({ listing, brand_name }: { listing: TemplateListing; brand_name: string }) {
  if (!listing.used_when) return null;
  const { discovery_phrases, note } = listing.used_when;
  return (
    <Section label={`When ${brand_name} uses it`}>
      {discovery_phrases.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {discovery_phrases.map((phrase) => (
            <span
              key={phrase}
              className="inline-flex h-8 items-center rounded-full border px-3.5 text-[13px] text-muted-foreground"
            >
              “{sentence_case(phrase)}”
            </span>
          ))}
        </div>
      ) : null}
      <p className="mt-3 text-sm text-muted-foreground">{note}</p>
    </Section>
  );
}

function Guidance({ listing }: { listing: TemplateListing }) {
  if (listing.guidance.length === 0) return null;
  return (
    <Section label="The guidance">
      <dl className="flex flex-col">
        {listing.guidance.map((line) => (
          <div
            key={line.label}
            className="grid gap-1 border-b py-2.5 last:border-b-0 sm:grid-cols-[180px_minmax(0,1fr)] sm:gap-4"
          >
            <dt className="text-sm font-medium">{line.label}</dt>
            <dd className="text-sm text-muted-foreground">{line.value}</dd>
          </div>
        ))}
      </dl>
    </Section>
  );
}

function SetupPanel({
  listing,
  brand_name,
  install_action,
  cta_href,
}: {
  listing: TemplateListing;
  brand_name: string;
  install_action?: InstallAction | undefined;
  cta_href?: string | undefined;
}) {
  const has_apps = listing.apps.length > 0;
  const filled = listing.setup_questions.filter((question) => question.example_answer);
  const chosen = listing.setup_questions.filter((question) => !question.example_answer);
  const creates = listing.install.will_create.map(describe_created);

  return (
    <aside className="flex flex-col gap-4 lg:sticky lg:top-6 lg:self-start">
      <InstallButton listing={listing} install_action={install_action} cta_href={cta_href} />

      <div className="rounded-xl border bg-card p-5" id="setup">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-sm font-medium">
            {has_apps ? 'Apps and setup' : `Set up this template`}
          </h2>
        </div>

        <div className="mt-4 flex flex-col gap-4 border-t pt-4">
          {has_apps ? (
            listing.apps.map((app) => (
              <div key={app.app_key} className="grid grid-cols-[32px_minmax(0,1fr)] gap-3">
                <span className="grid size-8 shrink-0 place-items-center overflow-hidden rounded-2xl border bg-background">
                  <AppLogo app_key={app.app_key} label={app.label} size={18} />
                </span>
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                    {app.label}
                    <span
                      className={cn(
                        'rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium',
                        app.is_optional ? 'text-muted-foreground' : 'text-foreground',
                      )}
                    >
                      {app.is_optional ? 'Optional' : 'Required'}
                    </span>
                  </p>
                  {app.why ? (
                    <p className="mt-0.5 text-sm text-muted-foreground">{app.why}</p>
                  ) : null}
                  {app.connection_status === 'unknown' ? null : (
                    <p className="mt-1.5 text-xs text-muted-foreground">
                      {app.connection_status === 'connected' ? 'Connected' : 'Not connected yet'}
                    </p>
                  )}
                </div>
              </div>
            ))
          ) : (
            <div className="grid grid-cols-[32px_minmax(0,1fr)] gap-3">
              <FileText className="mt-0.5 size-5 text-muted-foreground" aria-hidden="true" />
              <div>
                <p className="text-sm font-medium">No apps required</p>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  {listing.kind === 'skill'
                    ? 'It only adds guidance. Nothing gets connected.'
                    : 'Nothing to connect before it runs.'}
                </p>
              </div>
            </div>
          )}
        </div>

        {filled.length > 0 ? (
          <div className="mt-4 flex flex-col gap-3 border-t pt-4">
            <p className="text-sm font-medium">In your own words</p>
            {filled.map((question) => (
              <div key={question.input_key}>
                <p className="text-xs font-medium text-muted-foreground">{question.label}</p>
                <p className="mt-1 rounded-2xl border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
                  {question.example_answer}
                </p>
              </div>
            ))}
          </div>
        ) : null}

        {chosen.length > 0 ? (
          <div className="mt-4 border-t pt-4">
            <p className="text-sm font-medium">You will choose</p>
            <ul className="mt-2 flex flex-col gap-2">
              {chosen.map((question) => (
                <li key={question.input_key} className="flex items-center gap-2.5 text-sm">
                  <SetupIcon icon={question.icon} />
                  <span>{question.label}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {creates.length > 0 ? (
          <div className="mt-4 border-t pt-4">
            <p className="text-sm font-medium">What it creates</p>
            <ul className="mt-2 flex flex-col gap-2">
              {creates.map((created) => (
                <li key={created.label} className="flex items-center gap-2.5 text-sm">
                  <CreatedIcon kind={created.kind} />
                  <span>{created.label}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <p className="mt-4 border-t pt-4 text-xs text-muted-foreground">
          {has_apps
            ? `You review every connection before ${brand_name} uses it.`
            : 'You can edit or remove this guidance at any time.'}
          {listing.install.blocking.length > 0 ? ` ${listing.install.blocking.join(' ')}` : ''}
        </p>
      </div>

      <div className="rounded-xl border p-5">
        <div className="flex items-center gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-2xl bg-primary text-sm font-semibold text-primary-foreground">
            {listing.publisher.display_name.charAt(0)}
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{listing.publisher.display_name}</p>
            <p className="truncate text-xs text-muted-foreground">
              {listing.publisher.is_platform ? 'Publisher' : 'Workspace publisher'}
            </p>
          </div>
        </div>
        <p className="mt-3 text-sm text-muted-foreground text-pretty">
          {listing.publisher.is_platform
            ? 'Built and maintained in-house. Every version is reviewed before it reaches this page, and re-published versions ask for your permission again.'
            : 'Published by a workspace on Alfera.'}
        </p>
      </div>
    </aside>
  );
}

function InstallButton({
  listing,
  install_action,
  cta_href,
}: {
  listing: TemplateListing;
  install_action?: InstallAction | undefined;
  cta_href?: string | undefined;
}) {
  const label = listing.install.is_installed ? 'Added' : listing.install.cta_label;

  if (!install_action) {
    return cta_href ? (
      <a className={cn(buttonVariants(), 'w-full')} href={cta_href}>
        {label}
      </a>
    ) : (
      <Button className="w-full" disabled>
        {label}
      </Button>
    );
  }

  return (
    <form action={install_action} method="post">
      <input type="hidden" name="template_id" value={listing.install.template_id} />
      <input type="hidden" name="slug" value={listing.slug} />
      <Button type="submit" className="w-full" disabled={listing.install.is_installed}>
        {label}
      </Button>
    </form>
  );
}

function describe_created(entry: { object_kind: string; count: number }) {
  const nouns: Record<string, [string, string]> = {
    task: ['task', 'tasks'],
    trigger: ['trigger that starts it', 'triggers that start it'],
    skill: ['skill it can read', 'skills it can read'],
    deployed_listener: ['listener on your app', 'listeners on your apps'],
    connection: ['connection', 'connections'],
  };
  const [one, many] = nouns[entry.object_kind] ?? [entry.object_kind, `${entry.object_kind}s`];
  return {
    kind: entry.object_kind,
    label: `${entry.count} ${entry.count === 1 ? one : many}`,
  };
}

const created_icons: Record<string, ReactNode> = {
  task: <ListChecks className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />,
  trigger: <Zap className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />,
  skill: <BookOpen className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />,
};

function CreatedIcon({ kind }: { kind: string }) {
  return (
    created_icons[kind] ?? (
      <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
    )
  );
}

const setup_icons: Record<TemplateSetupIcon, ReactNode> = {
  document: <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />,
  table: <Table2 className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />,
  clock: <Clock className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />,
  text: <Type className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />,
  list: <List className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />,
  chat: <MessageSquare className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />,
  mail: <Mail className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />,
};

function SetupIcon({ icon }: { icon: TemplateSetupIcon }) {
  return setup_icons[icon];
}

const start_icons: Record<TemplateStartBlock['icon'], ReactNode> = {
  calendar: (
    <Calendar className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
  ),
  bolt: <Zap className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />,
  chat: (
    <MessageSquare className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
  ),
};

function StartIcon({ icon }: { icon: TemplateStartBlock['icon'] }) {
  return start_icons[icon];
}

function sentence_case(phrase: string) {
  return phrase.charAt(0).toUpperCase() + phrase.slice(1);
}
