import { format_error_message } from '@coworker/shared';
import { Button } from '@coworker/ui/components/button';
import { MousePointer2, Square } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

export type BrowserTask = {
  run_id: string;
  is_active: boolean;
  stop: () => Promise<boolean>;
};

export function BrowserTaskControls({
  task,
  focus_browser,
  has_control,
  on_control_granted,
  on_control_released,
  can_interact = true,
}: {
  task?: BrowserTask | undefined;
  can_interact?: boolean;
  focus_browser: () => void;
  has_control: boolean;
  on_control_granted: () => void;
  on_control_released: () => void;
}) {
  const mounted = useRef(true);
  const pending = useRef(false);
  const [action, set_action] = useState<'control' | 'stop' | null>(null);
  const [result, set_result] = useState<'stop' | null>(null);
  const [error, set_error] = useState('');
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  async function stop_task(next: 'control' | 'stop') {
    if (pending.current) return;
    pending.current = true;
    set_action(next);
    set_error('');
    try {
      const stopped = !task?.is_active || (await task.stop());
      if (!mounted.current) return;
      if (!stopped) {
        set_error('The task did not stop. Try again.');
        return;
      }
      if (next === 'control') {
        on_control_granted();
        focus_browser();
      } else set_result('stop');
    } catch (failure) {
      if (mounted.current)
        set_error(format_error_message(failure, 'The task did not stop. Try again.'));
    } finally {
      pending.current = false;
      if (mounted.current) set_action(null);
    }
  }

  return (
    <div className="shrink-0 space-y-2 border-t border-border bg-background p-3">
      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button
          data-browser-control
          className="h-9 min-w-40 flex-1"
          disabled={action !== null || !can_interact}
          onClick={() => (has_control ? on_control_released() : void stop_task('control'))}
        >
          <MousePointer2 />
          {action === 'control'
            ? 'Stopping task…'
            : has_control
              ? 'Give back control'
              : 'Take control'}
        </Button>
        {task?.is_active || action || result === 'stop' ? (
          <Button
            variant="outline"
            className="h-9 min-w-28 flex-1"
            disabled={action !== null || !task?.is_active}
            onClick={() => void stop_task('stop')}
          >
            <Square className="size-3 fill-current" />
            {action === 'stop'
              ? 'Stopping task…'
              : !task?.is_active && result === 'stop'
                ? 'Task stopped'
                : 'Stop task'}
          </Button>
        ) : null}
      </div>
      <p role="status" className="text-center text-[11px] text-muted-foreground">
        {!can_interact
          ? 'Recorded browser preview'
          : task?.is_active
            ? 'Taking control stops the current task.'
            : has_control
              ? task
                ? 'Press Escape or give back control to return to view-only. The task remains stopped.'
                : 'Press Escape or give back control to return to view-only.'
              : 'The browser stays open for you.'}
      </p>
    </div>
  );
}
