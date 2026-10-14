import { check_composio_recipe } from '@connectors/composio/check_composio_recipe';
import type { ComposioRecipe } from '@connectors/composio/composio_recipe_types';
import { batch_a_recipes } from '@connectors/composio/recipes/batch_a_index';
import { batch_b_recipes } from '@connectors/composio/recipes/batch_b_index';
import { batch_c_recipes } from '@connectors/composio/recipes/batch_c_index';
import { gmail_recipe } from '@connectors/composio/recipes/gmail_recipe';

const registered_recipes: readonly ComposioRecipe[] = [
  gmail_recipe,
  ...batch_a_recipes,
  ...batch_b_recipes,
  ...batch_c_recipes,
];

function build_composio_recipe_registry(): Map<string, ComposioRecipe> {
  const recipes = new Map<string, ComposioRecipe>();
  for (const recipe of registered_recipes) {
    check_composio_recipe(recipe);
    if (recipes.has(recipe.toolkit_slug)) {
      throw new Error(`Duplicate composio recipe for toolkit ${recipe.toolkit_slug}`);
    }
    recipes.set(recipe.toolkit_slug, recipe);
  }
  return recipes;
}

const composio_recipe_registry = build_composio_recipe_registry();

export function get_composio_recipe(toolkit_slug: string): ComposioRecipe | undefined {
  return composio_recipe_registry.get(toolkit_slug);
}

export function list_composio_recipes(): readonly ComposioRecipe[] {
  return [...composio_recipe_registry.values()];
}
