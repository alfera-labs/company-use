import { cn } from '@coworker/ui/lib/utils';
import { StickToBottom } from 'use-stick-to-bottom';

type ChatContainerRootProps = React.HTMLAttributes<HTMLDivElement>;
type ChatContainerContentProps = React.HTMLAttributes<HTMLDivElement>;
type ChatContainerScrollAnchorProps = React.HTMLAttributes<HTMLDivElement>;

function ChatContainerRoot({ children, className, ...props }: ChatContainerRootProps) {
  return (
    <StickToBottom
      className={cn('flex overflow-y-auto', className)}
      initial="instant"
      resize="smooth"
      role="log"
      {...props}
    >
      {children}
    </StickToBottom>
  );
}

function ChatContainerContent({ children, className, ...props }: ChatContainerContentProps) {
  return (
    <StickToBottom.Content className={cn('flex w-full flex-col', className)} {...props}>
      {children}
    </StickToBottom.Content>
  );
}

function ChatContainerScrollAnchor({ className, ...props }: ChatContainerScrollAnchorProps) {
  return (
    <div
      aria-hidden="true"
      className={cn('h-px w-full shrink-0 scroll-mt-4', className)}
      {...props}
    />
  );
}

export { ChatContainerContent, ChatContainerRoot, ChatContainerScrollAnchor };
