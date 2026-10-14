import { public_brand_config } from '@coworker/config/public_env';
import { format_error_message } from '@coworker/shared';
import { Button } from '@coworker/ui/components/button';
import { Link, useSearch } from '@tanstack/react-router';
import { Loader2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ConnectionSetupCard } from '@/components/app/connection_setup_card';
import {
  type ConnectionSetupStartRequest,
  connection_profile_request,
  connection_setup_request,
} from '@/components/app/connection_setup_start_request';
import { load_existing_connection_setup } from '@/components/app/existing_connection_setup_request';
import { create_connection, list_catalog_apps_by_keys } from '@/lib/api';
import type { ConnectionSetupState } from '@/lib/api/types';
import { first_connection_profile } from '@/lib/catalog_app';
import { build_connection_setup_return_url } from '@/lib/connection_setup_return';

const product_brand_name = public_brand_config.product_brand_name;

type ConnectionSetupApp = {
  app_id: string;
  app_name: string;
  app_display_name: string;
  display_config: unknown;
  metadata: unknown;
};
type StartStatus =
  | { type: 'starting'; app?: ConnectionSetupApp | undefined }
  | { type: 'redirecting'; app?: ConnectionSetupApp | undefined }
  | { type: 'error'; message: string; app?: ConnectionSetupApp | undefined };
type StartRequest = ConnectionSetupStartRequest & { api_origin: string };

export function ConnectionSetupStart({ api_origin }: { api_origin: string }) {
  const search_params = useSearch({ strict: false });
  const request = useMemo(() => connection_setup_request(search_params), [search_params]);
  const [status, set_status] = useState<StartStatus>({ type: 'starting' });
  const started_ref = useRef(false);

  useEffect(() => {
    if (started_ref.current) return;
    started_ref.current = true;

    void start_connection_setup({ ...request, api_origin }, set_status);
  }, [request, api_origin]);

  const app = status.app;
  const title =
    status.type === 'error'
      ? 'Connection setup could not start'
      : status.type === 'redirecting'
        ? 'Opening connection setup'
        : `Starting ${product_brand_name} connection`;

  return (
    <main className="grid min-h-screen place-items-center bg-background px-6 text-foreground">
      <div className="flex w-full max-w-xl flex-col items-center gap-4 text-center">
        {status.type !== 'error' ? (
          <Loader2 className="size-5 animate-spin text-muted-foreground" aria-hidden="true" />
        ) : null}
        <div className="space-y-1">
          <h1 className="text-base font-medium">{title}</h1>
          <p className="text-sm text-muted-foreground">
            {status.type === 'error'
              ? status.message
              : 'You will be sent to the provider to approve access.'}
          </p>
        </div>
        {app ? (
          <ConnectionSetupCard
            app={connection_setup_card_app(app)}
            disabled
            isLoading={status.type !== 'error'}
            status={status.type === 'error' ? undefined : 'starting'}
          />
        ) : null}
        {status.type === 'error' ? (
          <Button render={<Link to="/integrations" />}>Open integrations</Button>
        ) : null}
      </div>
    </main>
  );
}

async function start_connection_setup(
  request: StartRequest,
  set_status: (status: StartStatus) => void,
) {
  if (request.connection_id || request.setup_token) {
    await start_existing_connection_setup(request, set_status);
    return;
  }

  if (!request.app_name) {
    set_status({ type: 'error', message: 'No app was selected.' });
    return;
  }

  try {
    const app = await find_app_by_name(request.app_name);
    if (!app) {
      set_status({
        type: 'error',
        message: `No integration was found for ${request.app_name}.`,
      });
      return;
    }

    set_status({ type: 'starting', app });
    const profile = first_connection_profile(app);
    if (!profile) {
      set_status({
        type: 'error',
        app,
        message: `${app.app_display_name} does not have an available connection flow.`,
      });
      return;
    }

    const result = await create_connection({
      app_id: app.app_id,
      ...connection_profile_request(request, profile),
      ...(request.connection_name ? { connection_name: request.connection_name } : {}),
      redirect_uri: build_connection_setup_return_url(window.location.origin),
    });
    const setup_url = read_setup_url(result.setup);
    if (!setup_url) {
      set_status({
        type: 'error',
        app,
        message: connection_setup_error(result.setup),
      });
      return;
    }

    set_status({ type: 'redirecting', app });
    window.location.assign(setup_url);
  } catch (error) {
    set_status({
      type: 'error',
      message: format_error_message(error, 'The connection setup request failed.'),
    });
  }
}

async function start_existing_connection_setup(
  request: StartRequest,
  set_status: (status: StartStatus) => void,
) {
  if (!request.connection_id || !request.setup_token) {
    set_status({ type: 'error', message: 'Connection setup link is incomplete.' });
    return;
  }

  try {
    const result = await load_existing_connection_setup({
      connection_id: request.connection_id,
      setup_token: request.setup_token,
      api_origin: request.api_origin,
    });
    set_status({ type: 'redirecting', app: result.app });
    window.location.assign(result.setup_url);
  } catch (error) {
    set_status({
      type: 'error',
      message: format_error_message(error, 'The connection setup request failed.'),
    });
  }
}

async function find_app_by_name(app_name: string) {
  const offered_apps = await list_catalog_apps_by_keys([app_name]);
  return offered_apps.find((app) => app.app_name === app_name) ?? offered_apps[0] ?? null;
}

function connection_setup_card_app(app: ConnectionSetupApp) {
  const metadata = app.metadata as { description?: string; icon_url?: string };
  const display_config = app.display_config as { description?: string; icon_url?: string };
  const description = metadata.description ?? display_config.description;
  const icon_url = metadata.icon_url ?? display_config.icon_url;

  return {
    app_id: app.app_id,
    app_name: app.app_name,
    app_display_name: app.app_display_name,
    ...(description ? { description } : {}),
    ...(icon_url ? { icon_url } : {}),
  };
}

function connection_setup_error(setup: ConnectionSetupState) {
  return setup.setup_error ?? 'The provider did not return a connection setup URL.';
}

function read_setup_url(setup: ConnectionSetupState) {
  return setup.hosted_connect_link || setup.authorization_url || null;
}
