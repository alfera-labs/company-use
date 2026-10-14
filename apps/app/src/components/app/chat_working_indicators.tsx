import { cn } from '@coworker/ui/lib/utils';
import { motion, useReducedMotion } from 'motion/react';
import { ChatStreamingIndicator } from '@/components/app/chat_streaming_indicator';

const infinite_loop = {
  repeat: Number.POSITIVE_INFINITY,
  repeatType: 'loop' as const,
  ease: 'easeInOut' as const,
};

const dots = [
  { id: 'a', delay: 0 },
  { id: 'b', delay: 0.16 },
  { id: 'c', delay: 0.32 },
];

function PulsingDots() {
  const reduce_motion = useReducedMotion();

  return (
    <div className="flex h-2 items-center gap-1" aria-hidden="true">
      {dots.map((dot) => (
        <motion.span
          key={dot.id}
          className="h-1 w-2 rounded-full bg-muted-foreground/45"
          animate={
            reduce_motion
              ? { opacity: 0.6 }
              : { opacity: [0.25, 0.9, 0.25], scaleX: [0.9, 1.25, 0.9] }
          }
          transition={
            reduce_motion ? { duration: 0 } : { ...infinite_loop, duration: 1.1, delay: dot.delay }
          }
        />
      ))}
    </div>
  );
}

function BreathingDot() {
  const reduce_motion = useReducedMotion();

  return (
    <span className="relative flex h-3 w-3 items-center justify-center" aria-hidden="true">
      {reduce_motion ? null : (
        <motion.span
          className="absolute inset-0 rounded-full bg-muted-foreground/25"
          animate={{ scale: [1, 2.6], opacity: [0.5, 0] }}
          transition={{ ...infinite_loop, ease: 'easeOut', duration: 1.9 }}
        />
      )}
      <motion.span
        className="h-2 w-2 rounded-full bg-muted-foreground"
        animate={
          reduce_motion ? { opacity: 0.7 } : { scale: [1, 1.25, 1], opacity: [0.55, 1, 0.55] }
        }
        transition={reduce_motion ? { duration: 0 } : { ...infinite_loop, duration: 1.9 }}
      />
    </span>
  );
}

function TypingCaret() {
  const reduce_motion = useReducedMotion();

  return (
    <span className="flex h-5 items-center" aria-hidden="true">
      <motion.span
        className="h-4 w-[3px] rounded-full bg-foreground/80"
        animate={
          reduce_motion ? { opacity: 0.7 } : { opacity: [0.2, 1, 0.2], scaleY: [0.8, 1, 0.8] }
        }
        transition={reduce_motion ? { duration: 0 } : { ...infinite_loop, duration: 1.05 }}
      />
    </span>
  );
}

const bars = [
  { id: 'a', delay: 0 },
  { id: 'b', delay: 0.12 },
  { id: 'c', delay: 0.24 },
  { id: 'd', delay: 0.12 },
  { id: 'e', delay: 0.3 },
];

function WaveBars() {
  const reduce_motion = useReducedMotion();

  return (
    <div className="flex h-4 items-center gap-[3px]" aria-hidden="true">
      {bars.map((bar) => (
        <motion.span
          key={bar.id}
          className="h-full w-[3px] origin-bottom rounded-full bg-muted-foreground"
          animate={reduce_motion ? { scaleY: 0.4 } : { scaleY: [0.35, 1, 0.35] }}
          transition={
            reduce_motion ? { duration: 0 } : { ...infinite_loop, duration: 0.9, delay: bar.delay }
          }
        />
      ))}
    </div>
  );
}

function SweepLine() {
  const reduce_motion = useReducedMotion();

  return (
    <div className="relative h-1 w-24 overflow-hidden rounded-full bg-muted" aria-hidden="true">
      <motion.span
        className="absolute inset-y-0 w-1/2 rounded-full bg-muted-foreground/70"
        animate={reduce_motion ? { x: '25%' } : { x: ['-70%', '170%'] }}
        transition={reduce_motion ? { duration: 0 } : { ...infinite_loop, duration: 1.3 }}
      />
    </div>
  );
}

function OrbitRing() {
  const reduce_motion = useReducedMotion();

  return (
    <span className="relative flex size-4 items-center justify-center" aria-hidden="true">
      <span className="absolute inset-0 rounded-full border-2 border-muted-foreground/20" />
      <motion.span
        className="absolute inset-0 rounded-full border-2 border-transparent border-t-muted-foreground"
        animate={reduce_motion ? { rotate: 0 } : { rotate: 360 }}
        transition={
          reduce_motion
            ? { duration: 0 }
            : { repeat: Number.POSITIVE_INFINITY, ease: 'linear', duration: 1.1 }
        }
      />
    </span>
  );
}

