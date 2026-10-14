import { existsSync, readFileSync } from 'node:fs';
import { builtinModules } from 'node:module';
import path from 'node:path';
import ts from 'typescript';
import type { RatchetRule, RatchetRuleInput, RatchetViolation } from '@scripts/ratchet/rule_types';
import { import_direction_fixtures } from '@scripts/ratchet/rules/import-direction-fixtures';
import { is_import_direction_allowed } from '@scripts/ratchet/rules/import-direction-graph';
import {
  import_units,
  server_only_entry_specifiers,
  server_only_file_patterns,
  server_only_marker_specifiers,
  server_only_npm_packages,
} from '@scripts/ratchet/rules/import-direction-table';
import { is_source_file, is_test_file } from '@scripts/ratchet/source_scope';
import { find_nodes, line_of_position } from '@scripts/ratchet/syntax_walk';

type ImportEdge = { readonly specifier: string; readonly line: number; readonly type_only: boolean };
type AliasOwner = { readonly alias: string; readonly unit: string };
type FileContext = { readonly unit: string; readonly is_browser_file: boolean; readonly is_test_file: boolean };
type ImportCheck = (context: FileContext, edge: ImportEdge, target_unit: string | undefined) => string | undefined;
type CompilerOptionsWithPaths = { readonly baseUrl?: string; readonly paths?: Readonly<Record<string, readonly string[]>> };

const repo_root = path.resolve(import.meta.dirname, '../../..');
const unit_names = Object.keys(import_units);
const node_builtin_names = new Set(builtinModules);

function to_repo_path(file_path: string): string {
  const relative_path = path.isAbsolute(file_path) ? path.relative(repo_root, file_path) : file_path;
  return relative_path.split(path.sep).join('/');
}

function unit_of_path(repo_path: string): string {
  const [top_directory = '', name = ''] = repo_path.split('/');
  return top_directory === 'apps' || top_directory === 'packages' ? `${top_directory}/${name}` : top_directory;
}

function pattern_matches(pattern: string, specifier: string): boolean {
  const star_index = pattern.indexOf('*');
  if (star_index === -1) return pattern === specifier;
  return specifier.startsWith(pattern.slice(0, star_index)) && specifier.endsWith(pattern.slice(star_index + 1));
}

function read_package_manifest(unit: string): { readonly name?: string } {
  const manifest_path = path.join(repo_root, unit, 'package.json');
  return existsSync(manifest_path) ? JSON.parse(readFileSync(manifest_path, 'utf8')) : {};
}

function read_package_name_owners(unit: string): AliasOwner[] {
  const { name } = read_package_manifest(unit);
  return name ? [{ alias: name, unit }, { alias: `${name}/*`, unit }] : [];
}

function read_tsconfig_alias_owners(tsconfig_repo_path: string): AliasOwner[] {
  const tsconfig_path = path.join(repo_root, tsconfig_repo_path);
  if (!existsSync(tsconfig_path)) return [];
  const { config } = ts.readConfigFile(tsconfig_path, ts.sys.readFile);
  const options: CompilerOptionsWithPaths = config?.compilerOptions ?? {};
  const base_url = path.resolve(path.dirname(tsconfig_path), options.baseUrl ?? '.');
  return Object.entries(options.paths ?? {}).flatMap(([alias, targets]) => {
    const [first_target] = targets;
    if (alias.startsWith('@/') || !first_target) return [];
    return [{ alias, unit: unit_of_path(to_repo_path(path.resolve(base_url, first_target))) }];
  });
}

const alias_owners: readonly AliasOwner[] = [
  ...unit_names.flatMap(read_package_name_owners),
  ...['tsconfig.base.json', ...unit_names.map((unit) => `${unit}/tsconfig.json`)].flatMap(read_tsconfig_alias_owners),
];

function find_target_unit(file_path: string, specifier: string): string | undefined {
  if (specifier.startsWith('.')) return unit_of_path(path.posix.join(path.posix.dirname(file_path), specifier));
  if (specifier.startsWith('@/')) return unit_of_path(file_path);
  return alias_owners.find(({ alias }) => pattern_matches(alias, specifier))?.unit;
}

function is_server_only_specifier(specifier: string, target_unit: string | undefined): boolean {
  if (specifier.startsWith('node:') || node_builtin_names.has(specifier.split('/')[0] ?? '')) return true;
  if (server_only_npm_packages.some((name) => specifier === name || specifier.startsWith(`${name}/`))) return true;
  if (server_only_entry_specifiers.includes(specifier)) return true;
  return target_unit !== undefined && import_units[target_unit]?.ships_to_browser === 'never';
}

function read_specifier_node(node: ts.Node): ts.Expression | undefined {
  if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) return node.moduleSpecifier;
  if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
    return node.moduleReference.expression;
  }
  if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) return node.arguments[0];
  if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) return node.argument.literal;
  return undefined;
}

