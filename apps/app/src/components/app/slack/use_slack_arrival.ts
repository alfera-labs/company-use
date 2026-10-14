import { useEffect, useRef } from 'react';
import { join_slack_channels, send_onboarding_welcome } from '@/lib/api';

export function useSlackArrival(should_start: boolean) {
  const started = useRef(false);
  useEffect(() => {
    if (!should_start || started.current) return;
    started.current = true;
    void start_slack_arrival();
  }, [should_start]);
}

async function start_slack_arrival() {
  await join_slack_channels({ all_public: true }).catch((error: unknown) =>
    console.error('Alfera could not join the Slack channels.', error),
  );
  await send_onboarding_welcome().catch((error: unknown) =>
    console.error('Alfera could not send the Slack welcome.', error),
  );
}
