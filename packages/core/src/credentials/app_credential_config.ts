import {
  type CredentialExchangeMethod,
  credential_exchange_method_schema,
} from '@coworker/core/credentials/credential_exchange';
import { separate_publishable_headers } from '@coworker/core/credentials/credential_shaped_header';
import { value_encodings } from '@coworker/core/credentials/credential_value_encodings';
import { z } from 'zod';

const placement_names = [
  'put_it_in_header',
  'put_it_in_the_body_at',
  'put_it_in_the_query_at',
] as const;

export const credential_delivery_rule_schema = z
  .object({
    when_the_request_goes_to: z.string().min(1),
    and_the_path_starts_with: z.string().min(1).optional(),
    take_the_value_from: z.string().min(1),
    encode_the_value_as: z.string().min(1).default('as_is'),
    put_it_in_header: z.string().min(1).optional(),
    put_it_in_the_body_at: z.string().min(1).optional(),
    put_it_in_the_query_at: z.string().min(1).optional(),
    the_body_is: z.enum(['json', 'xml', 'form']).optional(),
    written_as: z.string().min(1).default('{value}'),
    worked_out_by: z.enum(['openapi_spec', 'probe', 'login', 'oauth', 'human_override']),
    last_confirmed_time: z.string().optional(),
  })
  .strict()
  .refine((rule) => placement_names.filter((placement_name) => rule[placement_name]).length === 1, {
    message: 'a rule must say exactly one place the value goes',
  })
  .refine((rule) => Boolean(rule.put_it_in_the_body_at) === Boolean(rule.the_body_is), {
    message: 'a body rule must say whether the body is json, xml or form',
  })
  .superRefine((rule, context) => {
    if (!(rule.encode_the_value_as in value_encodings)) {
      context.addIssue({
        code: 'custom',
        message: `unknown encoding: ${rule.encode_the_value_as}`,
        path: ['encode_the_value_as'],
      });
    }
  });

export type AppCredentialRule = Readonly<z.infer<typeof credential_delivery_rule_schema>>;

const api_protocol_headers_schema = z.record(z.string(), z.string());

export type ApiProtocolHeaders = z.infer<typeof api_protocol_headers_schema>;

export function read_api_protocol_headers_from_exchange_method(
  method: CredentialExchangeMethod,
): ApiProtocolHeaders {
  switch (method.exchange_kind) {
    case 'api_login':
      return separate_publishable_headers(method.recipe.always_send_headers).publishable;
    default: {
      const unsupported: never = method.exchange_kind;
      throw new Error(`unsupported_exchange_kind:${String(unsupported)}`);
    }
  }
}

const app_config_schema = z
  .object({
    add_to_every_request: z.array(credential_delivery_rule_schema).default([]),
    api_protocol_headers: api_protocol_headers_schema.default({}),
    exchange_the_credential_by: credential_exchange_method_schema.optional(),
  })
  .catchall(z.unknown());

export type AppCredentialConfig = z.infer<typeof app_config_schema>;

export function parse_app_config(value: unknown): AppCredentialConfig {
  const result = app_config_schema.safeParse(value);
  if (result.success) {
    return result.data;
  }

  const first_issue = result.error.issues[0];
  const issue_path = first_issue?.path.join('.') || '<root>';
  throw new Error(`invalid_app_config: ${issue_path}: ${first_issue?.message}`);
}
