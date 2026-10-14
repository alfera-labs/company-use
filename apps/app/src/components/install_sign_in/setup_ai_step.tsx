import { find_ai_provider } from '@/components/install_sign_in/ai_providers';
import { ConnectAiScreen } from '@/components/install_sign_in/connect_ai_screen';
import { ConnectChatgptScreen } from '@/components/install_sign_in/connect_chatgpt_screen';
import { type AiConnection, PasteKeyScreen } from '@/components/install_sign_in/paste_key_form';

export type SetupAiScreen =
  | { name: 'connect_ai'; connected: AiConnection | null; first_choice?: string }
  | { name: 'paste_key'; provider_slot: string }
  | { name: 'connect_chatgpt' };

export function SetupAiStep({
  screen,
  setup_token,
  go_to,
  on_connected,
}: {
  screen: SetupAiScreen;
  setup_token: string;
  go_to: (screen: SetupAiScreen) => void;
  on_connected: (connection: AiConnection | null) => void;
}) {
  const choose = (provider_slot: string) =>
    go_to(
      find_ai_provider(provider_slot)?.connects_with === 'chatgpt_sign_in'
        ? { name: 'connect_chatgpt' }
        : { name: 'paste_key', provider_slot },
    );
  const back_to_choice = (first_choice: string) =>
    go_to({ name: 'connect_ai', connected: null, first_choice });
  const provider = screen.name === 'paste_key' ? find_ai_provider(screen.provider_slot) : undefined;
  if (screen.name === 'paste_key' && provider) {
    return (
      <PasteKeyScreen
        setup_token={setup_token}
        provider={provider}
        on_connected={on_connected}
        on_back={() => back_to_choice(provider.provider_slot)}
        on_use_provider={(provider_slot) => go_to({ name: 'paste_key', provider_slot })}
      />
    );
  }
  if (screen.name === 'connect_chatgpt') {
    return (
      <ConnectChatgptScreen
        setup_token={setup_token}
        on_connected={on_connected}
        on_paste_a_key={() => back_to_choice('chatgpt_plan')}
      />
    );
  }
  const connected = screen.name === 'connect_ai' ? screen.connected : null;
  return (
    <ConnectAiScreen
      connected={connected}
      first_choice={screen.name === 'connect_ai' ? screen.first_choice : undefined}
      on_continue={() => on_connected(connected)}
      on_choose={choose}
    />
  );
}
