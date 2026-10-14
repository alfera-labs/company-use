import { public_brand_config } from '@coworker/config/public_env';
import { Textarea } from '@coworker/ui/components/textarea';
import type { EditorValue } from '@/components/app/automations/automation_editor_model';
import {
  EditorSection,
  TriggersPanel,
} from '@/components/app/automations/automation_editor_panels';
import type {
  NotificationRules,
  TriggerTypeCatalog,
} from '@/components/app/automations/automations_api';
import { ConditionsPanel } from '@/components/app/automations/conditions_panel';
import type { EditorPageActions } from '@/components/app/automations/connect_app_button';
import { LimitsPanel } from '@/components/app/automations/limits_panel';
import { NotificationsSection } from '@/components/app/automations/notifications_section';

const product_brand_name = public_brand_config.product_brand_name;

export function AutomationEditor({
  value,
  onChange,
  triggerTypes,
  policy,
  automationId,
  actions,
}: {
  value: EditorValue;
  onChange: (value: EditorValue) => void;
  triggerTypes: TriggerTypeCatalog | undefined;
  policy: NotificationRules | undefined;
  automationId?: string;
  actions?: EditorPageActions | undefined;
}) {
  return (
    <>
      <TriggersPanel value={value} onChange={onChange} catalog={triggerTypes} actions={actions} />
      <ConditionsPanel value={value} onChange={onChange} catalog={triggerTypes} />

      <EditorSection title="Instructions">
        <Textarea
          aria-label="Instructions"
          className="min-h-32 resize-y rounded-3xl border-0 bg-transparent px-4 py-3.5 shadow-none focus-visible:ring-0"
          placeholder={`What should ${product_brand_name} do each time?`}
          value={value.instruction}
          onChange={(event) => onChange({ ...value, instruction: event.target.value })}
        />
      </EditorSection>

      <LimitsPanel value={value} onChange={onChange} />

      <NotificationsSection
        policy={policy}
        automationId={automationId ?? ''}
        automationName={value.name}
      />
    </>
  );
}
