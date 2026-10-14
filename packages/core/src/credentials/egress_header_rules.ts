import type { AppCredentialRule } from '@coworker/core/credentials/app_credential_config';
import {
  type ValueEncoding,
  value_encodings,
} from '@coworker/core/credentials/credential_value_encodings';
import { render_credential_value } from '@coworker/core/credentials/credential_value_renderer';
import { format_error_message } from '@coworker/shared';

export type CredentialToDeliver = {
  connection_name: string;
  rules: readonly AppCredentialRule[];
  field_values: Readonly<Record<string, string>>;
};

type RuleTheDoorCannotServe = {
  connection_name: string;
  host: string;
  because: string;
};

export type EgressHeaderPlan = {
  headers_by_host: Record<string, Record<string, string>>;
  could_not_be_attached: RuleTheDoorCannotServe[];
};

const reasons_the_door_cannot_serve_a_rule: readonly {
  because: string;
  applies_to: (rule: AppCredentialRule) => boolean;
}[] = [
  {
    because: 'the door rewrites headers only, and this value belongs in the request body',
    applies_to: (rule) => Boolean(rule.put_it_in_the_body_at),
  },
  {
    because: 'the door rewrites headers only, and this value belongs in the query string',
    applies_to: (rule) => Boolean(rule.put_it_in_the_query_at),
  },
  {
    because: 'the door matches on host alone, and this rule only applies under one path',
    applies_to: (rule) => Boolean(rule.and_the_path_starts_with),
  },
  {
    because: 'this value is calculated from the request, which the door cannot show us in advance',
    applies_to: (rule) => is_calculated_from_the_request(rule),
  },
];

function is_calculated_from_the_request(rule: AppCredentialRule): boolean {
  const encodings: Readonly<Record<string, ValueEncoding>> = value_encodings;
  const encoding = encodings[rule.encode_the_value_as];
  return encoding ? encoding.needs.includes('message') : true;
}

export function plan_egress_headers(credentials: readonly CredentialToDeliver[]): EgressHeaderPlan {
  const plan: EgressHeaderPlan = { headers_by_host: {}, could_not_be_attached: [] };
  for (const credential of credentials) {
    for (const rule of credential.rules) {
      attach_one_rule(plan, credential, rule);
    }
  }
  return plan;
}

function attach_one_rule(
  plan: EgressHeaderPlan,
  credential: CredentialToDeliver,
  rule: AppCredentialRule,
): void {
  const host = rule.when_the_request_goes_to;
  const already_attached = plan.headers_by_host[host];
  const verdict = judge_rule_against_the_door(rule, already_attached);

  if (!verdict.serves) {
    plan.could_not_be_attached.push({
      connection_name: credential.connection_name,
      host,
      because: verdict.because,
    });
    return;
  }

  try {
    plan.headers_by_host[host] = {
      ...already_attached,
      [verdict.header_name]: render_credential_value({
        rule,
        field_values: credential.field_values,
      }),
    };
  } catch (error) {
    plan.could_not_be_attached.push({
      connection_name: credential.connection_name,
      host,
      because: format_error_message(error),
    });
  }
}

type DoorVerdict = { serves: true; header_name: string } | { serves: false; because: string };

function judge_rule_against_the_door(
  rule: AppCredentialRule,
  already_attached: Readonly<Record<string, string>> | undefined,
): DoorVerdict {
  const reason = reasons_the_door_cannot_serve_a_rule.find((entry) => entry.applies_to(rule));
  if (reason) return { serves: false, because: reason.because };

  const header_name = rule.put_it_in_header;
  if (!header_name) return { serves: false, because: 'this rule does not say which header to use' };

  if (already_attached?.[header_name] !== undefined) {
    return {
      serves: false,
      because: `another connection already attaches ${header_name} to this host`,
    };
  }
  return { serves: true, header_name };
}
