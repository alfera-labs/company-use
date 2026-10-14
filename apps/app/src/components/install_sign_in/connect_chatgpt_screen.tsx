import { useState } from 'react';
import { AuthQuestion } from '@/components/auth/auth_panel';
import { ask_install_step } from '@/components/install_sign_in/ask_install_step';
import {
  InstallButton,
  InstallError,
  InstallField,
  InstallQuietLink,
} from '@/components/install_sign_in/install_form_parts';
import type { AiConnection } from '@/components/install_sign_in/paste_key_form';
import { useChatgptPasteBack } from '@/components/install_sign_in/use_chatgpt_paste_back';
import type { ChatgptSignInStart } from '@/lib/api/install_ai_keys';

class StepRefused extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
  }
}

async function ask_or_throw<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const answer = await ask_install_step<T>(path, body);
  if (!answer.ok) throw new StepRefused(answer.message, answer.code);
  return answer.data;
}

function PasteAddressForm({
  busy,
  on_finish,
}: {
  busy: boolean;
  on_finish: (url: string) => void;
}) {
  const [callback_url, set_callback_url] = useState('');
  return (
    <form
      method="post"
      onSubmit={(event) => {
        event.preventDefault();
        on_finish(callback_url);
      }}
    >
      <InstallField
        label="Address of the ChatGPT tab"
        name="callback_url"
        className="font-mono text-[14px]"
        autoComplete="off"
        spellCheck={false}
        placeholder="http://127.0.0.1:1455/auth/callback?code=…"
        value={callback_url}
        onChange={(event) => set_callback_url(event.target.value)}
        required
      />
      <InstallButton busy={busy} busy_label="Connecting ChatGPT…">
        Finish
      </InstallButton>
    </form>
  );
}

function useSetupChatgptSignIn(setup_token: string, on_connected: (c: AiConnection) => void) {
  return useChatgptPasteBack<AiConnection>(
    {
      start: () => ask_or_throw<ChatgptSignInStart>('/auth/setup/chatgpt-start', { setup_token }),
      finish: (input) =>
        ask_or_throw<AiConnection>('/auth/setup/chatgpt-finish', { setup_token, ...input }),
    },
    on_connected,
  );
}

export function ConnectChatgptScreen({
  setup_token,
  on_connected,
  on_paste_a_key,
}: {
  setup_token: string;
  on_connected: (connection: AiConnection) => void;
  on_paste_a_key: () => void;
}) {
  const sign_in = useSetupChatgptSignIn(setup_token, on_connected);
  if (!sign_in.waiting_for_address) {
    return (
      <AuthQuestion
        title="Connect your ChatGPT plan"
        subtitle="Alfera opens ChatGPT in a new tab. Sign in there and approve Alfera. Your plan pays for what Alfera uses."
      >
        <InstallError message={sign_in.error} />
        <InstallButton
          busy={sign_in.busy}
          busy_label="Opening ChatGPT…"
          on_click={sign_in.open_chatgpt}
        >
          Open ChatGPT
        </InstallButton>
        <InstallQuietLink label="Paste an API key instead" on_click={on_paste_a_key} />
      </AuthQuestion>
    );
  }
  return (
    <AuthQuestion
      title="Paste the address of the ChatGPT tab"
      subtitle="After you approve, that tab shows a page that does not load. That is expected. Copy the whole address of that tab and paste it here."
    >
      {sign_in.needs_a_new_attempt ? (
        <InstallButton
          busy={sign_in.busy}
          busy_label="Opening ChatGPT…"
          on_click={sign_in.start_new_attempt}
        >
          Start again in ChatGPT
        </InstallButton>
      ) : (
        <PasteAddressForm busy={sign_in.busy} on_finish={(url) => void sign_in.finish(url)} />
      )}
      <InstallError message={sign_in.error} />
      <InstallQuietLink label="Open the ChatGPT tab again" on_click={sign_in.open_chatgpt} />
      <InstallQuietLink label="Paste an API key instead" on_click={on_paste_a_key} />
    </AuthQuestion>
  );
}
