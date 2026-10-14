import type { AppCredentialRule } from '@coworker/core/credentials/app_credential_config';
import { apply_value_encoding } from '@coworker/core/credentials/credential_value_encodings';

export function render_credential_value(input: {
  rule: AppCredentialRule;
  field_values: Readonly<Record<string, string>>;
  request_message?: string;
}): string {
  const { field_values, rule } = input;
  const value = field_values[rule.take_the_value_from];
  if (value === undefined) {
    throw new Error(`credential_field_missing:${rule.take_the_value_from}`);
  }

  const encoded_value = apply_value_encoding(rule.encode_the_value_as, {
    value,
    ...(field_values.username === undefined ? {} : { username: field_values.username }),
    ...(field_values.salt === undefined ? {} : { salt: field_values.salt }),
    ...(input.request_message === undefined ? {} : { message: input.request_message }),
    ...(field_values.access_key_id === undefined
      ? {}
      : { access_key_id: field_values.access_key_id }),
    ...(field_values.region === undefined ? {} : { region: field_values.region }),
    ...(field_values.service === undefined ? {} : { service: field_values.service }),
  });
  return rule.written_as.replace('{value}', encoded_value);
}
