import { Button } from '@coworker/ui/components/button';
import { cn } from '@coworker/ui/lib/utils';
import { ChevronDown } from 'lucide-react';
import { memo } from 'react';
import { useStickToBottomContext } from 'use-stick-to-bottom';

const ScrollButton = memo(function ScrollButton({ className }: { className?: string }) {
  const { isAtBottom, scrollToBottom } = useStickToBottomContext();

  return (
    <Button
      className={cn(
        'h-10 w-10 rounded-full transition-all duration-150 ease-out',
        isAtBottom
          ? 'pointer-events-none translate-y-4 scale-95 opacity-0'
          : 'translate-y-0 scale-100 opacity-100',
        className,
      )}
      size="icon"
      type="button"
      variant="outline"
      onClick={() => scrollToBottom()}
    >
      <ChevronDown className="size-5" />
    </Button>
  );
});

export { ScrollButton };
