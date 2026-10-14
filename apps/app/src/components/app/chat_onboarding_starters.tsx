import { cn } from '@coworker/ui/lib/utils';
import { motion } from 'motion/react';
import type { Session } from '@/lib/api';

type OnboardingScanFinding = { name?: string; title: string; body: string; prompt: string };

type OnboardingScanCarrier = {
  onboarding_scan?: { findings?: OnboardingScanFinding[] };
};

export function read_session_onboarding_findings(session: Session | undefined) {
  const metadata = session?.source_metadata as OnboardingScanCarrier | undefined;
  return metadata?.onboarding_scan?.findings ?? [];
}

export function session_is_onboarding_seeded(session: Session | undefined) {
  const metadata = session?.source_metadata as OnboardingScanCarrier | undefined;
  return Boolean(metadata?.onboarding_scan);
}

export function ChatOnboardingStarters({
  findings,
  isRevealing,
  onSelect,
}: {
  findings: OnboardingScanFinding[];
  isRevealing?: boolean;
  onSelect: (prompt: string) => void;
}) {
  if (findings.length === 0) return null;

  return (
    <div className="flex w-full flex-col gap-2.5 sm:flex-row">
      {findings.map((finding, index) => (
        <motion.button
          animate={{ opacity: 1, y: 0 }}
          className={starter_card_class_name}
          initial={isRevealing ? { opacity: 0, y: 6 } : false}
          key={finding.title}
          transition={
            isRevealing
              ? { delay: index * card_stagger_seconds, ...starter_reveal_transition }
              : { duration: 0 }
          }
          type="button"
          onClick={() => onSelect(finding.prompt)}
        >
          <span className="font-semibold text-[14.5px] text-foreground leading-snug">
            {finding.name?.trim() || finding.title}
          </span>
          <span className="pb-2.5 text-pretty text-[13px] text-muted-foreground leading-relaxed">
            {finding.body}
          </span>
          <span aria-hidden="true" className={run_it_class_name}>
            Run it →
          </span>
        </motion.button>
      ))}
    </div>
  );
}

const starter_card_class_name = cn(
  'group flex h-auto min-w-0 flex-col gap-1.5 rounded-[22px] bg-raised px-[18px] pt-4 pb-3 text-left shadow-raised ring-1 ring-border/60 sm:flex-1',
  'transition-[background-color,box-shadow] duration-150 ease-out hover:bg-hover',
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30',
);

const run_it_class_name = cn(
  'mt-auto flex items-center justify-center rounded-[14px] py-1.5 ring-1 ring-border/60',
  'font-medium text-[13px] text-foreground/80',
  'transition-colors duration-150 ease-out group-hover:text-foreground group-hover:ring-border',
);

const starter_reveal_transition = { duration: 0.28, ease: [0.22, 1, 0.36, 1] as const };
const card_stagger_seconds = 0.15;
