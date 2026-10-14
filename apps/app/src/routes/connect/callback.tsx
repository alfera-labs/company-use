import { public_brand_config } from '@coworker/config/public_env';
import { format_error_message, sleep } from '@coworker/shared';
import { createFileRoute } from '@tanstack/react-router';
import { CheckCircle2, CircleAlert, Loader2 } from 'lucide-react';
import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { complete_connection_setup, complete_public_connection_setup } from '@/lib/api';
import {
  build_connection_setup_callback_view,
  type ConnectionSetupCallbackStatus,
} from '@/lib/connection_setup_callback_view';
import {
  type HostedSetupProviderKey,
  publish_connection_setup_return,
  read_connection_setup_return_event,
  should_complete_connection_setup_return,
  take_connection_setup_return_to,
} from '@/lib/connection_setup_return';
import { read_public_api_origin } from '@/lib/public_api_origin';

const product_brand_name = public_brand_config.product_brand_name;
const callback_status_icons = {
  returning: <Loader2 className="size-5 animate-spin text-muted-foreground" aria-hidden="true" />,
  success: <CheckCircle2 className="size-6 text-positive-ink" aria-hidden="true" />,
  error: <CircleAlert className="size-6 text-destructive" aria-hidden="true" />,
} satisfies Record<ConnectionSetupCallbackStatus, ReactNode>;

export const Route = createFileRoute('/connect/callback')({
  loader: () => read_public_api_origin(),
  staleTime: Number.POSITIVE_INFINITY,
  component: ConnectionSetupCallbackRoute,
});

function ConnectionSetupCallbackRoute() {
  return <ConnectionSetupCallbackPage api_origin={Route.useLoaderData()} />;
}

function ConnectionSetupCallbackPage({ api_origin }: { api_origin: string }) {
  const [callback_status, set_callback_status] =
    useState<ConnectionSetupCallbackStatus>('returning');
  const [error_message, set_error_message] = useState<string | undefined>();
  const [can_close_manually, set_can_close_manually] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let close_timer: number | null = null;
    let fallback_timer: number | null = null;

    const event = read_connection_setup_return_event(window.location.href);
    const return_to = take_connection_setup_return_to();

    function leave_callback(delay_ms: number) {
      const leave = return_to ? () => window.location.replace(return_to) : () => window.close();
      close_timer = window.setTimeout(leave, delay_ms);
    }

    async function complete_return() {
      fallback_timer = window.setTimeout(() => set_can_close_manually(true), 900);

      if (event.status === 'error') {
        publish_connection_setup_return(event);
        set_callback_status('error');
        set_error_message(event.error_message);
        if (return_to) leave_callback(2500);
        return;
      }

      if (!should_complete_connection_setup_return(event)) {
        publish_connection_setup_return(event);
        set_callback_status('success');
        leave_callback(900);
        return;
      }

      try {
        await complete_connection_setup_with_retry(event, api_origin);
        if (cancelled) return;
        publish_connection_setup_return(event);
        set_callback_status('success');
        leave_callback(900);
      } catch (error) {
        if (cancelled) return;
        const message = format_error_message(error, 'Connection setup could not be finalized.');
        publish_connection_setup_return({
          ...event,
          status: 'error',
          error_message: message,
        });
        set_callback_status('error');
        set_error_message(message);
        if (return_to) leave_callback(2500);
      }
    }

    void complete_return();

    return () => {
      cancelled = true;
      if (close_timer) window.clearTimeout(close_timer);
      if (fallback_timer) window.clearTimeout(fallback_timer);
    };
  }, [api_origin]);

  const view = build_connection_setup_callback_view({
    status: callback_status,
    product_brand_name,
    can_close_manually,
    ...(error_message ? { error_message } : {}),
  });

  return (
    <main className="grid min-h-screen place-items-center bg-background px-6 text-foreground">
      <div className="flex max-w-sm flex-col items-center gap-3 text-center">
        {callback_status_icons[callback_status]}
        <h1 className="text-base font-medium">{view.title}</h1>
        <p className="text-sm text-muted-foreground">{view.description}</p>
      </div>
    </main>
  );
}

async function complete_connection_setup_with_retry(
  event: ReturnType<typeof read_connection_setup_return_event> & {
    status: 'success';
    connection_id: string;
    provider_key: HostedSetupProviderKey;
  },
  api_origin: string,
) {
  // /complete 409s until the provider has indexed the new account; a short retry covers it
  for (let attempt = 1; ; attempt += 1) {
    try {
      if (event.setup_token) {
        return await complete_public_connection_setup({
          connection_id: event.connection_id,
          setup_token: event.setup_token,
          api_origin,
        });
      }
      return await complete_connection_setup(event.connection_id);
    } catch (error) {
      if (attempt >= 3) throw error;
      await sleep(1000);
    }
  }
}
