import type { ComposioRecipe } from '@connectors/composio/composio_recipe_types';

export const stripe_recipe: ComposioRecipe = {
  toolkit_slug: 'STRIPE',
  prompt: 'Sync Stripe invoices',
  dimensions: [
    {
      key: 'account',
      label: 'Account',
      shape: 'flat',
      implicit_single_account: true,
      allow_select_all: true,
    },
  ],
  objects: {
    invoice: {
      label: 'Invoice',
      list_items: { node_key: 'stripe_v2-list_invoices-1' },
      scoped_by: { account: null },
      page: {
        items: { $: 'response.data' },
        cursor_kind: 'last_item',
        cursor_param: 'starting_after',
        next_cursor: { $: 'item.id' },
        has_more: { $: 'response.hasMore' },
        page_size: 100,
        page_size_param: 'limit',
      },
      strategy: 'relist_diff',
      identity: { $: 'item.id' },
      tombstone: { value_of: { $: 'item.status' }, is_one_of: ['void'] },
      title: { $default: [{ $: 'item.number' }, { $: 'item.id' }] },
      content: {
        number: { $: 'item.number' },
        status: { $: 'item.status' },
        customer: { $default: [{ $: 'item.customerName' }, { $: 'item.customerEmail' }] },
        description: { $: 'item.description' },
        currency: { $: 'item.currency' },
        total: { $: 'item.total' },
        amount_due: { $: 'item.amountDue' },
        amount_paid: { $: 'item.amountPaid' },
        due_date: { $: 'item.dueDate' },
        lines: {
          $map: {
            from: { $: 'item.lines.data' },
            to: {
              description: { $: 'item.description' },
              amount: { $: 'item.amount' },
              quantity: { $: 'item.quantity' },
            },
          },
        },
      },
      item_kind: 'invoice',
      metadata: {
        amount_due: { $: 'item.amountDue' },
        currency: { $: 'item.currency' },
        status: { $: 'item.status' },
        customer_email: { $: 'item.customerEmail' },
        created: { $: 'item.created' },
      },
      source_url: { $: 'item.hostedInvoiceUrl' },
      note: 'STRIPE_LIST_INVOICES returns the same invoice fields as STRIPE_SEARCH_INVOICES (camelCase names), 100 per page, and pages by starting_after = the id of the last invoice on the page until hasMore is false. The list is chosen over search because the list reads the live data, while search is eventually consistent (a new or changed invoice can take about a minute, longer during an outage, to appear), has a lower rate limit, and needs a query string. Neither node filters by update time (created only), so the walk relists and diffs by id. A voided invoice is tombstoned.',
    },
  },
};
