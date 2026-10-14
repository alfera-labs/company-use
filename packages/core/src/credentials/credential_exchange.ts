import { sign_in_with_api_login } from '@coworker/core/credentials/api_login';
import {
  type ApiLoginRecipe,
  api_login_recipe_schema,
} from '@coworker/core/credentials/api_login_recipe';
import type { CredentialExchangeOutcome } from '@coworker/core/credentials/credential_exchange_state';
import { format_error_message } from '@coworker/shared';
import { z } from 'zod';

export const credential_exchange_method_schema = z.discriminatedUnion('exchange_kind', [
  z
    .object({
      exchange_kind: z.literal('api_login'),
      stop_after_failed_attempts: z.number().int().positive().default(1),
      recipe: api_login_recipe_schema,
    })
    .strict(),
]);

export type CredentialExchangeMethod = z.infer<typeof credential_exchange_method_schema>;

type HeldValues = Readonly<Record<string, string>>;

export type CredentialExchangeResult =
  | {
      exchanged: true;
      deliver_as_headers: Readonly<Record<string, string>>;
      api_protocol_headers: Readonly<Record<string, string>>;
      session_lasts_minutes?: number | undefined;
    }
  | {
      exchanged: false;
      outcome: Exclude<CredentialExchangeOutcome, 'succeeded'>;
      message: string;
      wait_minutes?: number | undefined;
    };

export async function run_credential_exchange(input: {
  method: CredentialExchangeMethod;
  held_values: HeldValues;
  allowed_hosts: readonly string[];
}): Promise<CredentialExchangeResult> {
  try {
    return await run_exchange_method(input.method, input.held_values, input.allowed_hosts);
  } catch (error) {
    return describe_exchange_failure(error);
  }
}

function run_exchange_method(
  method: CredentialExchangeMethod,
  held_values: HeldValues,
  allowed_hosts: readonly string[],
): Promise<CredentialExchangeResult> {
  switch (method.exchange_kind) {
    case 'api_login':
      return run_api_login_exchange(method.recipe, held_values, allowed_hosts);
    default: {
      const unsupported: never = method.exchange_kind;
      throw new Error(`unsupported_exchange_kind:${String(unsupported)}`);
    }
  }
}

async function run_api_login_exchange(
  recipe: ApiLoginRecipe,
  held_values: HeldValues,
  allowed_hosts: readonly string[],
): Promise<CredentialExchangeResult> {
  const result = await sign_in_with_api_login({ recipe, field_values: held_values, allowed_hosts });
  if (!result.signed_in) {
    return {
      exchanged: false,
      outcome: result.outcome,
      message: result.message,
      ...(result.wait_minutes ? { wait_minutes: result.wait_minutes } : {}),
    };
  }
  return {
    exchanged: true,
    deliver_as_headers: result.session_headers,
    api_protocol_headers: result.api_protocol_headers,
    ...(result.session_lasts_minutes
      ? { session_lasts_minutes: result.session_lasts_minutes }
      : {}),
  };
}

const missing_field_prefix = 'credential_field_missing:';

function describe_exchange_failure(error: unknown): CredentialExchangeResult {
  const message = format_error_message(error);
  if (message.startsWith(missing_field_prefix)) {
    return {
      exchanged: false,
      outcome: 'misconfigured',
      message: `This connection is missing ${message.slice(missing_field_prefix.length)}.`,
    };
  }
  return { exchanged: false, outcome: 'unreachable', message: 'We could not reach that site.' };
}
