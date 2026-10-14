import { format_error_message } from '@coworker/shared';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@coworker/ui/components/alert-dialog';
import { Button } from '@coworker/ui/components/button';
import { Input } from '@coworker/ui/components/input';
import { Label } from '@coworker/ui/components/label';
import { Pencil, Plus, X } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import {
  append_chat_attachments,
  type ChatAttachmentUpdate,
} from '@/components/app/append_chat_attachments';
import { schedule_tool_words } from '@/components/app/automations/schedule_tool_words';
import { ScheduledTaskDialogBottom } from '@/components/app/scheduled_task_dialog_bottom';
import type {
  CreateScheduledTaskInput,
  ScheduledTaskFormInput,
  UpdateScheduledTaskInput,
} from '@/components/app/scheduled_task_dialog_input';
import {
  build_scheduled_task_config,
  empty_scheduled_task_value,
  type ScheduledTaskEditorValue,
  scheduled_task_value,
} from '@/components/app/scheduled_task_editor_model';
import { ScheduledTaskInstructions } from '@/components/app/scheduled_task_instructions';
import { ScheduledTaskWhenToRun } from '@/components/app/scheduled_task_when_to_run';
import { use_close_question } from '@/components/app/use_close_question';
import type { Trigger } from '@/lib/api';
import { resolve_timezone } from '@/lib/browser_timezone';
import { draft_to_cron, draft_to_run_once_at } from '@/lib/schedule_builder_model';
import { is_valid_cron } from '@/lib/scheduled_task_schedule';

export type {
  CreateScheduledTaskInput,
  UpdateScheduledTaskInput,
} from '@/components/app/scheduled_task_dialog_input';

export function ScheduledTaskCreateDialog({
  onCreate,
  isCreating,
}: {
  onCreate: (input: CreateScheduledTaskInput) => Promise<void>;
  isCreating: boolean;
}) {
  return (
    <ScheduledTaskDialog
      initialValue={empty_scheduled_task_value()}
      isSaving={isCreating}
      title="Create scheduled task"
      trigger={
        <Button className="h-9 rounded-2xl" data-tour="new-scheduled-task" type="button">
          <Plus className="size-4" aria-hidden="true" />
          New task
        </Button>
      }
      onSave={(input) => {
        const { agent_id, ...create_input } = input;
        return onCreate({ ...create_input, ...(agent_id ? { agent_id } : {}) });
      }}
    />
  );
}

export function ScheduledTaskEditDialog({
  task,
  onSave,
  isSaving,
}: {
  task: Trigger;
  onSave: (input: UpdateScheduledTaskInput) => Promise<unknown>;
  isSaving: boolean;
}) {
  return (
    <ScheduledTaskDialog
      initialValue={scheduled_task_value(task)}
      isSaving={isSaving}
      title={schedule_tool_words.edit_title}
      trigger={
        <Button className="h-8 rounded-2xl" size="sm" type="button" variant="outline">
          <Pencil className="size-3.5" aria-hidden="true" />
          Edit
        </Button>
      }
      onSave={(input) => onSave({ ...input, agent_id: input.agent_id ?? task.agent_id })}
    />
  );
}

