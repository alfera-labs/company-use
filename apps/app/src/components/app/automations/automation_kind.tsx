import { cn } from '@coworker/ui/lib/utils';
import { Clock3, type LucideIcon, Target, Zap } from 'lucide-react';
import { z } from 'zod';
import type { AutomationListItem } from '@/components/app/automations/automations_api';

export type AutomationKind = 'trigger' | 'scheduled' | 'goal';
export type KindFilter = AutomationKind | 'all';

const kind_words: Record<
  AutomationKind,
  { label: string; filter_label: string; Icon: LucideIcon }
> = {
  trigger: { label: 'Trigger', filter_label: 'Triggers', Icon: Zap },
  scheduled: { label: 'Scheduled', filter_label: 'Scheduled', Icon: Clock3 },
  goal: { label: 'Goal', filter_label: 'Goals', Icon: Target },
};
const kind_order: AutomationKind[] = ['trigger', 'scheduled', 'goal'];

/**
 * Scheduled means a clock starts it and nothing else does. "When you ask" does not count as
 * something else: Test adds that start to every automation it runs.
 */
export function kind_of_trigger_types(trigger_types: string[]): AutomationKind {
  const starts_by_itself = trigger_types.filter((type) => type !== 'manual');
  const clock_only =
    starts_by_itself.length > 0 && starts_by_itself.every((type) => type === 'schedule');
  return clock_only ? 'scheduled' : 'trigger';
}

export function kind_of_automation(automation: AutomationListItem): AutomationKind {
  if (is_goal_automation(automation)) return 'goal';
  return kind_of_trigger_types(automation.triggers.map((trigger) => trigger.trigger_type));
}

const goal_marks = z.object({ node_key: z.string().optional() });
function is_goal_automation(automation: AutomationListItem) {
  const marks = goal_marks.safeParse(automation.metadata);
  return marks.success && (marks.data.node_key?.startsWith('goals-create_goal') ?? false);
}

export function automation_display_name(automation: AutomationListItem, kind: AutomationKind) {
  return kind === 'goal'
    ? automation.automation_name.replace(/^Goal:\s*/, '')
    : automation.automation_name;
}

const pill = 'inline-flex items-center rounded-full font-medium transition-colors';

export function KindChip({
  kind,
  onPick,
}: {
  kind: AutomationKind;
  onPick: (kind: AutomationKind) => void;
}) {
  const { label, filter_label, Icon } = kind_words[kind];
  return (
    <button
      className={cn(
        pill,
        'relative z-10 h-[22px] shrink-0 gap-1 px-2 text-xs',
        kind === 'goal'
          ? 'bg-brand-wash text-brand-ink hover:bg-brand-wash/70'
          : 'bg-muted text-muted-foreground hover:text-foreground',
      )}
      onClick={() => onPick(kind)}
      title={`Show only ${filter_label.toLowerCase()}`}
      type="button"
    >
      <Icon aria-hidden="true" className="size-3" />
      {label}
    </button>
  );
}

export function KindFilters({
  counts,
  picked,
  onPick,
}: {
  counts: Record<AutomationKind, number>;
  picked: KindFilter;
  onPick: (kind: KindFilter) => void;
}) {
  const total = kind_order.reduce((sum, kind) => sum + counts[kind], 0);
  const options = [
    { kind: 'all' as const, filter_label: 'All', Icon: null },
    ...kind_order.map((kind) => ({ kind, ...kind_words[kind] })),
  ];
  return (
    <div className="flex flex-wrap gap-1">
      {options.map(({ kind, filter_label, Icon }) => (
        <button
          aria-pressed={picked === kind}
          className={cn(
            pill,
            'h-8 gap-1.5 border px-3 text-[13px]',
            picked === kind
              ? 'border-border bg-raised text-foreground shadow-raised'
              : 'border-transparent text-muted-foreground hover:text-foreground',
          )}
          key={kind}
          onClick={() => onPick(kind)}
          type="button"
        >
          {Icon ? <Icon aria-hidden="true" className="size-3.5" /> : null}
          {filter_label}
          <span className="opacity-60">{kind === 'all' ? total : counts[kind]}</span>
        </button>
      ))}
    </div>
  );
}

export const nothing_of_kind: Record<KindFilter, string> = {
  all: 'Nothing here yet.',
  trigger: 'No triggers yet. They start when something happens in an app.',
  scheduled: 'Nothing scheduled yet. Scheduled ones run on a clock.',
  goal: 'No goals yet. Ask in chat for something to work towards over time.',
};

export function count_kinds(all_kinds: AutomationKind[]): Record<AutomationKind, number> {
  const counts = { trigger: 0, scheduled: 0, goal: 0 };
  for (const kind of all_kinds) counts[kind] += 1;
  return counts;
}
