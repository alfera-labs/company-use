import type { RatchetRule, RatchetRuleInput } from '@scripts/ratchet/rule_types';

const forbidden_reader_names = [
  'read_string',
  'read_record',
  'read_number',
  'read_boolean',
  'read_string_array',
  'read_trimmed_string',
  'read_text',
  'read_object',
  'read_value',
  'read_field',
  'as_string',
  'as_record',
  'as_number',
  'as_boolean',
  'as_array',
  'as_object',
  'get_record_string',
  'first_string',
  'first_string_array',
  'is_record',
];
const forbidden_module_name = 'unknown_value_readers';
const forbidden_reader_pattern = new RegExp(`\\b(?:${forbidden_reader_names.join('|')})\\b`, 'u');
const scanned_roots = ['apps/', 'packages/', 'scripts/'];
const skipped_directories = new Set(['node_modules', '.next', 'dist', 'coverage']);

function applies_to(file_path: string): boolean {
  if (!scanned_roots.some((root) => file_path.startsWith(root))) return false;
  if (file_path.startsWith('scripts/ratchet/')) return false;
  return !file_path.split('/').some((segment) => skipped_directories.has(segment));
}

function find_violations({ source_text }: RatchetRuleInput) {
  return source_text.split('\n').flatMap((line, index) => {
    const name = line.match(forbidden_reader_pattern)?.[0] ?? (line.includes(forbidden_module_name) ? forbidden_module_name : undefined);
    return name ? [{ line: index + 1, message: `generic unknown-value reader "${name}"` }] : [];
  });
}

export const no_generic_value_readers_rule: RatchetRule = {
  rule_id: 'no-generic-value-readers',
  summary:
    'No generic unknown-value reader helpers (read_string, as_record, is_record, unknown_value_readers, ...) anywhere in apps/**, packages/**, or scripts/**, test files included. Text match, so names in strings and comments count too.',
  why: 'A stack of defensive readers re-probes the same unvalidated object in many places. It is a missing schema parse, not a helper library.',
  how_to_fix: 'Type internal data. Parse unknown input once at the boundary with a strict Zod schema, then read typed fields directly.',
  applies_to,
  find_violations,
  self_test_samples: [
    {
      file_path: 'scripts/sample.ts',
      source_text: "const a = read_string(x);\nimport { b } from '@shared/unknown_value_readers';\nif (is_record(y)) {}\n",
      expected_count: 3,
    },
    {
      file_path: 'apps/api/src/sample.ts',
      source_text: 'const a = read_strings(x);\nconst b = thread_record;\nconst c = schema.parse(y);\n',
      expected_count: 0,
    },
  ],
};
