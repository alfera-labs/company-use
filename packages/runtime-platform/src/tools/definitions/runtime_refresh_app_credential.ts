import {
  type ConnectionServingHost,
  find_connections_serving_host,
} from '@coworker/core/db/queries/connection_credential_exchange';
import { create_logger, format_error_message } from '@coworker/shared';
import {
  type CredentialExchangeReport,
  exchange_credential_for_connection,
} from '@runtime-platform/connections/credential_exchange_service';
import { attach_credentials_to_running_sandbox } from '@runtime-platform/orchestrator/sandbox_credential_headers';
import type {
  RuntimeToolDefinition,
  RuntimeToolExecutionContext,
} from '@runtime-platform/tools/types';
import { z } from 'zod';

const logger = create_logger('refresh-app-credential');

const input_schema = z.object({
  host: z.string().min(1).max(253),
});

export const runtime_refresh_app_credential_tool: RuntimeToolDefinition<typeof input_schema> = {
  node_key: 'runtime-refresh_app_credential-1',
  node_name: 'refresh_app_credential',
  display_name: 'Refresh app credential',
  description:
    'Brings a connected app credential up to date and re-attaches it to this sandbox. Use this when a request to a connected app stops authenticating, for example a 401 or 403. Name the host you were calling. It signs in again when that app needs it and simply re-attaches when it does not, so you do not need to know which kind of credential it is. You never see the credential, and you cannot refresh an app this workspace has not connected.',
  category: 'context',
  input_schema: {
    type: 'object',
    properties: {
      host: {
        type: 'string',
        description:
          'The host whose request stopped authenticating, for example www.example.com. No scheme and no path.',
      },
    },
    required: ['host'],
  },
  output_schema: {
    type: 'object',
    properties: {
      refreshed: { type: 'boolean' },
      host: { type: 'string' },
      message: { type: 'string' },
      exchanged: { type: 'boolean' },
      retry_allowed_after_time: { type: 'string' },
      hosts_now_authenticated: { type: 'array', items: { type: 'string' } },
      attached_to_the_wrong_sandbox: { type: 'boolean' },
    },
    required: ['refreshed', 'host', 'message', 'exchanged'],
  },
  app_name: 'runtime',
  required_connection: false,
  runtime_handler: 'runtime.refresh_app_credential',
  approval_policy: { mode: 'none' },
  metadata: { safe_for_first_milestone: true },
  validate_input: input_schema,
  async execute(input, context) {
    if (!context) {
      return {
        success: false,
        error: {
          code: 'runtime_context_unavailable',
          message: 'runtime-refresh_app_credential-1 requires a runtime execution context.',
        },
      };
    }

    const connection_id = await find_the_one_connection(context, input.host);
    if (typeof connection_id !== 'string') return connection_id;

    const report = await exchange_credential_for_connection({
      db: context.db,
      workspace_id: context.workspace_id,
      connection_id,
    });

    const reattached = await reattach_to_this_sandbox(context);
    const exchange = describe_the_exchange(report);

    const for_the_agent = reattached.for_the_agent.attached_to_the_wrong_sandbox
      ? {
          host: input.host,
          ...exchange,
          ...reattached.for_the_agent,
          refreshed: false,
          message:
            'The credential was renewed but could not be attached to the machine running this session, so your request will not see it. This is a fault on our side, not a problem with the saved credential. Say so and move on to other work rather than retrying.',
        }
      : { host: input.host, ...exchange, ...reattached.for_the_agent };

    return {
      success: true,
      data: { ...for_the_agent, ...reattached.for_diagnostics },
      model_visible_data: for_the_agent,
    };
  },
};

type ToolFailure = { success: false; error: { code: string; message: string } };

async function find_the_one_connection(
  context: RuntimeToolExecutionContext,
  host: string,
): Promise<string | ToolFailure> {
  const candidates = await find_connections_serving_host(context.db, {
    workspace_id: context.workspace_id,
    host,
  });
  if (candidates.length === 0) return no_connection_failure(host);

  const best = narrow_to_best_candidates(candidates);
  if (best.length === 0) {
    return {
      success: false,
      error: {
        code: 'connection_cannot_be_refreshed',
        message: `The connection for ${host} stores its credential as entered and has no sign-in to repeat, so refreshing cannot fix this. The saved value itself needs replacing.`,
      },
    };
  }
  if (best.length > 1) {
    return {
      success: false,
      error: {
        code: 'more_than_one_connection_for_host',
        message: `${best.length} connections are set up for ${host}, so it is not clear which account to refresh. A person needs to say which one, or disconnect the others.`,
      },
    };
  }
  return best[0]?.connection_id as string;
}

