import { Button } from '@coworker/ui/components/button';
import { useSearch } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { InstallChatgptSettings } from '@/components/app/install_chatgpt_settings';
import { PasteInstallKey } from '@/components/app/paste_install_key';
import { AiProviderChoiceList } from '@/components/install_sign_in/ai_provider_choice_list';
import {
  find_ai_provider,
  recommended_ai_provider,
} from '@/components/install_sign_in/ai_providers';

type AddKeyStep =
  | { name: 'closed' }
  | { name: 'choose'; choice: string }
  | { name: 'paste'; provider_slot: string }
  | { name: 'chatgpt' };

const first_choice = recommended_ai_provider?.provider_slot ?? 'openrouter';

function step_for_provider(provider_slot: string): AddKeyStep {
  return find_ai_provider(provider_slot)?.connects_with === 'chatgpt_sign_in'
    ? { name: 'chatgpt' }
    : { name: 'paste', provider_slot };
}

function useKeyAskedForInTheAddress(): string | undefined {
  const search: { add_key?: string } = useSearch({ strict: false });
  return search.add_key && find_ai_provider(search.add_key) ? search.add_key : undefined;
}

function ChooseProvider({
  choice,
  on_change,
  on_continue,
  on_cancel,
}: {
  choice: string;
  on_change: (choice: string) => void;
  on_continue: () => void;
  on_cancel?: (() => void) | undefined;
}) {
  return (
    <div className="mt-3 flex flex-col gap-3">
      <AiProviderChoiceList value={choice} on_change={on_change} look="app" />
      <div className="flex gap-2">
        <Button size="sm" onClick={on_continue}>
          Continue
        </Button>
        {on_cancel ? (
          <Button size="sm" variant="ghost" onClick={on_cancel}>
            Cancel
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function AddKeyButton({ on_click }: { on_click: () => void }) {
  return (
    <Button className="mt-3" size="sm" variant="outline" onClick={on_click}>
      Add a key
    </Button>
  );
}

/** Add an AI key for the whole server in two steps: choose the provider, then paste its key. */
export function AddInstallAiKey({ has_keys }: { has_keys: boolean }) {
  const resting: AddKeyStep = has_keys
    ? { name: 'closed' }
    : { name: 'choose', choice: first_choice };
  const key_asked_for = useKeyAskedForInTheAddress();
  const [step, set_step] = useState<AddKeyStep>(resting);
  useEffect(() => {
    if (key_asked_for) set_step(step_for_provider(key_asked_for));
  }, [key_asked_for]);
  const close = () => set_step(resting);
  const provider = step.name === 'paste' ? find_ai_provider(step.provider_slot) : undefined;
  if (step.name === 'closed') {
    return <AddKeyButton on_click={() => set_step({ name: 'choose', choice: first_choice })} />;
  }
  if (step.name === 'choose') {
    const go_on = () => set_step(step_for_provider(step.choice));
    return (
      <ChooseProvider
        choice={step.choice}
        on_change={(choice) => set_step({ name: 'choose', choice })}
        on_continue={go_on}
        on_cancel={has_keys ? close : undefined}
      />
    );
  }
  if (step.name === 'chatgpt') {
    return (
      <InstallChatgptSettings
        on_done={close}
        on_back={() => set_step({ name: 'choose', choice: 'chatgpt_plan' })}
      />
    );
  }
  if (!provider) return null;
  return (
    <PasteInstallKey
      provider={provider}
      on_saved={close}
      on_back={() => set_step({ name: 'choose', choice: provider.provider_slot })}
      on_use_provider={(provider_slot) => set_step({ name: 'paste', provider_slot })}
    />
  );
}
