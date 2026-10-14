import { Avatar, AvatarFallback, AvatarImage } from '@coworker/ui/components/avatar';
import { Tooltip, TooltipContent, TooltipTrigger } from '@coworker/ui/components/tooltip';
import { cn } from '@coworker/ui/lib/utils';
import type { Components } from 'streamdown';
import { Markdown } from '@/components/prompt-kit/markdown';

function Message({ className, ...props }: React.HTMLProps<HTMLDivElement>) {
  return <div className={cn('flex gap-3', className)} {...props} />;
}

function MessageAvatar({
  alt,
  className,
  fallback,
  src,
}: {
  alt: string;
  className?: string;
  fallback?: string;
  src: string;
}) {
  return (
    <Avatar className={cn('h-8 w-8 shrink-0', className)}>
      <AvatarImage alt={alt} src={src} />
      {fallback ? <AvatarFallback>{fallback}</AvatarFallback> : null}
    </Avatar>
  );
}

function MessageContent({
  children,
  className,
  components,
  markdown = false,
  streaming = false,
  streamdownClassName,
}: {
  children: React.ReactNode;
  className?: string;
  components?: Partial<Components>;
  markdown?: boolean;
  streaming?: boolean;
  streamdownClassName?: string;
}) {
  const class_names = cn(
    'flex min-w-0 max-w-full flex-col gap-2 overflow-hidden text-sm text-foreground',
    className,
  );

  if (markdown) {
    return (
      <div className={class_names}>
        <Markdown
          {...(streamdownClassName ? { className: streamdownClassName } : {})}
          {...(components ? { components } : {})}
          isStreaming={streaming}
        >
          {String(children ?? '')}
        </Markdown>
      </div>
    );
  }

  return <div className={class_names}>{children}</div>;
}

function MessageActions({ className, ...props }: React.HTMLProps<HTMLDivElement>) {
  return (
    <div className={cn('text-muted-foreground flex items-center gap-2', className)} {...props} />
  );
}

function MessageAction({
  children,
  side = 'top',
  tooltip,
}: {
  children: React.ReactElement;
  side?: 'top' | 'bottom' | 'left' | 'right';
  tooltip: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger render={children} />
      <TooltipContent side={side}>{tooltip}</TooltipContent>
    </Tooltip>
  );
}

export { Message, MessageAction, MessageActions, MessageAvatar, MessageContent };
