import { format_error_message } from '@coworker/shared';
import { useMutation } from '@tanstack/react-query';
import { Loader2, TriangleAlert } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { SlackGlyph } from '@/components/onboarding/slack/glyph';
import { start_slack_connect } from '@/lib/api';

export function SlackStep({
  connected,
  onConnected,
  onSkip,
}: {
  connected: boolean;
  onConnected: () => void;
  onSkip: () => void;
}) {
  const connect_error = useRefusedInstallReason();
  useEffect(() => {
    if (connected) onConnected();
  }, [connected, onConnected]);

  const connect_mutation = useMutation({
    mutationFn: () =>
      start_slack_connect({
        redirect_uri: `${window.location.origin}/onboarding${window.location.search}`,
      }),
    onSuccess: (result) => {
      if (!result.start_url) {
        toast.error('Could not start the Slack connection. Please try again.');
        return;
      }
      window.location.href = result.start_url;
    },
    onError: (error) => {
      toast.error(format_error_message(error, 'Could not start the Slack connection.'));
    },
  });
  const is_busy = connect_mutation.isPending || connect_mutation.isSuccess;

  if (connected) return null;

  return (
    <SlackShell
      eyebrow="One last thing"
      title={
        <>
          I'm most powerful in your <span className="ob-accent">Slack</span>
        </>
      }
      subtitle="I'll ping you when something needs you, and your whole team can use me."
    >
      {connect_error ? (
        <p className="ob-alert" role="alert">
          <TriangleAlert className="size-4" aria-hidden="true" />
          <span>{connect_error}</span>
        </p>
      ) : null}
      <div className="ob-actions">
        <button
          aria-busy={is_busy}
          className="ob-btn"
          type="button"
          onClick={() => {
            if (!is_busy) connect_mutation.mutate();
          }}
        >
          {is_busy ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <SlackGlyph className="size-5" />
          )}
          {is_busy ? 'Opening Slack…' : 'Add me to Slack'}
        </button>
        <button className="ob-quiet" type="button" onClick={onSkip}>
          Continue in the dashboard
        </button>
      </div>
      <p className="ob-fine">You choose the channels I see.</p>
    </SlackShell>
  );
}

function useRefusedInstallReason() {
  const [reason, set_reason] = useState<string | null>(null);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const description = params.get('error_description');
    if (!description) return;

    set_reason(description);
    params.delete('error_description');
    params.delete('connection_id');
    const query = params.toString();
    window.history.replaceState({}, '', `${window.location.pathname}${query ? `?${query}` : ''}`);
  }, []);
  return reason;
}

function SlackShell({
  eyebrow,
  title,
  subtitle,
  children,
}: {
  eyebrow?: string;
  title: React.ReactNode;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <div className="ob-step ob-animate">
      {eyebrow ? <p className="ob-eyebrow">{eyebrow}</p> : null}
      <h1 className="ob-title">{title}</h1>
      <p className="ob-subtitle">{subtitle}</p>
      {children}
    </div>
  );
}
