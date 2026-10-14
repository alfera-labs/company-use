import { useState } from 'react';
import { AuthQuestion } from '@/components/auth/auth_panel';
import { AiProviderChoiceList } from '@/components/install_sign_in/ai_provider_choice_list';
import { recommended_ai_provider } from '@/components/install_sign_in/ai_providers';
import { InstallButton, InstallQuietLink } from '@/components/install_sign_in/install_form_parts';
import type { AiConnection } from '@/components/install_sign_in/paste_key_form';

export type { AiConnection } from '@/components/install_sign_in/paste_key_form';

function ChooseAi({
  first_choice,
  on_choose,
}: {
  first_choice: string;
  on_choose: (provider_slot: string) => void;
}) {
  const [choice, set_choice] = useState(first_choice);
  return (
    <AuthQuestion
      title="Connect your AI"
      subtitle="Choose how Alfera thinks. You pay that company for what Alfera uses."
    >
      <AiProviderChoiceList value={choice} on_change={set_choice} look="sign_in_page" />
      <InstallButton busy={false} busy_label="" on_click={() => on_choose(choice)}>
        Continue
      </InstallButton>
    </AuthQuestion>
  );
}

export function ConnectAiScreen({
  connected,
  first_choice,
  on_continue,
  on_choose,
}: {
  connected: AiConnection | null;
  first_choice?: string | undefined;
  on_continue: () => void;
  on_choose: (provider_slot: string) => void;
}) {
  const [replacing, set_replacing] = useState(false);
  if (connected && !replacing) {
    return (
      <AuthQuestion
        title="Your AI is connected"
        subtitle={`Alfera uses your ${connected.display_name} connection.`}
      >
        <InstallButton busy={false} busy_label="" on_click={on_continue}>
          Continue
        </InstallButton>
        <InstallQuietLink label="Connect another way" on_click={() => set_replacing(true)} />
      </AuthQuestion>
    );
  }
  return (
    <ChooseAi
      first_choice={first_choice ?? recommended_ai_provider?.provider_slot ?? 'openrouter'}
      on_choose={on_choose}
    />
  );
}
