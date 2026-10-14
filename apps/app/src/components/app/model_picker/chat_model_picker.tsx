import { Button } from '@coworker/ui/components/button';
import { Skeleton } from '@coworker/ui/components/skeleton';
import { RefreshCw } from 'lucide-react';
import { memo } from 'react';
import { useChatUiStore } from '@/components/app/chat_ui_store';
import { selected_model_choice } from '@/components/app/model_picker/model_choice';
import { ModelPicker } from '@/components/app/model_picker/model_picker';
import { useModelOptions } from '@/components/app/model_picker/use_model_options';
import { useMainAgent } from '@/components/app/use_main_agent';

export const ChatModelPicker = memo(function ChatModelPicker() {
  const model_choice = useChatUiStore((state) => state.model_choice);
  const set_model_choice = useChatUiStore((state) => state.set_model_choice);
  const models_query = useModelOptions();
  const { models } = models_query;
  const agents_query = useMainAgent();
  const { agent } = agents_query;

  if (models_query.isLoading || agents_query.isLoading) {
    return <Skeleton className="h-11 w-20 rounded-full sm:h-8" />;
  }
  if (!models_query.data || models.length === 0 || !agent) {
    return (
      <Button
        aria-label="Retry loading the model picker"
        className="h-11 rounded-full sm:h-8"
        size="sm"
        variant="ghost"
        onClick={() => {
          void models_query.refetch();
          void agents_query.refetch();
        }}
      >
        <RefreshCw />
        Model unavailable
      </Button>
    );
  }

  return (
    <ModelPicker
      inheritedChoice={selected_model_choice(agent)}
      models={models}
      size="inline"
      value={model_choice}
      onChange={set_model_choice}
    />
  );
});
