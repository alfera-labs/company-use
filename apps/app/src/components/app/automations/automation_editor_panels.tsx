import { Plus } from 'lucide-react';
import type { ReactNode } from 'react';
import { AddTriggerMenu } from '@/components/app/automations/add_trigger_menu';
import type { EditorValue } from '@/components/app/automations/automation_editor_model';
import type {
  AutomationTriggerInput,
  TriggerTypeCatalog,
} from '@/components/app/automations/automations_api';
import type { EditorPageActions } from '@/components/app/automations/connect_app_button';
import { TriggerRow } from '@/components/app/automations/trigger_row';
import { create_random_id } from '@/lib/random_id';

export function EditorSection({
  title,
  subtitle,
  action,
  children,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="mt-7 first:mt-0">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-sm font-medium">{title}</h2>
          {subtitle ? <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p> : null}
        </div>
        {action}
      </div>
      <div className="mt-2 divide-y rounded-3xl border bg-raised shadow-raised">{children}</div>
    </section>
  );
}

export function SectionAction({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      className="flex shrink-0 items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      type="button"
      onClick={onClick}
    >
      <Plus aria-hidden="true" className="size-3.5" />
      {label}
    </button>
  );
}

export function TriggersPanel({
  value,
  onChange,
  catalog,
  actions,
}: {
  value: EditorValue;
  onChange: (value: EditorValue) => void;
  catalog: TriggerTypeCatalog | undefined;
  actions?: EditorPageActions | undefined;
}) {
  return (
    <EditorSection
      title="Triggers"
      action={
        <AddTriggerMenu
          catalog={catalog}
          onAdd={(input) =>
            onChange({
              ...value,
              triggers: [...value.triggers, { key: create_random_id(), input }],
            })
          }
        />
      }
    >
      <TriggerRows value={value} onChange={onChange} catalog={catalog} actions={actions} />
    </EditorSection>
  );
}

function TriggerRows({
  value,
  onChange,
  catalog,
  actions,
}: {
  value: EditorValue;
  onChange: (value: EditorValue) => void;
  catalog: TriggerTypeCatalog | undefined;
  actions: EditorPageActions | undefined;
}) {
  const set_triggers = (triggers: EditorValue['triggers']) => onChange({ ...value, triggers });
  if (value.triggers.length === 0) {
    return (
      <p className="px-4 py-3 text-sm text-muted-foreground">Nothing starts this automation yet.</p>
    );
  }
  return value.triggers.map((trigger) => (
    <TriggerRow
      key={trigger.key}
      trigger={trigger}
      catalog={catalog}
      actions={actions}
      onEdit={(input: AutomationTriggerInput) =>
        set_triggers(
          value.triggers.map((other) => (other.key === trigger.key ? { ...other, input } : other)),
        )
      }
      onRemove={() => set_triggers(value.triggers.filter((other) => other.key !== trigger.key))}
    />
  ));
}
