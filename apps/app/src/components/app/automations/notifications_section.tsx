import { Button } from '@coworker/ui/components/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@coworker/ui/components/dialog';
import { useQueryClient } from '@tanstack/react-query';
import { AttentionSettings } from '@/components/app/automations/attention_settings';
import { EditorSection } from '@/components/app/automations/automation_editor_panels';
import { describe_tell_you } from '@/components/app/automations/automation_sentences';
import type { NotificationRules } from '@/components/app/automations/automations_api';
import { query_keys } from '@/lib/api/query_keys';

export function NotificationsSection({
  policy,
  automationId,
  automationName,
}: {
  policy: NotificationRules | undefined;
  automationId: string;
  automationName: string;
}) {
  const query_client = useQueryClient();
  return (
    <EditorSection title="Notifications">
      <div className="flex items-center gap-4 px-4 py-3">
        <p className="min-w-0 flex-1 text-sm">
          {policy
            ? describe_tell_you(policy, {
                automation_id: automationId,
                automation_name: automationName,
              }).join(' ')
            : 'Reading how you want to be told.'}
        </p>
        <Dialog
          onOpenChange={(open) => {
            if (!open)
              void query_client.invalidateQueries({ queryKey: query_keys.notification_rules() });
          }}
        >
          <DialogTrigger render={<Button size="sm" type="button" variant="ghost" />}>
            Change
          </DialogTrigger>
          <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
            <DialogHeader className="mb-5">
              <DialogTitle>Notifications</DialogTitle>
              <DialogDescription>One setting for every automation.</DialogDescription>
            </DialogHeader>
            <AttentionSettings />
          </DialogContent>
        </Dialog>
      </div>
    </EditorSection>
  );
}
