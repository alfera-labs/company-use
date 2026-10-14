import type { RatchetRule, RatchetRuleInput } from '@scripts/ratchet/rule_types';
import { is_data_package_specifier } from '@scripts/ratchet/rules/data_package_specifiers';
import { list_vitest_mock_calls } from '@scripts/ratchet/rules/vitest_mock_calls';
import { is_source_file } from '@scripts/ratchet/source_scope';

const postgres_module_pattern = /^postgres(?:\/|$)/u;

function is_database_module(specifier: string): boolean {
  return is_data_package_specifier(specifier) || postgres_module_pattern.test(specifier);
}

function find_violations({ source_file }: RatchetRuleInput) {
  return list_vitest_mock_calls(source_file)
    .filter((mock) => is_database_module(mock.specifier))
    .map((mock) => ({ line: mock.line, message: `test mocks the database module "${mock.specifier}"` }));
}

export const no_mocked_database_rule: RatchetRule = {
  rule_id: 'no-mocked-database',
  summary:
    'No `vi.mock` or `vi.doMock` of a data package named in data_package_specifiers.ts (`@coworker/core` and its split successors such as `@coworker/db`), or of `postgres`, in apps/** and packages/**.',
  why: 'A mocked database hides every real schema, migration, and constraint bug. The test stays green while production breaks.',
  how_to_fix:
    'Run the test against the real worktree database (`bun run db:setup`). Seed rows through the real query helpers and read them back.',
  applies_to: is_source_file,
  find_violations,
  self_test_samples: [
    {
      file_path: 'apps/api/src/services/__tests__/sample.test.ts',
      source_text:
        "vi.mock('@coworker/core', () => ({}));\nvi.doMock('@coworker/core/db/queries/runs');\nvi.mock('postgres');\nvi.mock(import('@coworker/core/db'));\n",
      expected_count: 4,
    },
    {
      file_path: 'apps/api/src/services/__tests__/moved_sample.test.ts',
      source_text:
        "vi.mock('@coworker/db');\nvi.doMock('@coworker/db/schema/sessions');\nvi.mock('@coworker/db-connection');\nvi.mock('@coworker/sessions/queries/sessions');\n",
      expected_count: 4,
    },
    {
      file_path: 'apps/api/src/services/__tests__/sample.test.ts',
      source_text: "vi.mock('@coworker/shared');\nvi.mock('@api/lib/stripe_client');\nvi.mock('postgres-range');\n",
      expected_count: 0,
    },
  ],
};
