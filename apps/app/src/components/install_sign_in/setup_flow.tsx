import { AuthQuestion } from '@/components/auth/auth_panel';
import { InstallButton } from '@/components/install_sign_in/install_form_parts';
import { MakeAccountScreen } from '@/components/install_sign_in/make_account_screen';
import { RecoveryCodeScreen } from '@/components/install_sign_in/recovery_code_screen';
import { SetupAiStep } from '@/components/install_sign_in/setup_ai_step';
import {
  type StoppedSetupScreen,
  stopped_screen_for,
  useFirstSetupScreen,
} from '@/components/install_sign_in/setup_screens';
import {
  forget_setup,
  keep_recovery_code_until_saved,
  useSetupToken,
} from '@/components/install_sign_in/use_setup_token';

function open_alfera() {
  forget_setup();
  window.location.assign('/');
}

export function SetupFlow() {
  const token_state = useSetupToken();
  const { screen, set_screen, try_again } = useFirstSetupScreen(token_state);
  const setup_token = token_state.looked ? token_state.token : null;

  if (screen.name === 'stopped') return <StoppedScreen screen={screen} on_try_again={try_again} />;
  if (screen.name === 'save_code') return <SaveFirstRecoveryCode code={screen.recovery_code} />;
  if (screen.name === 'checking' || !setup_token) {
    return <AuthQuestion title="Opening setup…" subtitle="Alfera checks your setup link." />;
  }
  if (screen.name !== 'make_account') {
    return (
      <SetupAiStep
        screen={screen}
        setup_token={setup_token}
        go_to={set_screen}
        on_connected={(connected) => set_screen({ name: 'make_account', connected })}
      />
    );
  }
  return (
    <MakeAccountScreen
      setup_token={setup_token}
      connected_ai_name={screen.connected?.display_name ?? null}
      on_made={(recovery_code) => {
        keep_recovery_code_until_saved(recovery_code);
        set_screen({ name: 'save_code', recovery_code });
      }}
      on_stopped={(code, message) => {
        const stopped = stopped_screen_for(code, message);
        if (stopped) set_screen(stopped);
      }}
    />
  );
}

function SaveFirstRecoveryCode({ code }: { code: string }) {
  return (
    <RecoveryCodeScreen
      title="Save your recovery code"
      subtitle="If you forget your password, this code lets you set a new one. Alfera shows it only once, so keep it somewhere safe."
      recovery_code={code}
      on_done={open_alfera}
    />
  );
}

function StoppedScreen({
  screen,
  on_try_again,
}: {
  screen: StoppedSetupScreen;
  on_try_again: () => void;
}) {
  return (
    <AuthQuestion title={screen.title} subtitle={screen.subtitle}>
      {screen.next_step === 'sign_in' ? (
        <InstallButton
          busy={false}
          busy_label=""
          on_click={() => window.location.assign('/sign-in')}
        >
          Go to sign in
        </InstallButton>
      ) : null}
      {screen.next_step === 'try_again' ? (
        <InstallButton busy={false} busy_label="" on_click={on_try_again}>
          Try again
        </InstallButton>
      ) : null}
    </AuthQuestion>
  );
}
