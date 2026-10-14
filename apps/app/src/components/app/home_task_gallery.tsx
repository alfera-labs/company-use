import { cn } from '@coworker/ui/lib/utils';
import { ArrowRight, BookOpen } from 'lucide-react';
import { memo, useState } from 'react';
import { SuggestionAppStack } from '@/components/app/chat_prompt_suggestions';
import { OwnKeyOrAlferaCloud } from '@/components/app/own_key_or_alfera_cloud';
import type { CatalogApp } from '@/lib/api';
import { featured_slugs_by_department } from '@/lib/home_featured_templates';
import { type HomeTemplate, home_templates } from '@/lib/home_template_catalog';
import { useInstallHasAppCatalogue } from '@/lib/use_install_has_app_catalogue';

const home_templates_that_need_no_app = home_templates.filter(
  (template) => template.app_aliases.length === 0,
);

const departments = [
  { key: 'sales', label: 'Sales' },
  { key: 'support', label: 'Support' },
  { key: 'finance', label: 'Finance' },
  { key: 'operations', label: 'Operations' },
] as const;

export const HomeTaskGallery = memo(function HomeTaskGallery({
  apps,
  onSelectTemplate,
}: {
  apps: CatalogApp[];
  onSelectTemplate: (setup_message: string) => void;
}) {
  const [department, set_department] = useState<string>('sales');
  const has_app_catalogue = useInstallHasAppCatalogue() ?? false;
  const shown = has_app_catalogue
    ? featured_templates(department)
    : home_templates_that_need_no_app.filter((template) => template.category === department);

  return (
    <div>
      <div className="flex justify-center gap-2" role="tablist">
        {departments.map(({ key, label }) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={key === department}
            onClick={() => set_department(key)}
            className={cn(
              'rounded-full border px-3.5 py-1.5 text-[13px] font-medium transition-colors duration-150',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30',
              key === department
                ? 'border-foreground/20 bg-card text-foreground shadow-xs'
                : 'border-border text-muted-foreground hover:bg-card hover:text-foreground',
            )}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="mt-5 flex flex-col gap-0.5">
        {shown.map((template) => (
          <TemplateLine
            key={template.slug}
            apps={apps}
            template={template}
            onSelect={() => onSelectTemplate(template.setup_message)}
          />
        ))}
      </div>

      <GalleryFoot has_app_catalogue={has_app_catalogue} />
    </div>
  );
});

function featured_templates(department: string) {
  const featured = featured_slugs_by_department[department] ?? [];
  return featured
    .map((slug) => home_templates.find((template) => template.slug === slug))
    .filter((template) => template !== undefined);
}

function GalleryFoot({ has_app_catalogue }: { has_app_catalogue: boolean }) {
  const usable_count = has_app_catalogue
    ? home_templates.length
    : home_templates_that_need_no_app.length;
  return (
    <div className="mt-4 text-center text-[13px] text-muted-foreground">
      <a className="transition-colors duration-150 hover:text-brand-ink" href="/templates">
        Browse all {usable_count} templates →
      </a>
      {has_app_catalogue ? null : (
        <p className="mt-2">
          {home_templates.length - usable_count} more templates need a connected app:{' '}
          <OwnKeyOrAlferaCloud />
        </p>
      )}
    </div>
  );
}

function TemplateLine({
  apps,
  template,
  onSelect,
}: {
  apps: CatalogApp[];
  template: HomeTemplate;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'group -mx-3 flex items-center gap-3.5 rounded-xl px-3 py-2.5 text-left',
        'transition-colors duration-150 hover:bg-card/90',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30',
      )}
    >
      <span className="flex w-[52px] shrink-0 justify-start">
        {template.app_aliases.length > 0 ? (
          <SuggestionAppStack
            aliases={template.app_aliases.slice(0, 2)}
            apps={apps}
            presentation="row"
          />
        ) : (
          <span
            className="grid size-[22px] place-items-center rounded-[6px] bg-card ring-1 ring-border"
            aria-hidden="true"
          >
            <BookOpen className="size-3 text-muted-foreground" />
          </span>
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium text-[14px] text-foreground leading-5">
          {template.name}
        </span>
        <span className="mt-px block truncate text-[13px] text-muted-foreground leading-5">
          {template.summary}
        </span>
      </span>
      <span className="hidden shrink-0 text-xs text-muted-foreground sm:block">
        {template.when_line}
      </span>
      <ArrowRight
        className={cn(
          'size-4 shrink-0 text-brand-ink opacity-0 transition-[opacity,transform] duration-150 ease-out',
          '-translate-x-0.5 group-hover:translate-x-0 group-hover:opacity-100',
        )}
        aria-hidden="true"
      />
    </button>
  );
}