function ScheduledTaskDialog({
  initialValue,
  isSaving,
  title,
  trigger,
  onSave,
}: {
  initialValue: ScheduledTaskEditorValue;
  isSaving: boolean;
  title: string;
  trigger: React.ReactElement;
  onSave: (input: ScheduledTaskFormInput) => Promise<unknown>;
}) {
  const [open, set_open] = useState(false);
  const [value, set_value] = useState(initialValue);
  const [value_when_opened, set_value_when_opened] = useState(initialValue);
  const [schedule_changed, set_schedule_changed] = useState(false);
  const [file_selection_pending, set_file_selection_pending] = useState(false);
  const [submit_error, set_submit_error] = useState<string | null>(null);
  const is_manual = value.frequency === 'manual';
  const schedule_expression = (value.advanced_cron ?? draft_to_cron(value.draft) ?? '').trim();
  const generated_run_once_at =
    value.frequency === 'run_once' ? draft_to_run_once_at(value.draft) : null;
  const run_once_at =
    value.frequency === 'run_once' && !schedule_changed
      ? (value.original_run_once_at ?? generated_run_once_at)
      : generated_run_once_at;
  const run_once_is_future = !run_once_at || new Date(run_once_at).getTime() > Date.now() + 60_000;
  const can_submit =
    value.name.trim().length > 0 &&
    value.instruction.trim().length > 0 &&
    (is_manual || is_valid_cron(schedule_expression)) &&
    run_once_is_future &&
    !file_selection_pending &&
    value.attachments.every(
      (attachment) => attachment.upload_status === 'ready' && attachment.part,
    );

  const closing = use_close_question({
    would_lose_what_was_typed: value !== value_when_opened,
    close: () => set_open(false),
  });

  const reset = () => {
    set_value(initialValue);
    set_value_when_opened(initialValue);
    set_schedule_changed(false);
    set_file_selection_pending(false);
    set_submit_error(null);
  };

  const submit = async () => {
    if (!can_submit || isSaving) return;
    set_submit_error(null);
    try {
      await onSave({
        trigger_name: value.name.trim(),
        trigger_type: is_manual ? 'manual' : 'schedule',
        schedule_expression: is_manual ? null : schedule_expression,
        agent_id: value.agent_id,
        trigger_config: build_scheduled_task_config({
          base_config: value.trigger_config,
          instruction: value.instruction,
          context_digest: value.context_digest,
          model_choice: value.model_choice,
          attachments: value.attachments,
          preserved_content: value.preserved_content,
          timezone: resolve_timezone(),
          run_once_at,
        }),
      });
      reset();
      set_open(false);
    } catch (error) {
      set_submit_error(format_error_message(error, 'Could not save the task'));
    }
  };

  const update_attachment = ({ id, changes }: ChatAttachmentUpdate) => {
    set_value((current) => ({
      ...current,
      attachments: current.attachments.map((attachment) =>
        attachment.id === id ? { ...attachment, ...changes } : attachment,
      ),
    }));
    if (changes.upload_status === 'failed')
      toast.error(changes.upload_error ?? 'A file could not be uploaded.');
  };

  const add_files = (files: File[]) => {
    const appended = append_chat_attachments(files, value.attachments, {
      on_attachment_changed: update_attachment,
    });
    for (const rejection of appended.rejections) toast.error(rejection);
    set_value((current) => ({
      ...current,
      attachments: [...current.attachments, ...appended.attachments].slice(0, 20),
    }));
  };

  const change_schedule = (patch: Partial<ScheduledTaskEditorValue>) => {
    set_schedule_changed(true);
    set_value((current) => ({ ...current, ...patch }));
  };

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next_open, change) => {
        if (isSaving) return;
        if (!next_open) {
          return change.reason === 'close-press' ? closing.close() : closing.close_or_ask_first();
        }
        reset();
        set_open(true);
      }}
    >
      <AlertDialogTrigger render={trigger} />
      <AlertDialogContent className="mt-[8vh] max-h-[calc(92vh-2rem)] max-w-2xl self-start overflow-y-auto p-4 sm:p-5">
        <AlertDialogHeader className="flex-row items-center justify-between">
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogCancel
            className="size-8 rounded-full border-0 p-0"
            type="button"
            aria-label="Close"
            disabled={isSaving}
          >
            <X className="size-4" aria-hidden="true" />
          </AlertDialogCancel>
        </AlertDialogHeader>
        <form
          className="mt-4 space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (!closing.is_asking) void submit();
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="scheduled-task-name">Name</Label>
            <Input
              id="scheduled-task-name"
              className="h-9 rounded-xl"
              placeholder="Daily briefing"
              value={value.name}
              autoFocus
              onChange={(event) => set_value({ ...value, name: event.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label>When to run</Label>
            <ScheduledTaskWhenToRun
              frequency={value.frequency}
              onFrequencyChange={(frequency) => change_schedule({ frequency })}
              draft={value.draft}
              onDraftChange={(draft) => change_schedule({ draft })}
              advancedCron={value.advanced_cron}
              onAdvancedCronChange={(advanced_cron) => change_schedule({ advanced_cron })}
            />
            {!run_once_is_future ? (
              <p className="text-xs text-destructive">Choose a time more than one minute ahead.</p>
            ) : null}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="scheduled-task-instruction">Instructions</Label>
            <ScheduledTaskInstructions
              instruction={value.instruction}
              onInstructionChange={(instruction) => set_value({ ...value, instruction })}
              agentId={value.agent_id}
              onAgentIdChange={(agent_id) => set_value({ ...value, agent_id })}
              modelChoice={value.model_choice}
              onModelChoiceChange={(model_choice) => set_value({ ...value, model_choice })}
              attachments={value.attachments}
              onFilesAdded={add_files}
              onFileSelectionPendingChange={set_file_selection_pending}
              onAttachmentRemove={(id) =>
                set_value((current) => ({
                  ...current,
                  attachments: current.attachments.filter((attachment) => attachment.id !== id),
                }))
              }
              {...(value.context_digest === null
                ? {}
                : {
                    contextDigest: value.context_digest,
                    onContextDigestChange: (context_digest: string) =>
                      set_value((current) => ({ ...current, context_digest })),
                  })}
            />
          </div>
          <ScheduledTaskDialogBottom
            closing={closing}
            shows_late_start_note={!is_manual}
            submit_error={submit_error}
            can_submit={can_submit}
            is_saving={isSaving}
          />
        </form>
      </AlertDialogContent>
    </AlertDialog>
  );
}
