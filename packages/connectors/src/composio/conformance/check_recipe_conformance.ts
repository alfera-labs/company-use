import type { ComposioRecipe } from '@connectors/composio/composio_recipe_types';
import { check_recipe_dimension } from '@connectors/composio/conformance/check_recipe_dimension';
import { check_recipe_object } from '@connectors/composio/conformance/check_recipe_object';
import type {
  ConformanceProblem,
  NodeLookup,
} from '@connectors/composio/conformance/conformance_types';

export type RecipeConformance = {
  toolkit_slug: string;
  verdict: 'PASS' | 'FAIL' | 'HELD';
  error_count: number;
  warning_count: number;
  problems: ConformanceProblem[];
};

export function check_recipe_conformance(
  recipe: ComposioRecipe,
  lookup: NodeLookup,
): RecipeConformance {
  const implicit_dimension_keys = new Set(
    recipe.dimensions
      .filter((dimension) => dimension.implicit_single_account)
      .map((dimension) => dimension.key),
  );
  const problems = [
    ...recipe.dimensions.flatMap((dimension) =>
      check_recipe_dimension(lookup, recipe.toolkit_slug, dimension),
    ),
    ...Object.entries(recipe.objects).flatMap(([object_key, object]) =>
      check_recipe_object(lookup, recipe.toolkit_slug, object_key, object, implicit_dimension_keys),
    ),
  ];
  const error_count = problems.filter((problem) => problem.level === 'error').length;
  const failing_verdict = error_count > 0 ? 'FAIL' : 'PASS';
  return {
    toolkit_slug: recipe.toolkit_slug,
    verdict: recipe.unavailable_reason ? 'HELD' : failing_verdict,
    error_count,
    warning_count: problems.length - error_count,
    problems,
  };
}

function escape_cell(text: string): string {
  return text.replaceAll('|', '\\|').replaceAll('\n', ' ');
}

function format_problem_row(problem: ConformanceProblem): string {
  const cells = [
    problem.toolkit_slug,
    problem.level,
    `${problem.owner_key}.${problem.role}`,
    problem.node_key,
    problem.field,
    problem.expected,
    problem.actual,
  ];
  return `| ${cells.map(escape_cell).join(' | ')} |`;
}

export function format_conformance_summary(results: readonly RecipeConformance[]): string {
  const rows = results.map(
    (result) =>
      `| ${result.toolkit_slug} | ${result.verdict} | ${result.error_count} | ${result.warning_count} |`,
  );
  return ['| recipe | verdict | errors | warnings |', '| --- | --- | --- | --- |', ...rows].join(
    '\n',
  );
}

export function format_conformance_problems(results: readonly RecipeConformance[]): string {
  const rows = results.flatMap((result) => result.problems.map(format_problem_row));
  return [
    '| recipe | level | owner.role | node key | field | expected | actual |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    ...rows,
  ].join('\n');
}
