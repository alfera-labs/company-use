import { ExternalLink } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { AuthQuestion } from '@/components/auth/auth_panel';
import {
  type AiProvider,
  read_suggested_provider,
} from '@/components/install_sign_in/ai_providers';
import { ask_install_step } from '@/components/install_sign_in/ask_install_step';
import {
  InstallButton,
  InstallError,
  InstallField,
  InstallQuietLink,
} from '@/components/install_sign_in/install_form_parts';

export type AiConnection = { provider_slot: string; display_name: string; secret_hint: string };

function usePasteKey(
  setup_token: string,
  provider: AiProvider,
  on_connected: (connection: AiConnection) => void,
) {
  const [api_key, set_api_key] = useState('');
  const [busy, set_busy] = useState(false);
  const [refusal, set_refusal] = useState({ message: '', suggested: null as AiProvider | null });

  async function send() {
    set_busy(true);
    set_refusal({ message: '', suggested: null });
    const answer = await ask_install_step<AiConnection>('/auth/setup/ai-key', {
      setup_token,
      api_key,
      provider_slot: provider.provider_slot,
    });
    set_busy(false);
    if (answer.ok) return on_connected(answer.data);
    set_refusal({
      message:
        answer.code === 'validation_error'
          ? 'Paste the whole key, then try again.'
          : answer.message,
      suggested: read_suggested_provider(answer.code, answer.details),
    });
  }

  const sends_after_switch = useRef(false);
  useEffect(() => {
    if (!sends_after_switch.current) return;
    sends_after_switch.current = false;
    void send();
  });
  const switch_and_send = (on_switch: () => void) => {
    sends_after_switch.current = true;
    on_switch();
  };
  const change_key = (value: string) => {
    set_api_key(value);
    set_refusal({ message: '', suggested: null });
  };
  return { api_key, change_key, busy, refusal, send, switch_and_send };
}

export function GetKeyLink({
  provider,
  className = '',
}: {
  provider: AiProvider;
  className?: string;
}) {
  if (!provider.key_page) return null;
  return (
    <a
      className={`items-center gap-1 font-semibold text-brand ${className}`}
      href={provider.key_page}
      target="_blank"
      rel="noreferrer"
    >
      Get a key from {provider.name}
      <ExternalLink className="size-3.5" />
    </a>
  );
}

function PasteKeyAction({
  provider,
  suggested,
  busy,
  on_use_suggested,
}: {
  provider: AiProvider;
  suggested: AiProvider | null;
  busy: boolean;
  on_use_suggested: (provider_slot: string) => void;
}) {
  if (suggested) {
    return (
      <InstallButton
        busy={false}
        busy_label=""
        on_click={() => on_use_suggested(suggested.provider_slot)}
      >
        Use {suggested.name} instead
      </InstallButton>
    );
  }
  return (
    <InstallButton busy={busy} busy_label={`Checking the key with ${provider.name}…`}>
      Check and save
    </InstallButton>
  );
}

export function PasteKeyScreen({
  setup_token,
  provider,
  on_connected,
  on_back,
  on_use_provider,
}: {
  setup_token: string;
  provider: AiProvider;
  on_connected: (connection: AiConnection) => void;
  on_back: () => void;
  on_use_provider: (provider_slot: string) => void;
}) {
  const form = usePasteKey(setup_token, provider, on_connected);
  const { suggested } = form.refusal;
  return (
    <AuthQuestion
      title={`Paste your ${provider.name} key`}
      subtitle={`Alfera checks the key with ${provider.name}, then saves it encrypted on this server.`}
    >
      <GetKeyLink provider={provider} className="-mt-3 mb-6 flex w-fit text-[15px]" />
      <form
        method="post"
        onSubmit={(event) => {
          event.preventDefault();
          void form.send();
        }}
      >
        <InstallField
          label={`Your ${provider.name} API key`}
          name="api_key"
          className="font-mono text-[15px]"
          {...{ autoComplete: 'off', spellCheck: false, required: true }}
          placeholder={provider.key_placeholder}
          value={form.api_key}
          onChange={(event) => form.change_key(event.target.value)}
        />
        <InstallError message={form.refusal.message} />
        <PasteKeyAction
          provider={provider}
          suggested={suggested}
          busy={form.busy}
          on_use_suggested={(slot) => form.switch_and_send(() => on_use_provider(slot))}
        />
      </form>
      <InstallQuietLink label="Back" on_click={on_back} />
    </AuthQuestion>
  );
}
