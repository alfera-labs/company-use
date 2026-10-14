import ts from 'typescript';
import type { RatchetRule, RatchetRuleInput, RatchetViolation } from '@scripts/ratchet/rule_types';
import { data_package_names, is_data_package_specifier } from '@scripts/ratchet/rules/data_package_specifiers';
import { is_source_file_outside_tests } from '@scripts/ratchet/source_scope';
import { find_nodes, start_line_of } from '@scripts/ratchet/syntax_walk';

const guarded_directories = ['apps/api/src/routes/', 'packages/runtime-platform/src/tools/definitions/'];

type ModuleEdge = ts.ImportDeclaration | ts.ExportDeclaration | ts.CallExpression;

function read_specifier_literal(node: ts.Node): ts.Expression | undefined {
  if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) return node.moduleSpecifier;
  if (!ts.isCallExpression(node) || node.expression.kind !== ts.SyntaxKind.ImportKeyword) return undefined;
  return node.arguments[0];
}

function read_specifier(node: ts.Node): string | undefined {
  const literal = read_specifier_literal(node);
  return literal && ts.isStringLiteralLike(literal) ? literal.text : undefined;
}

function is_data_package_edge(node: ts.Node): node is ModuleEdge {
  return is_data_package_specifier(read_specifier(node) ?? '');
}

function list_named_values(elements: ts.NodeArray<ts.ImportSpecifier | ts.ExportSpecifier>): string[] {
  return elements.filter((element) => !element.isTypeOnly).map((element) => element.name.text);
}

function list_import_values(clause: ts.ImportClause | undefined): string[] {
  if (!clause) return ['side-effect import'];
  if (clause.isTypeOnly) return [];
  const bindings = clause.namedBindings;
  const named = bindings && ts.isNamedImports(bindings) ? list_named_values(bindings.elements) : [];
  const namespace = bindings && ts.isNamespaceImport(bindings) ? [`* as ${bindings.name.text}`] : [];
  return [...(clause.name ? [clause.name.text] : []), ...namespace, ...named];
}

function list_value_names(edge: ModuleEdge): string[] {
  if (ts.isCallExpression(edge)) return ['dynamic import()'];
  if (ts.isImportDeclaration(edge)) return list_import_values(edge.importClause);
  if (edge.isTypeOnly) return [];
  const clause = edge.exportClause;
  return clause && ts.isNamedExports(clause) ? list_named_values(clause.elements) : ['export *'];
}

function find_violations({ source_file, source_text }: RatchetRuleInput): RatchetViolation[] {
  if (!data_package_names.some((name) => source_text.includes(name))) return [];
  return find_nodes(source_file, is_data_package_edge).flatMap((edge) =>
    list_value_names(edge).map((name) => ({
      line: start_line_of(edge, source_file),
      message: `imports value \`${name}\` from ${read_specifier(edge)}; call a service instead`,
    })),
  );
}

export const routes_and_tools_use_services_rule: RatchetRule = {
  rule_id: 'routes-and-tools-use-services',
  summary:
    'Files in apps/api/src/routes/** and packages/runtime-platform/src/tools/definitions/** import only types from a data package named in data_package_specifiers.ts (`@coworker/core` and its split successors). Each value name counts once. Test files are exempt.',
  why: 'A route or tool that calls DB helpers skips the lifecycle work a service owns: cloud schedules, audit data, caps. The feature then half-works.',
  how_to_fix:
    'Move the operation into a domain service (apps/api/src/services/<domain> or a runtime-platform service) and call it. Keep `import type` from the data package.',
  applies_to: (file_path) =>
    is_source_file_outside_tests(file_path) && guarded_directories.some((directory) => file_path.startsWith(directory)),
  find_violations,
  self_test_samples: [
    {
      file_path: 'apps/api/src/routes/sample.ts',
      source_text:
        "import { list_apps, type App } from '@coworker/core';\nimport { runs } from '@coworker/core/db/schema';\nimport * as core from '@coworker/core/auth';\nexport { get_run } from '@coworker/core';\nconst m = await import('@coworker/core');\n",
      expected_count: 5,
    },
    {
      file_path: 'apps/api/src/routes/moved_sample.ts',
      source_text:
        "import { find_session } from '@coworker/sessions/queries/sessions';\nimport { require_workspace_membership } from '@coworker/access';\n",
      expected_count: 2,
    },
    {
      file_path: 'packages/runtime-platform/src/tools/definitions/sample.ts',
      source_text:
        "import type { App } from '@coworker/core';\nimport { type Run, type Session } from '@coworker/core/db';\nimport { list_apps } from '@api/services/catalog';\nexport type { App } from '@coworker/core';\nimport { x } from '@coworker/config';\n",
      expected_count: 0,
    },
    { file_path: 'apps/api/src/services/sample.ts', source_text: "import { list_apps } from '@coworker/core';\n", expected_count: 0 },
  ],
};
