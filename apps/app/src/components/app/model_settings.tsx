import { format_error_message } from '@coworker/shared';
import { Button } from '@coworker/ui/components/button';
import { SettingsCard, SettingsRow } from '@coworker/ui/components/settings-card';
import { Skeleton } from '@coworker/ui/components/skeleton';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { AiAccountSettings } from '@/components/app/ai_account_settings';
import { InstallAiKeySettings } from '@/components/app/install_ai_key_settings';
import { describe_auto_model } from '@/components/app/model_picker/auto_model_note';
import {
  type ModelChoice,
  selected_model_choice,
  written_default_model,
} from '@/components/app/model_picker/model_choice';
import { ModelPicker } from '@/components/app/model_picker/model_picker';
import { useModelOptions } from '@/components/app/model_picker/use_model_options';
import { useMainAgent } from '@/components/app/use_main_agent';
import { use_team_viewer_role } from '@/components/app/use_team_mode';
import { type Agent, type ModelCatalogEntry, update_agent_default_model } from '@/lib/api';
import { query_keys } from '@/lib/api/query_keys';

function useDefaultModelChange(agent: Agent | null) {
  const query_client = useQueryClient();
  return useMutation({
    mutationFn: (choice: ModelChoice) =>
      update_agent_default_model(agent?.agent_id ?? '', written_default_model(choice)),
    onSuccess: (updated_agent) => {
      query_client.setQueryData<Agent[]>(query_keys.agents(), (agents) =>
        agents?.map((candidate) =>
          candidate.agent_id === updated_agent.agent_id ? updated_agent : candidate,
        ),
      );
      toast.success('Model updated');
    },
    onError: (error) => toast.error(format_error_message(error, 'Could not update the model')),
  });
}

export function ModelSettings() {
  const agents_query = useMainAgent();
  const models_query = useModelOptions();
  const agent = agents_query.agent;
  const runs_in_team_mode = use_team_viewer_role() !== null;
  const default_model_mutation = useDefaultModelChange(agent);

  if (agents_query.isLoading || models_query.isLoading)
    return <Skeleton className="h-15 rounded-4xl" />;
  if (!agent || !models_query.data) {
    return (
      <ModelSettingsError
        on_retry={() => {
          void agents_query.refetch();
          void models_query.refetch();
        }}
      />
    );
  }

  return (
    <div className="flex flex-col gap-9">
      {runs_in_team_mode ? <InstallAiKeySettings /> : <AiAccountSettings />}
      <DefaultModelCard
        models={models_query.models}
        value={selected_model_choice(agent)}
        is_saving={default_model_mutation.isPending}
        on_change={(choice) => default_model_mutation.mutate(choice)}
      />
    </div>
  );
}

function DefaultModelCard({
  models,
  value,
  is_saving,
  on_change,
}: {
  models: ModelCatalogEntry[];
  value: ModelChoice;
  is_saving: boolean;
  on_change: (choice: ModelChoice) => void;
}) {
  const has_models = models.length > 0;
  return (
    <SettingsCard>
      <SettingsRow
        title="Default model"
        description={
          has_models ? describe_auto_model(models, value) : 'Add an AI key above to choose a model.'
        }
      >
        {has_models ? (
          <div className="w-64">
            <ModelPicker disabled={is_saving} models={models} value={value} onChange={on_change} />
          </div>
        ) : null}
      </SettingsRow>
    </SettingsCard>
  );
}

function ModelSettingsError({ on_retry }: { on_retry: () => void }) {
  return (
    <div className="panel flex items-center justify-between gap-3 px-3.5 py-3.5">
      <p className="text-sm text-muted-foreground">Models could not be loaded.</p>
      <Button size="sm" variant="outline" onClick={on_retry}>
        <RefreshCw />
        Retry
      </Button>
    </div>
  );
}
