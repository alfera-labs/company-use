import { useState } from 'react';
import type { ChatgptSignInStart } from '@/lib/api/install_ai_keys';

export type ChatgptPasteBackCalls<T> = {
  start: () => Promise<ChatgptSignInStart>;
  finish: (input: { sign_in_attempt: string; callback_url: string }) => Promise<T>;
};

type Attempt = { sign_in_attempt: string; authorize_url: string };

const codes_that_need_a_new_attempt = new Set([
  'chatgpt_sign_in_failed',
  'chatgpt_sign_in_expired',
]);

function open_blank_tab(): Window | null {
  const tab = window.open('', '_blank');
  if (tab) tab.opener = null;
  return tab;
}

function send_tab_to(tab: Window | null, address: string) {
  if (tab) tab.location.href = address;
  else window.open(address, '_blank', 'noopener');
}

const no_failure = { message: '', needs_a_new_attempt: false };

function read_failure(failure: unknown) {
  const code = (failure as { code?: unknown } | null)?.code;
  return {
    message: failure instanceof Error ? failure.message : String(failure),
    needs_a_new_attempt: typeof code === 'string' && codes_that_need_a_new_attempt.has(code),
  };
}

function useStepRunner() {
  const [busy, set_busy] = useState(false);
  const [failure, set_failure] = useState(no_failure);
  async function run(step: () => Promise<void>) {
    set_busy(true);
    set_failure(no_failure);
    await step().catch((error: unknown) => set_failure(read_failure(error)));
    set_busy(false);
  }
  return { busy, failure, run, clear_failure: () => set_failure(no_failure) };
}

/**
 * ChatGPT sign-in for a server the browser reaches over the network. The sign-in opens in a new
 * tab. After the person approves, that tab lands on a 127.0.0.1 address that does not load, and
 * the person pastes that address here. ChatGPT remembers an unfinished sign-in in the browser, so
 * a page keeps one attempt and opens it again instead of starting a second one. The tab is opened
 * during the click, so no pop-up blocker stops it.
 */
export function useChatgptPasteBack<T>(
  calls: ChatgptPasteBackCalls<T>,
  on_connected: (result: T) => void,
) {
  const [attempt, set_attempt] = useState<Attempt | null>(null);
  const { busy, failure, run, clear_failure } = useStepRunner();

  const start_new_attempt = () => {
    const tab = open_blank_tab();
    return run(async () => {
      const started = await calls.start().catch((error: unknown) => {
        tab?.close();
        throw error;
      });
      send_tab_to(tab, started.authorize_url);
      set_attempt(started);
    });
  };

  const open_chatgpt = () => {
    if (!attempt) return start_new_attempt();
    send_tab_to(open_blank_tab(), attempt.authorize_url);
  };

  const finish = (callback_url: string) =>
    run(async () => {
      if (!attempt) return;
      on_connected(await calls.finish({ sign_in_attempt: attempt.sign_in_attempt, callback_url }));
    });

  const cancel = () => {
    set_attempt(null);
    clear_failure();
  };

  const waiting_for_address = attempt !== null;
  const { message: error, needs_a_new_attempt } = failure;
  return {
    waiting_for_address,
    busy,
    error,
    needs_a_new_attempt,
    open_chatgpt,
    finish,
    start_new_attempt,
    cancel,
  };
}