function ElapsedClock({ seconds = 8 }: { seconds?: number }) {
  return (
    <span className="flex items-center gap-1.5 text-[13px] leading-5 text-muted-foreground">
      <motion.span
        className="size-1.5 rounded-full bg-primary"
        animate={{ opacity: [1, 0.3, 1] }}
        transition={{ ...infinite_loop, duration: 1 }}
      />
      <span className="tabular-nums">
        Working · {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}
      </span>
    </span>
  );
}

function StepTrail({ done = 2, total = 5 }: { done?: number; total?: number }) {
  const reduce_motion = useReducedMotion();

  return (
    <span className="flex items-center gap-1" aria-hidden="true">
      {Array.from({ length: total }, (_, index) => index).map((index) => (
        <motion.span
          key={index}
          className={cn(
            'h-1 w-4 rounded-full',
            index < done ? 'bg-muted-foreground' : 'bg-muted-foreground/20',
          )}
          animate={index === done && !reduce_motion ? { opacity: [0.25, 1, 0.25] } : { opacity: 1 }}
          transition={
            index === done && !reduce_motion ? { ...infinite_loop, duration: 1.2 } : { duration: 0 }
          }
        />
      ))}
    </span>
  );
}

function LiveCaretTrail() {
  const reduce_motion = useReducedMotion();

  return (
    <span className="flex items-center gap-1.5" aria-hidden="true">
      <span className="h-2 w-10 rounded-full bg-muted-foreground/20" />
      <span className="h-2 w-6 rounded-full bg-muted-foreground/20" />
      <motion.span
        className="h-3.5 w-[3px] rounded-full bg-foreground"
        animate={reduce_motion ? { opacity: 0.7 } : { opacity: [1, 0.15, 1] }}
        transition={reduce_motion ? { duration: 0 } : { ...infinite_loop, duration: 0.9 }}
      />
    </span>
  );
}

function BreathingSurface() {
  const reduce_motion = useReducedMotion();

  return (
    <motion.span
      className="block h-6 w-48 rounded-3xl border border-muted-foreground/25 bg-sunken"
      aria-hidden="true"
      animate={reduce_motion ? { opacity: 0.7 } : { opacity: [0.45, 0.95, 0.45] }}
      transition={reduce_motion ? { duration: 0 } : { ...infinite_loop, duration: 2.2 }}
    />
  );
}

export type ChatWorkingIndicator = {
  id: string;
  name: string;
  communicates: string;
  note?: string;
  render: () => React.ReactNode;
};

export const chat_working_indicators: ChatWorkingIndicator[] = [
  {
    id: 'pulsing-dots',
    name: 'Pulsing dots',
    communicates: 'Neutral "thinking" — quiet and familiar.',
    note: 'Current',
    render: () => <PulsingDots />,
  },
  {
    id: 'shimmer-label',
    name: 'Shimmer label',
    communicates: 'A coworker narrating status in words, not just a spinner.',
    note: 'Chosen',
    render: () => <ChatStreamingIndicator />,
  },
  {
    id: 'breathing-dot',
    name: 'Breathing dot',
    communicates: 'A calm heartbeat — present and alive, never anxious.',
    render: () => <BreathingDot />,
  },
  {
    id: 'typing-caret',
    name: 'Editor caret',
    communicates: 'About to type the next line — implies text is coming.',
    render: () => <TypingCaret />,
  },
  {
    id: 'wave-bars',
    name: 'Wave bars',
    communicates: 'Busy, energetic work happening right now.',
    render: () => <WaveBars />,
  },
  {
    id: 'sweep-line',
    name: 'Sweep line',
    communicates: 'Steady processing on an indeterminate track.',
    render: () => <SweepLine />,
  },
  {
    id: 'orbit-ring',
    name: 'Orbit ring',
    communicates: 'A machine that is spinning. Never claims a percentage it does not have.',
    note: 'Round 2',
    render: () => <OrbitRing />,
  },
  {
    id: 'elapsed-clock',
    name: 'Elapsed clock',
    communicates: 'Proof of life, not decoration: a number that ticks cannot be a frozen tab.',
    note: 'Round 2 · recommended',
    render: () => <ElapsedClock />,
  },
  {
    id: 'step-trail',
    name: 'Step trail',
    communicates: 'Alive, plus how far along. The only one carrying structure.',
    note: 'Round 2',
    render: () => <StepTrail />,
  },
  {
    id: 'live-caret-trail',
    name: 'Live caret',
    communicates: 'The streaming cursor simply never stops, so there is no dead gap.',
    note: 'Round 2',
    render: () => <LiveCaretTrail />,
  },
  {
    id: 'breathing-surface',
    name: 'Breathing surface',
    communicates: 'The reply area itself is alive — no small glyph to miss.',
    note: 'Round 2',
    render: () => <BreathingSurface />,
  },
];
