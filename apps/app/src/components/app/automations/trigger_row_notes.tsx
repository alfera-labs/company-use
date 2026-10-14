import { useState } from 'react';
import type { EditorTrigger } from '@/components/app/automations/automation_editor_model';
import type { EditorPageActions } from '@/components/app/automations/connect_app_button';
import { read_trigger_problem } from '@/components/app/automations/trigger_problems';

export const how_to_start_when_you_ask = 'Press Test on this page, or ask in chat.';

export function TriggerRowNotes({
  trigger,
  app,
  actions,
  form_open,
}: {
  trigger: EditorTrigger;
  app: { app_display_name: string; connected: boolean } | null;
  actions: EditorPageActions | undefined;
  form_open: boolean;
}) {
  if (app && !app.connected) {
    return (
      <span className="block text-sm text-caution-ink">
        Connect {app.app_display_name} to start
      </span>
    );
  }
  if (form_open) return null;
  if (trigger.input.kind === 'manual') {
    return <span className="block text-sm text-muted-foreground">{how_to_start_when_you_ask}</span>;
  }
  return <TriggerProblem trigger={trigger} onRetry={actions?.retry_trigger_setup} />;
}

export function TriggerProblem({
  trigger,
  onRetry,
}: {
  trigger: EditorTrigger;
  onRetry: (() => Promise<unknown>) | undefined;
}) {
  const [retrying, set_retrying] = useState(false);
  if (trigger.row?.trigger_status !== 'error') return null;
  return (
    <span className="block text-sm text-caution-ink">
      {read_trigger_problem(trigger.row)
        ? `Not running: ${read_trigger_problem(trigger.row)}`
        : 'Not running.'}
      {onRetry ? (
        <button
          className="ms-2 font-medium underline-offset-4 hover:underline disabled:opacity-50"
          disabled={retrying}
          type="button"
          onClick={() => {
            set_retrying(true);
            void onRetry()
              .catch((error: unknown) => console.debug('trigger setup retry failed', error))
              .finally(() => set_retrying(false));
          }}
        >
          Try again
        </button>
      ) : null}
    </span>
  );
}
