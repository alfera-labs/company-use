import type { ComposioRecipe } from '@connectors/composio/composio_recipe_types';
import { canva_recipe } from '@connectors/composio/recipes/canva_recipe';
import { databricks_recipe } from '@connectors/composio/recipes/databricks_recipe';
import { datadog_recipe } from '@connectors/composio/recipes/datadog_recipe';
import { docusign_recipe } from '@connectors/composio/recipes/docusign_recipe';
import { gusto_recipe } from '@connectors/composio/recipes/gusto_recipe';
import { mailchimp_recipe } from '@connectors/composio/recipes/mailchimp_recipe';
import { netsuite_recipe } from '@connectors/composio/recipes/netsuite_recipe';
import { quickbooks_recipe } from '@connectors/composio/recipes/quickbooks_recipe';
import { sentry_recipe } from '@connectors/composio/recipes/sentry_recipe';
import { stripe_recipe } from '@connectors/composio/recipes/stripe_recipe';
import { xero_recipe } from '@connectors/composio/recipes/xero_recipe';

export const batch_c_recipes: readonly ComposioRecipe[] = [
  stripe_recipe,
  quickbooks_recipe,
  xero_recipe,
  gusto_recipe,
  mailchimp_recipe,
  sentry_recipe,
  datadog_recipe,
  canva_recipe,
  docusign_recipe,
  netsuite_recipe,
  databricks_recipe,
];