function every_named_binding_is_type(elements: ts.NodeArray<ts.ImportSpecifier | ts.ExportSpecifier>): boolean {
  return elements.length > 0 && elements.every((element) => element.isTypeOnly);
}

function is_type_only_import(node: ts.Node): boolean {
  if (ts.isImportTypeNode(node)) return true;
  if (ts.isImportEqualsDeclaration(node)) return node.isTypeOnly;
  if (ts.isExportDeclaration(node)) {
    const clause = node.exportClause;
    return node.isTypeOnly || (clause !== undefined && ts.isNamedExports(clause) && every_named_binding_is_type(clause.elements));
  }
  if (!ts.isImportDeclaration(node) || !node.importClause) return false;
  const { isTypeOnly, name, namedBindings } = node.importClause;
  if (isTypeOnly) return true;
  return !name && namedBindings !== undefined && ts.isNamedImports(namedBindings) && every_named_binding_is_type(namedBindings.elements);
}

function read_import_edges(source_file: ts.SourceFile): ImportEdge[] {
  return find_nodes(source_file, (node) => read_specifier_node(node) !== undefined).flatMap((node) => {
    const literal = read_specifier_node(node);
    if (!literal || !ts.isStringLiteralLike(literal)) return [];
    const line = line_of_position(source_file, literal.getStart(source_file));
    return [{ specifier: literal.text, line, type_only: is_type_only_import(node) }];
  });
}

function has_use_client_directive(source_file: ts.SourceFile): boolean {
  const directives = source_file.statements.filter(ts.isExpressionStatement).map((statement) => statement.expression);
  return directives.some((expression) => ts.isStringLiteral(expression) && expression.text === 'use client');
}

function is_server_only_file(file_path: string, edges: readonly ImportEdge[]): boolean {
  if (server_only_file_patterns.some((pattern) => pattern.test(file_path))) return true;
  return edges.some(({ specifier }) => server_only_marker_specifiers.includes(specifier));
}

function is_browser_file(file_path: string, source_file: ts.SourceFile, edges: readonly ImportEdge[]): boolean {
  const unit = unit_of_path(file_path);
  const shipping = import_units[unit]?.ships_to_browser ?? 'never';
  if (shipping === 'never' || is_test_file(file_path) || is_server_only_file(file_path, edges)) return false;
  if (shipping === 'use_client_files_only') return has_use_client_directive(source_file);
  return file_path.startsWith(`${unit}/src/`);
}

const check_layer_direction: ImportCheck = (context, edge, target_unit) => {
  if (!target_unit || target_unit === context.unit) return undefined;
  const check = { type_only: edge.type_only, is_test_file: context.is_test_file };
  if (is_import_direction_allowed(import_units, context.unit, target_unit, check)) return undefined;
  const missing_row = import_units[context.unit] ? '' : ' (the unit has no row in import-direction-table.ts)';
  return `${context.unit} must not import ${target_unit}${missing_row}: "${edge.specifier}"`;
};

const check_browser_reaches_server: ImportCheck = (context, edge, target_unit) => {
  if (!context.is_browser_file || edge.type_only) return undefined;
  if (!is_server_only_specifier(edge.specifier, target_unit)) return undefined;
  return `browser code must not import server-only "${edge.specifier}"`;
};

const import_checks: readonly ImportCheck[] = [check_layer_direction, check_browser_reaches_server];

function find_violations({ file_path, source_file }: RatchetRuleInput): RatchetViolation[] {
  const repo_path = to_repo_path(file_path);
  const edges = read_import_edges(source_file);
  const context = {
    unit: unit_of_path(repo_path),
    is_browser_file: is_browser_file(repo_path, source_file, edges),
    is_test_file: is_test_file(repo_path),
  };
  return edges.flatMap((edge) => {
    const target_unit = find_target_unit(repo_path, edge.specifier);
    const message = import_checks.map((check) => check(context, edge, target_unit)).find(Boolean);
    return message ? [{ line: edge.line, message }] : [];
  });
}

export { import_direction_fixtures };

export const import_direction_rule: RatchetRule = {
  rule_id: 'import-direction',
  summary:
    'Every app and package imports only the units its row in import-direction-table.ts allows, and code that ships to the browser never imports server-only code.',
  why: 'An upward import makes a cycle, and a server import in browser code leaks secrets or breaks the bundle. The import graph holds this rule, not a review comment.',
  how_to_fix:
    'Move the shared code down a layer (pure types and helpers go to packages/shared). In apps/app, put server-only code in a *.server.ts file and call it from a createServerFn handler; TanStack Start keeps *.server.* files out of the client bundle. In Next apps, keep server-only imports out of "use client" files. Change the layer table only with a reviewed design decision.',
  applies_to: is_source_file,
  find_violations,
  self_test_samples: import_direction_fixtures,
};
