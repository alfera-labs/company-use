import { Shimmer } from '@/components/ai-elements/shimmer';

export function ChatStreamingIndicator({ label = 'Working…' }: { label?: string }) {
  return (
    <Shimmer as="span" className="text-[15px] font-medium tracking-tight" duration={1.6} spread={3}>
      {label}
    </Shimmer>
  );
}
