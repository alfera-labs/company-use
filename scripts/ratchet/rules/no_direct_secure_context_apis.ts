import type { RatchetRule, RatchetRuleInput } from '@scripts/ratchet/rule_types';
import { is_source_file_outside_tests } from '@scripts/ratchet/source_scope';

const secure_context_api_pattern = /crypto\??\.randomUUID|crypto\??\.subtle|navigator\.clipboard|navigator\.serviceWorker|\bClipboardItem\b/gu;
const browser_source_roots = ['apps/app/src/', 'packages/ui/src/', 'packages/shared/src/', 'packages/config/src/'];
const helper_files = new Set(['apps/app/src/lib/random_id.ts', 'apps/app/src/lib/copy_text.ts', 'apps/app/src/lib/file_content_version.ts']);

function is_browser_source_outside_the_helpers(file_path: string): boolean {
  if (!is_source_file_outside_tests(file_path) || helper_files.has(file_path)) return false;
  return browser_source_roots.some((root) => file_path.startsWith(root));
}

function find_violations({ source_text }: RatchetRuleInput) {
  return source_text.split('\n').flatMap((line, index) =>
    [...line.matchAll(secure_context_api_pattern)].map((match) => ({ line: index + 1, message: `direct use of "${match[0]}"` })),
  );
}

export const no_direct_secure_context_apis_rule: RatchetRule = {
  rule_id: 'no-direct-secure-context-apis',
  summary:
    'No `crypto.randomUUID`, `crypto.subtle`, `navigator.clipboard`, `ClipboardItem` or `navigator.serviceWorker` in apps/app/src, packages/ui/src and the two packages the browser also loads (packages/shared/src, packages/config/src), outside the three helpers in apps/app/src/lib. Text match, so strings and comments count too.',
  why: 'A browser offers these APIs only on https and on localhost. A self-hosted install is often on plain http at a network address. There the API is undefined, the call throws, and the feature fails with no message. This rule reads our own source only: a dependency that calls the clipboard itself (the copy button of a code block) is covered by `offer_a_clipboard_on_plain_http`, which client.tsx calls at start, and by its test.',
  how_to_fix:
    'Call the helper: `create_random_id` (lib/random_id.ts), `copy_text` (lib/copy_text.ts), `read_file_content_version` (lib/file_content_version.ts). A feature that truly needs https must say so on the page in one line.',
  applies_to: is_browser_source_outside_the_helpers,
  find_violations,
  self_test_samples: [
    {
      file_path: 'apps/app/src/components/app/sample.tsx',
      source_text: "const id = crypto.randomUUID();\nawait navigator.clipboard.writeText(id);\nawait globalThis.crypto?.subtle.digest('SHA-256', bytes);\n",
      expected_count: 3,
    },
    {
      file_path: 'apps/app/src/components/app/sample.tsx',
      source_text: "const id = create_random_id();\nawait copy_text(id);\nconst bytes = crypto.getRandomValues(new Uint8Array(16));\n",
      expected_count: 0,
    },
    { file_path: 'apps/app/src/lib/random_id.ts', source_text: 'return globalThis.crypto.randomUUID();\n', expected_count: 0 },
    { file_path: 'apps/api/src/sample.ts', source_text: 'const id = crypto.randomUUID();\n', expected_count: 0 },
    { file_path: 'packages/shared/src/sample.ts', source_text: 'const id = crypto.randomUUID();\n', expected_count: 1 },
    { file_path: 'packages/ui/src/sample.tsx', source_text: "await navigator.clipboard.write([new ClipboardItem({ 'text/plain': blob })]);\n", expected_count: 2 },
  ],
};
