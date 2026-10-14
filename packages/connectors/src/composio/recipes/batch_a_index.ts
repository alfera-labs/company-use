import type { ComposioRecipe } from '@connectors/composio/composio_recipe_types';
import { composio_attio_recipe } from '@connectors/composio/recipes/composio_attio';
import { composio_confluence_recipe } from '@connectors/composio/recipes/composio_confluence';
import { composio_github_recipe } from '@connectors/composio/recipes/composio_github';
import { composio_hubspot_recipe } from '@connectors/composio/recipes/composio_hubspot';
import { composio_jira_recipe } from '@connectors/composio/recipes/composio_jira';
import { composio_notion_recipe } from '@connectors/composio/recipes/composio_notion';
import { composio_salesforce_recipe } from '@connectors/composio/recipes/composio_salesforce';
import { composio_zoho_recipe } from '@connectors/composio/recipes/composio_zoho';

export const batch_a_recipes: readonly ComposioRecipe[] = [
  composio_github_recipe,
  composio_salesforce_recipe,
  composio_hubspot_recipe,
  composio_attio_recipe,
  composio_zoho_recipe,
  composio_notion_recipe,
  composio_jira_recipe,
  composio_confluence_recipe,
];