function narrow_to_best_candidates(
  candidates: readonly ConnectionServingHost[],
): ConnectionServingHost[] {
  const delivering = candidates.filter((candidate) => candidate.delivers_to_host);
  if (delivering.length > 0) return delivering;
  return candidates.filter((candidate) => candidate.can_sign_in);
}

function no_connection_failure(host: string): ToolFailure {
  return {
    success: false,
    error: {
      code: 'no_connection_for_host',
      message: `This workspace has no active connection for ${host}. Ask the person you are working with to connect it.`,
    },
  };
}

function describe_the_exchange(report: CredentialExchangeReport) {
  if (report.exchanged) {
    return { refreshed: true, exchanged: true, message: 'Signed in again. Retry your request.' };
  }
  if (report.outcome === 'nothing_to_exchange') {
    return {
      refreshed: true,
      exchanged: false,
      message: 'That credential is used as entered and has been re-attached. Retry your request.',
    };
  }
  return {
    refreshed: false,
    exchanged: false,
    message: report.message,
    ...(report.retry_allowed_after_time
      ? { retry_allowed_after_time: report.retry_allowed_after_time }
      : {}),
  };
}

type ReattachResult = {
  for_the_agent: { hosts_now_authenticated?: string[]; attached_to_the_wrong_sandbox?: boolean };
  for_diagnostics: {
    attached_to_sandbox?: string;
    serving_this_session?: string;
    could_not_confirm_sandbox?: string;
  };
};

async function reattach_to_this_sandbox(
  context: RuntimeToolExecutionContext,
): Promise<ReattachResult> {
  const metadata = context.environment?.metadata as Record<string, unknown> | undefined;
  const provider_sandbox_id = metadata?.provider_sandbox_id;
  if (metadata?.environment_provider !== 'e2b' || typeof provider_sandbox_id !== 'string') {
    return { for_the_agent: {}, for_diagnostics: {} };
  }

  const identity = await read_sandbox_id_from_inside(context);
  const attached_to_the_wrong_sandbox =
    identity.asked && identity.sandbox_id !== provider_sandbox_id;

  if (attached_to_the_wrong_sandbox) {
    logger.warn(
      `credential refresh is attaching to sandbox ${provider_sandbox_id} but this session runs on ${identity.asked ? identity.sandbox_id : 'unknown'}; the workload will not see the refreshed credential`,
    );
  }
  if (!identity.asked) {
    logger.warn(
      `could not confirm which sandbox serves this session before attaching to ${provider_sandbox_id}: ${identity.because}`,
    );
  }

  const { hosts, network_reconfigured } = await attach_credentials_to_running_sandbox({
    db: context.db,
    workspace_id: context.workspace_id,
    provider_sandbox_id,
  });
  return {
    for_the_agent: {
      hosts_now_authenticated: hosts,
      ...(network_reconfigured
        ? {
            browser_note:
              'The sandbox network was reconfigured, which reset open connections. If a browser page was open, re-open it (`browser open <url>`) before retrying browser commands.',
          }
        : {}),
      ...(attached_to_the_wrong_sandbox ? { attached_to_the_wrong_sandbox: true } : {}),
    },
    for_diagnostics: {
      attached_to_sandbox: provider_sandbox_id,
      ...(identity.asked
        ? { serving_this_session: identity.sandbox_id }
        : { could_not_confirm_sandbox: identity.because }),
    },
  };
}

type SandboxIdentityCheck = { asked: true; sandbox_id: string } | { asked: false; because: string };

async function read_sandbox_id_from_inside(
  context: RuntimeToolExecutionContext,
): Promise<SandboxIdentityCheck> {
  const exec = context.environment?.exec;
  if (!exec) return { asked: false, because: 'this session cannot run commands' };
  try {
    const result = await exec({
      command: 'printenv',
      args: ['E2B_SANDBOX_ID'],
      timeout_ms: 10_000,
    });
    const reported_id = result.stdout.trim();
    if (reported_id === '') {
      return { asked: false, because: `E2B_SANDBOX_ID was empty (exit ${result.exit_code})` };
    }
    return { asked: true, sandbox_id: reported_id };
  } catch (error) {
    return {
      asked: false,
      because: format_error_message(error),
    };
  }
}
