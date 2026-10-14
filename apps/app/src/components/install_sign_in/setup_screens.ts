import { useEffect, useState } from 'react';
import { ask_install_step } from '@/components/install_sign_in/ask_install_step';
import type { AiConnection } from '@/components/install_sign_in/paste_key_form';
import type { SetupAiScreen } from '@/components/install_sign_in/setup_ai_step';
import {
  read_unsaved_recovery_code,
  type SetupTokenState,
} from '@/components/install_sign_in/use_setup_token';

export type StoppedSetupScreen = {
  name: 'stopped';
  title: string;
  subtitle: string;
  next_step: 'sign_in' | 'try_again' | 'none';
};

export type SetupScreen =
  | { name: 'checking' }
  | StoppedSetupScreen
  | SetupAiScreen
  | { name: 'make_account'; connected: AiConnection | null }
  | { name: 'save_code'; recovery_code: string };

const link_not_valid: StoppedSetupScreen = {
  name: 'stopped',
  title: 'This setup link does not work',
  subtitle:
    'Open the setup link from the page that made your server. Copy all of it, with the part after the # sign.',
  next_step: 'none',
};

const already_set_up: StoppedSetupScreen = {
  name: 'stopped',
  title: 'This Alfera is set up',
  subtitle: 'Its owner made an account already. Sign in with that email and password.',
  next_step: 'sign_in',
};

export function stopped_screen_for(code: string, message: string): StoppedSetupScreen | null {
  if (code === 'setup_finished') return already_set_up;
  if (code === 'setup_link_not_valid') return link_not_valid;
  return null;
}

function first_screen_for_answer(
  answer: Awaited<ReturnType<typeof ask_install_step<{ ai_connections?: AiConnection[] }>>>,
): SetupScreen {
  if (answer.ok) return { name: 'connect_ai', connected: answer.data?.ai_connections?.[0] ?? null };
  return (
    stopped_screen_for(answer.code, answer.message) ?? {
      name: 'stopped',
      title: 'Setup did not start',
      subtitle: answer.message,
      next_step: 'try_again',
    }
  );
}

function check_setup_link(
  setup_token: string,
  set_screen: (screen: SetupScreen) => void,
): () => void {
  let is_current = true;
  set_screen({ name: 'checking' });
  void ask_install_step<{ ai_connections?: AiConnection[] }>('/auth/setup/check', {
    setup_token,
  }).then((answer) => {
    if (is_current) set_screen(first_screen_for_answer(answer));
  });
  return () => {
    is_current = false;
  };
}

export function useFirstSetupScreen(token_state: SetupTokenState) {
  const [screen, set_screen] = useState<SetupScreen>({ name: 'checking' });
  useEffect(() => {
    if (!token_state.looked) return;
    const unsaved_recovery_code = read_unsaved_recovery_code();
    if (unsaved_recovery_code) {
      return set_screen({ name: 'save_code', recovery_code: unsaved_recovery_code });
    }
    if (!token_state.token) return set_screen(link_not_valid);
    return check_setup_link(token_state.token, set_screen);
  }, [token_state]);
  const try_again = () => {
    if (token_state.looked && token_state.token) check_setup_link(token_state.token, set_screen);
  };
  return { screen, set_screen, try_again };
}
