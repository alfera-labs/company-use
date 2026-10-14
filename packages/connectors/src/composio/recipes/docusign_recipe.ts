import type { ComposioRecipe } from '@connectors/composio/composio_recipe_types';

export const docusign_recipe: ComposioRecipe = {
  toolkit_slug: 'DOCUSIGN',
  app_display_name: 'DocuSign',
  unavailable_reason:
    'The DocuSign catalog (340 active actions) has no action that lists envelopes, such as listing status changes or folder items. Envelope reads need an envelope id, so there is nothing to sync yet.',
  prompt: 'Sync DocuSign envelopes',
  dimensions: [
    {
      key: 'account',
      label: 'Account',
      shape: 'flat',
      implicit_single_account: true,
      allow_select_all: true,
    },
  ],
  objects: {},
};
