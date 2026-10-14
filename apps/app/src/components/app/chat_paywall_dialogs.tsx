import { PaywallDialog } from '@/components/app/paywall_dialog';
import { TrialWelcome } from '@/components/app/trial_welcome';

/** The dialogs about paying that can open over a chat: the trial welcome and the plans paywall. */
export function ChatPaywallDialogs(props: {
  paywall: { paywall_open: boolean; set_paywall_open: (open: boolean) => void };
  session_id: string | undefined;
}) {
  return (
    <>
      <TrialWelcome />
      <PaywallDialog
        open={props.paywall.paywall_open}
        sessionId={props.session_id}
        onOpenChange={props.paywall.set_paywall_open}
      />
    </>
  );
}
