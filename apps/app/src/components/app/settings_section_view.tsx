import { cn } from '@coworker/ui/lib/utils';
import {
  type SettingsPanelContext,
  settings_section_panels,
} from '@/components/app/settings_section_panels';
import { find_settings_section } from '@/lib/settings_navigation';

export function SettingsSectionView({
  section_id,
  context,
}: {
  section_id: string;
  context: SettingsPanelContext;
}) {
  const section = find_settings_section(section_id);
  const render_panel = settings_section_panels[section.section_id];
  const description = describe_settings_section(section, context);

  return (
    <main
      className={cn(
        'mx-auto flex w-full flex-col gap-9 pb-10',
        section.surface === 'wide' ? 'max-w-6xl' : 'max-w-3xl',
      )}
    >
      <header className="mt-1 flex flex-col gap-1.5 border-border border-b pb-8">
        <h1 className="font-semibold text-xl text-balance">{section.title}</h1>
        <p className="max-w-[65ch] text-muted-foreground text-sm text-pretty">{description}</p>
      </header>

      {section.surface === 'panel' ? (
        <div className="panel p-3.5">{render_panel(context)}</div>
      ) : (
        render_panel(context)
      )}
    </main>
  );
}

/**
 * The line under a section title. The profile of an install that signs people in itself holds
 * no email and no password, so its line does not promise them.
 */
export function describe_settings_section(
  section: ReturnType<typeof find_settings_section>,
  context: SettingsPanelContext,
) {
  const signs_people_in_itself = context.runs_in_local_mode || context.runs_in_team_mode;
  if (section.section_id === 'profile' && signs_people_in_itself) {
    return 'How you sign in to this install.';
  }
  return section.description;
}
