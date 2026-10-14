import type { ComposioRecipe } from '@connectors/composio/composio_recipe_types';
import { composio_asana_recipe } from '@connectors/composio/recipes/composio_asana';
import { composio_linear_recipe } from '@connectors/composio/recipes/composio_linear';
import { composio_microsoft_teams_recipe } from '@connectors/composio/recipes/composio_microsoft_teams';
import { composio_outlook_recipe } from '@connectors/composio/recipes/composio_outlook';
import { googlecalendar_recipe } from '@connectors/composio/recipes/googlecalendar_recipe';
import { googledrive_recipe } from '@connectors/composio/recipes/googledrive_recipe';
import { one_drive_recipe } from '@connectors/composio/recipes/one_drive_recipe';

export const batch_b_recipes: readonly ComposioRecipe[] = [
  composio_asana_recipe,
  composio_linear_recipe,
  composio_microsoft_teams_recipe,
  composio_outlook_recipe,
  one_drive_recipe,
  googledrive_recipe,
  googlecalendar_recipe,
];
