import {
  type AppCredentialRule,
  credential_delivery_rule_schema,
} from '@coworker/core/credentials/app_credential_config';

export const exchanged_value_prefix = 'from_the_exchange.';

export function generate_exchanged_credential_values(
  headers: Readonly<Record<string, string>>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(headers).map(([header_name, value]) => [
      `${exchanged_value_prefix}${header_name}`,
      value,
    ]),
  );
}

export function generate_delivery_rules_for_exchanged_headers(input: {
  headers: Readonly<Record<string, string>>;
  hosts: readonly string[];
  confirmed_time: Date;
}): AppCredentialRule[] {
  return input.hosts.flatMap((host) =>
    Object.keys(input.headers).map((header_name) =>
      credential_delivery_rule_schema.parse({
        when_the_request_goes_to: host,
        take_the_value_from: `${exchanged_value_prefix}${header_name}`,
        encode_the_value_as: 'as_is',
        put_it_in_header: header_name,
        written_as: '{value}',
        worked_out_by: 'login',
        last_confirmed_time: input.confirmed_time.toISOString(),
      }),
    ),
  );
}

export function drop_rules_from_a_previous_exchange(
  rules: readonly AppCredentialRule[],
): AppCredentialRule[] {
  return rules.filter((rule) => !rule.take_the_value_from.startsWith(exchanged_value_prefix));
}
