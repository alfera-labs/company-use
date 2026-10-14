import { ChevronDown, type LucideIcon } from 'lucide-react';
import { createContext, useContext } from 'react';
import '@/components/app/chat_activity_breathe.css';
import { cn } from '@coworker/ui/lib/utils';

export const activity_row_class_name =
  'flex min-w-0 items-start gap-2 py-[3.5px] text-left text-[15px] leading-[1.55] text-foreground/80';

export const activity_row_hover_scope_class_name = 'group/activity-row';

export const activity_detail_class_name = 'text-muted-foreground';

const activity_chevron_class_name =
  'mt-[4px] size-[13px] shrink-0 text-muted-foreground transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]';

const activity_hover_chevron_class_name =
  'opacity-0 transition-opacity group-hover/activity-row:opacity-100';

export const activity_children_class_name = 'mt-3 ml-[25px] flex min-w-0 flex-col gap-[7px]';

export const activity_detail_card_class_name =
  'mt-2.5 mb-1 ml-[25px] grid min-w-0 gap-2 rounded-2xl bg-sunken px-3.5 py-2.5 font-mono text-[12.5px] leading-[1.7] text-foreground/80';

const activity_chevron_spacer = (
  <span aria-hidden="true" className="mt-[4px] size-[13px] shrink-0" />
);

const activity_rail_context = createContext(true);

export const ActivityRail = activity_rail_context.Provider;

export function ActivityChevron({
  alwaysVisible = false,
  expandable,
  open,
}: {
  alwaysVisible?: boolean;
  expandable: boolean;
  open: boolean;
}) {
  const on_rail = useContext(activity_rail_context);
  if (!expandable) return on_rail ? activity_chevron_spacer : null;

  return (
    <ChevronDown
      aria-hidden="true"
      className={cn(
        activity_chevron_class_name,
        open ? 'rotate-0' : '-rotate-90',
        alwaysVisible || open || !on_rail ? 'opacity-100' : activity_hover_chevron_class_name,
      )}
    />
  );
}

export type ActivityGlyphTone = 'default' | 'failed' | 'running';

const glyph_tone_class_names: Record<ActivityGlyphTone, string> = {
  default: 'text-muted-foreground',
  failed: 'text-destructive',
  running: 'text-brand-ink',
};

export function ActivityGlyph({
  breathing = false,
  icon: Icon,
  iconUrl,
  letter,
  tone = 'default',
}: {
  breathing?: boolean;
  icon?: LucideIcon;
  iconUrl?: string;
  letter?: string;
  tone?: ActivityGlyphTone;
}) {
  const frame = 'mt-[3px] size-[15px] shrink-0';
  const breathe_class_name = breathing ? 'chat-activity-breathe' : undefined;

  if (iconUrl) {
    return (
      <span
        aria-hidden="true"
        className={cn(frame, 'bg-contain bg-center bg-no-repeat', breathe_class_name)}
        style={{ backgroundImage: `url("${iconUrl}")` }}
      />
    );
  }

  if (Icon) {
    return (
      <Icon
        aria-hidden="true"
        className={cn(frame, 'stroke-[1.6]', glyph_tone_class_names[tone], breathe_class_name)}
      />
    );
  }

  if (letter) {
    return (
      <span
        aria-hidden="true"
        className={cn(
          frame,
          'text-center text-[11px] leading-[15px] font-medium',
          glyph_tone_class_names[tone],
          breathe_class_name,
        )}
      >
        {letter.slice(0, 1).toUpperCase()}
      </span>
    );
  }

  return null;
}

export function ActivityDetail({
  children,
  tone = 'default',
}: {
  children: React.ReactNode;
  tone?: 'default' | 'failed';
}) {
  return (
    <span
      className={cn('ml-1', tone === 'failed' ? 'text-destructive/85' : activity_detail_class_name)}
    >
      · {children}
    </span>
  );
}
