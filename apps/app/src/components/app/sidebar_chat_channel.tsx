import { cn } from '@coworker/ui/lib/utils';
import { Clock3, Code2, Cpu, Globe, Mail, MessageCircle } from 'lucide-react';
import type { ComponentType } from 'react';
import { SlackGlyph } from '@/components/onboarding/slack/glyph';

const channels: Record<string, { label: string; icon: ComponentType<{ className?: string }> }> = {
  dashboard: { label: 'Web', icon: WebChatIcon },
  web: { label: 'Web', icon: WebChatIcon },
  slack: { label: 'Slack', icon: SlackGlyph },
  email: { label: 'Email', icon: Mail },
  scheduled_task: { label: 'Scheduled', icon: Clock3 },
  schedule: { label: 'Scheduled', icon: Clock3 },
  scheduler: { label: 'Scheduled', icon: Clock3 },
  trigger: { label: 'Trigger', icon: Clock3 },
  api: { label: 'API', icon: Code2 },
  system: { label: 'System', icon: Cpu },
};

export function read_sidebar_channel(source: string) {
  return channels[source] ?? { label: 'Other channel', icon: Globe };
}

function WebChatIcon({ className }: { className?: string }) {
  return (
    <MessageCircle
      aria-hidden="true"
      className={cn('text-muted-foreground', className)}
      strokeWidth={1.5}
    />
  );
}
