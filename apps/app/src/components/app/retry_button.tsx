import { Button } from '@coworker/ui/components/button';
import { RefreshCw } from 'lucide-react';

export function RetryButton({ label, onRetry }: { label: string; onRetry: () => void }) {
  return (
    <Button aria-label={label} size="sm" type="button" variant="ghost" onClick={onRetry}>
      <RefreshCw className="size-4" />
      Unavailable
    </Button>
  );
}
