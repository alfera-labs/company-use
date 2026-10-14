import { Textarea } from '@coworker/ui/components/textarea';
import { useInstallHasAppCatalogue } from '@/lib/use_install_has_app_catalogue';

/** The example a new task shows. An install where no app can be connected gets one it can do. */
export function scheduled_task_instruction_example(install: {
  install_has_app_catalogue: boolean | undefined;
}): string {
  return install.install_has_app_catalogue === false
    ? 'List what is new in files/ since yesterday and save a short summary as files/daily-summary.md.'
    : "Review today's meetings and summarize unread emails. Highlight urgent items and follow-ups.";
}

export function ScheduledTaskInstructionField({
  value,
  on_change,
}: {
  value: string;
  on_change: (value: string) => void;
}) {
  const install_has_app_catalogue = useInstallHasAppCatalogue();
  return (
    <Textarea
      id="scheduled-task-instruction"
      className="min-h-28 resize-none rounded-none border-0 px-3 py-4 shadow-none focus-visible:ring-0"
      placeholder={scheduled_task_instruction_example({ install_has_app_catalogue })}
      value={value}
      onChange={(event) => on_change(event.target.value)}
    />
  );
}
