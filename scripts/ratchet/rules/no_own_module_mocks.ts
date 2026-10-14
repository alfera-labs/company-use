import type { RatchetRule, RatchetRuleInput } from '@scripts/ratchet/rule_types';
import { list_vitest_mock_calls } from '@scripts/ratchet/rules/vitest_mock_calls';
import { is_source_file } from '@scripts/ratchet/source_scope';

const own_module_scopes = [
  '@',
  '@agent-core',
  '@api',
  '@company_brain_marketing',
  '@connectors',
  '@coworker',
  '@marketing',
  '@runtime-platform',
  '@scripts',
  '@shared',
];

const third_party_sdk_adapters: Readonly<Record<string, string>> = {
  '@agent-core/llm_gateway/adapters/pi_ai_adapter': '@earendil-works/pi-ai',
  '@api/lib/sentry': '@sentry/node',
  '@api/lib/stripe_client': 'stripe',
  '@api/lib/workos_client': '@workos-inc/node',
  '@api/services/scheduling/adapters/aws_credentials': '@aws-sdk/credential-providers',
  '@api/services/scheduling/adapters/aws_eventbridge': '@aws-sdk/client-scheduler',
  '@runtime-platform/channels/email/resend_api': 'Resend HTTP API',
  '@runtime-platform/channels/slack/web_api': '@slack/web-api',
  '@runtime-platform/orchestrator/e2b_sandbox_client': 'e2b',
  '@runtime-platform/tools/slack/channels_api': '@slack/web-api',
};

function is_own_module(specifier: string): boolean {
  if (specifier.startsWith('.')) return true;
  return own_module_scopes.some((scope) => specifier === scope || specifier.startsWith(`${scope}/`));
}

function find_violations({ source_file }: RatchetRuleInput) {
  return list_vitest_mock_calls(source_file)
    .filter((mock) => is_own_module(mock.specifier) && !(mock.specifier in third_party_sdk_adapters))
    .map((mock) => ({ line: mock.line, message: `test mocks our own module "${mock.specifier}"` }));
}

export const no_own_module_mocks_rule: RatchetRule = {
  rule_id: 'no-own-module-mocks',
  summary:
    'No `vi.mock` or `vi.doMock` of our own modules (every repo alias, `@/`, and relative paths) in apps/** and packages/**. `@coworker/config` counts as ours. Allowed: the thin third-party SDK adapters in `third_party_sdk_adapters`.',
  why: 'A test that mocks our own code tests its own mocks. It stays green when the real module breaks.',
  how_to_fix:
    'Import the real module and let it call its real collaborators. Mock only at the system edge: a third-party SDK adapter or outgoing HTTP. Set config through the real env schema.',
  applies_to: is_source_file,
  find_violations,
  self_test_samples: [
    {
      file_path: 'packages/runtime-platform/src/__tests__/sample.test.ts',
      source_text:
        "vi.mock('@agent-core/engines/pi');\nvi.mock('@coworker/config');\nvi.doMock('@/lib/api');\nvi.mock('../model_resolver');\nvi.mock(import('@api/services/workspace'));\n",
      expected_count: 5,
    },
    {
      file_path: 'packages/runtime-platform/src/__tests__/sample.test.ts',
      source_text:
        "vi.mock('@api/lib/stripe_client');\nvi.mock('@slack/web-api');\nvi.mock('node:fs');\nvi.mock('@apify/client');\nvi.fn();\n",
      expected_count: 0,
    },
  ],
};
