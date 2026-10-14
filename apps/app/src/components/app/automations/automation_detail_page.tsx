// biome-ignore-all lint/correctness/useHookAtTopLevel: Repository hook names use snake_case.
import { format_error_message } from '@coworker/shared';
import { Button } from '@coworker/ui/components/button';
import { Input } from '@coworker/ui/components/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@coworker/ui/components/tabs';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Play } from 'lucide-react';
import { toast } from 'sonner';
import { AutomationEditor } from '@/components/app/automations/automation_editor';
import type { EditorValue } from '@/components/app/automations/automation_editor_model';
import { AutomationHistory } from '@/components/app/automations/automation_history';
import { use_automation_live_switch } from '@/components/app/automations/automation_live_switch';
import { AutomationStatusLine } from '@/components/app/automations/automation_status_line';
import { AutomationTopBar } from '@/components/app/automations/automation_top_bar';
import {
  type AutomationWithTriggers,
  list_trigger_types,
  type NotificationRules,
  read_notification_rules,
  run_automation_now,
  type TriggerTypeCatalog,
} from '@/components/app/automations/automations_api';
import type { EditorPageActions } from '@/components/app/automations/connect_app_button';
import { DeleteAutomationMenu } from '@/components/app/automations/delete_automation_menu';
import { use_automation_draft } from '@/components/app/automations/use_automation_draft';
import { WatchingNote } from '@/components/app/automations/watching_note';
import { query_keys } from '@/lib/api/query_keys';

export function AutomationDetailPage({ automationId }: { automationId: string }) {
  const policy_query = useQuery({
    queryKey: query_keys.notification_rules(),
    queryFn: read_notification_rules,
  });
  const trigger_types_query = useQuery({
    queryKey: query_keys.automation_trigger_types(),
    queryFn: list_trigger_types,
  });
  const catalog = trigger_types_query.data;
  const draft = use_automation_draft(automationId, catalog);
  const set_status = use_automation_live_switch();
  const automation = draft.loaded?.automation;
  const value = draft.value;

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col pb-16">
      <DetailTopBar automationId={automationId} draft={draft} catalog={catalog} />
      {draft.automation_query.isError ? (
        <p className="mt-6 text-sm">This automation could not be loaded.</p>
      ) : null}
      {automation && value ? (
        <>
          <Input
            aria-label="Automation name"
            // md:text-2xl too: the Input's own md:text-sm otherwise wins on every desktop screen.
            className="h-auto border-0 bg-transparent p-0 font-semibold text-2xl shadow-none focus-visible:ring-0 md:text-2xl"
            value={value.name}
            onChange={(event) => draft.set_draft({ ...value, name: event.target.value })}
          />
          <AutomationStatusLine
            automation={automation}
            busy={set_status.isPending}
            onTurn={(live) => set_status.mutate({ automation_id: automationId, live })}
          />
          <DetailTabs
            automation={automation}
            value={value}
            onChange={draft.set_draft}
            catalog={catalog}
            policy={policy_query.data?.policy}
            actions={{ retry_trigger_setup: () => draft.retry_trigger_setup.mutateAsync() }}
          />
        </>
      ) : null}
      {draft.new_secret_dialog}
    </main>
  );
}

type AutomationDraft = ReturnType<typeof use_automation_draft>;

function DetailTopBar({
  automationId,
  draft,
  catalog,
}: {
  automationId: string;
  draft: AutomationDraft;
  catalog: TriggerTypeCatalog | undefined;
}) {
  const run_now = use_run_now(automationId);
  const automation = draft.loaded?.automation;
  const value = draft.value;
  return (
    <AutomationTopBar name={automation?.automation_name ?? 'Automation'}>
      <Button
        disabled={!draft.savable || draft.save.isPending}
        size="sm"
        type="button"
        variant="ghost"
        onClick={() => value && draft.save.mutate(value)}
      >
        Save
      </Button>
      <Button
        disabled={run_now.isPending || automation?.automation_status !== 'enabled'}
        size="sm"
        type="button"
        variant="outline"
        onClick={() => run_now.mutate()}
      >
        <Play aria-hidden="true" className="size-3" />
        Test
      </Button>
      <DeleteAutomationMenu
        automationId={automationId}
        automationName={automation?.automation_name ?? 'this automation'}
        triggers={draft.loaded?.triggers ?? []}
        catalog={catalog}
      />
    </AutomationTopBar>
  );
}

function complain(fallback: string) {
  return (error: unknown) => toast.error(format_error_message(error, fallback));
}

function use_run_now(automation_id: string) {
  const query_client = useQueryClient();
  return useMutation({
    mutationFn: () => run_automation_now(automation_id),
    onSuccess: async () => {
      toast.success('Started');
      await query_client.invalidateQueries({
        queryKey: query_keys.automation_fires(automation_id),
      });
    },
    onError: complain('Could not start the automation'),
  });
}

function DetailTabs({
  automation,
  value,
  onChange,
  catalog,
  policy,
  actions,
}: {
  automation: AutomationWithTriggers['automation'];
  value: EditorValue;
  onChange: (value: EditorValue) => void;
  catalog: TriggerTypeCatalog | undefined;
  policy: NotificationRules | undefined;
  actions: EditorPageActions;
}) {
  const automation_id = automation.automation_id;
  return (
    <Tabs className="mt-5 gap-5" defaultValue="settings">
      <TabsList variant="line">
        <TabsTrigger value="settings">Settings</TabsTrigger>
        <TabsTrigger value="history">Run history</TabsTrigger>
      </TabsList>
      <TabsContent value="settings">
        <AutomationEditor
          automationId={automation_id}
          value={value}
          onChange={onChange}
          triggerTypes={catalog}
          policy={policy}
          actions={actions}
        />
      </TabsContent>
      <TabsContent value="history">
        <WatchingNote
          automationId={automation_id}
          automationName={automation.automation_name}
          summaryTime={policy?.daily_summary_at_time}
        />
        <AutomationHistory
          automationId={automation_id}
          summaryTime={policy?.daily_summary_at_time}
        />
      </TabsContent>
    </Tabs>
  );
}
