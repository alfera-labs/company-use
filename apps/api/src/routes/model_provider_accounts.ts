import type { ApiEnv } from '@api/lib/context';
import { ok } from '@api/lib/response';
import { validate_json } from '@api/lib/validate';
import { model_provider_connection_routes } from '@api/routes/model_provider_connections';
import { check_pasted_model_key } from '@api/services/models/check_pasted_model_key';
import { require_paid_plan } from '@api/services/paywall';
import { authorize_model_provider_account_administration } from '@api/services/workspace_admin_access';
import { selectable_model_billing_sources } from '@coworker/config/plans';
import {
  read_model_billing,
  write_model_billing_preference,
} from '@coworker/core/db/queries/model_billing_source';
import {
  delete_model_provider_account,
  type ModelProviderAccount,
  upsert_model_provider_account,
} from '@coworker/core/db/queries/model_provider_accounts';
import { save_model_provider_oauth_tokens } from '@coworker/core/db/queries/model_provider_oauth_tokens';
import {
  find_model_provider_account_slot,
  type ModelProviderAccountSlot,
} from '@coworker/core/integrations/model_provider_account_slots';
import {
  chatgpt_device_verification_url,
  find_approved_chatgpt_authorization,
  start_chatgpt_device_authorization,
} from '@coworker/runtime-platform';
import { NotFoundError, ValidationError } from '@coworker/shared';
import {
  assert_chatgpt_device_claim,
  sign_chatgpt_device_claim,
} from '@runtime-platform/chatgpt_device_claim';
import { type Context, Hono } from 'hono';
import { z } from 'zod';

const put_model_provider_account_schema = z.object({ api_key: z.string().trim().min(20) }).strict();

const billing_source_schema = z
  .object({ source: z.enum(selectable_model_billing_sources) })
  .strict();

const finish_chatgpt_connect_schema = z
  .object({
    device_auth_id: z.string().trim().min(1),
    user_code: z.string().trim().min(1),
    claim: z.string().trim().min(1),
  })
  .strict();

export const model_provider_account_routes = new Hono<ApiEnv>()
  .route('/', model_provider_connection_routes)
  .get('/v1/workspace/model-provider-accounts', async (c) => {
    const { accounts, billing_preference, billing_source } = await read_model_billing(
      c.get('db'),
      c.get('workspace_id'),
    );
    return c.json(
      ok({ accounts: accounts.map(public_account), billing_preference, billing_source }),
    );
  })
  .put(
    '/v1/workspace/model-provider-accounts/billing-source',
    validate_json(billing_source_schema),
    async (c) => {
      await authorize_model_provider_administration(c);
      await write_model_billing_preference(c.get('db'), {
        workspace_id: c.get('workspace_id'),
        source: c.req.valid('json').source,
        actor_id: c.get('user_id'),
      });
      return c.json(ok({ source: c.req.valid('json').source }));
    },
  )
  .put(
    '/v1/workspace/model-provider-accounts/:provider_slot',
    validate_json(put_model_provider_account_schema),
    async (c) => {
      const provider_slot = await authorize_slot_administration(c);
      await require_paid_plan(c.get('db'), c.get('workspace_id'), 'Bringing your own AI');
      const { api_key } = c.req.valid('json');
      await check_pasted_model_key({ provider_slot, api_key });

      const account = await upsert_model_provider_account(c.get('db'), {
        workspace_id: c.get('workspace_id'),
        provider_slot,
        api_key,
        actor_id: c.get('user_id'),
      });
      return c.json(ok(public_account(account)));
    },
  )
  .post('/v1/workspace/model-provider-accounts/chatgpt/start-connect', async (c) => {
    await authorize_model_provider_administration(c);
    await require_paid_plan(c.get('db'), c.get('workspace_id'), 'Bringing your own AI');
    const device = await start_chatgpt_device_authorization();
    return c.json(
      ok({
        device_auth_id: device.device_auth_id,
        user_code: device.user_code,
        claim: sign_chatgpt_device_claim({
          device_auth_id: device.device_auth_id,
          user_code: device.user_code,
          workspace_id: c.get('workspace_id'),
        }),
        interval_seconds: device.interval_seconds,
        expires_time: device.expires_time,
        verification_url: chatgpt_device_verification_url,
      }),
    );
  })
  .post(
    '/v1/workspace/model-provider-accounts/chatgpt/finish-connect',
    validate_json(finish_chatgpt_connect_schema),
    async (c) => {
      await authorize_model_provider_administration(c);
      const finish = c.req.valid('json');
      assert_chatgpt_device_claim({ ...finish, workspace_id: c.get('workspace_id') });
      const tokens = await find_approved_chatgpt_authorization(finish);
      if (!tokens) return c.json(ok({ approved: false }));

      const account = await save_model_provider_oauth_tokens(c.get('db'), {
        workspace_id: c.get('workspace_id'),
        provider_slot: 'chatgpt',
        tokens,
        account_id: tokens.chatgpt_account_id,
        actor_id: c.get('user_id'),
      });
      return c.json(ok({ approved: true, account: public_account(account) }));
    },
  )
  .delete('/v1/workspace/model-provider-accounts/:provider_slot', async (c) => {
    const provider_slot = await authorize_slot_administration(c);
    const deleted = await delete_model_provider_account(c.get('db'), {
      workspace_id: c.get('workspace_id'),
      provider_slot,
    });
    if (!deleted) throw new NotFoundError('Model provider account');
    return c.json(ok({ provider_slot }));
  });

function authorize_model_provider_administration(c: Context<ApiEnv>) {
  return authorize_model_provider_account_administration(c.get('db'), {
    workspace_id: c.get('workspace_id'),
    user_id: c.get('user_id'),
  });
}

async function authorize_slot_administration(
  c: Context<ApiEnv>,
): Promise<ModelProviderAccountSlot> {
  await authorize_model_provider_administration(c);

  const provider_slot = find_model_provider_account_slot(c.req.param('provider_slot') ?? '');
  if (!provider_slot) throw new ValidationError('Unknown model provider slot');
  return provider_slot;
}

function public_account(account: ModelProviderAccount) {
  return {
    provider_slot: account.provider_slot,
    display_name: account.display_name,
    secret_hint: account.secret_hint,
    credential_status: account.credential_status,
    last_validated_time: account.last_validated_time?.toISOString() ?? null,
    error_message: account.error_message,
  };
}
