// biome-ignore-all lint/correctness/useHookAtTopLevel: Repository hook names use snake_case.
import { useState } from 'react';
import type { EditorTrigger } from '@/components/app/automations/automation_editor_model';
import type { SetupField } from '@/components/app/automations/trigger_setup_fields';
import type { FocusRequest } from '@/components/app/automations/trigger_setup_panel';

export function use_setup_form_state(
  trigger: EditorTrigger,
  fields: SetupField[],
  has_problems: boolean,
) {
  const [chosen_open, set_chosen_open] = useState<boolean | null>(null);
  const [focus, set_focus] = useState<FocusRequest | null>(null);
  const opens_by_itself = !trigger.row || trigger.row.trigger_status === 'error';
  const open = fields.length > 0 && (has_problems || (chosen_open ?? opens_by_itself));
  return {
    open,
    focus,
    open_at: (name: string) => {
      set_chosen_open(true);
      set_focus({ name });
    },
    close: () => set_chosen_open(false),
  };
}
