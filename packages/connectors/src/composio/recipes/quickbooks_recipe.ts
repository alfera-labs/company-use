import type { ComposioRecipe } from '@connectors/composio/composio_recipe_types';

export const quickbooks_recipe: ComposioRecipe = {
  toolkit_slug: 'QUICKBOOKS',
  app_display_name: 'QuickBooks',
  prompt: 'Sync QuickBooks invoices',
  dimensions: [
    {
      key: 'account',
      label: 'Company',
      shape: 'flat',
      implicit_single_account: true,
      allow_select_all: true,
    },
  ],
  objects: {
    invoice: {
      label: 'Invoice',
      list_items: { node_key: 'quickbooks-query_invoices-1' },
      scoped_by: { account: null },
      page: {
        items: { $: 'response.Invoice' },
        cursor_kind: 'offset',
        cursor_param: 'start_position',
        first_cursor: 1,
        page_size: 100,
        page_size_param: 'max_results',
      },
      strategy: 'modified_since',
      cursor: {
        field: { $: 'item.MetaData.LastUpdatedTime' },
        param: 'query',
        template: { text: "WHERE MetaData.LastUpdatedTime > '{watermark}'", escape: 'sql_quote' },
        overlap_minutes: 5,
      },
      identity: { $: 'item.Id' },
      version_signal: { $: 'item.SyncToken' },
      title: { $default: [{ $: 'item.DocNumber' }, { $: 'item.Id' }] },
      content: {
        number: { $: 'item.DocNumber' },
        customer: { $: 'item.CustomerRef.name' },
        date: { $: 'item.TxnDate' },
        due_date: { $: 'item.DueDate' },
        currency: { $: 'item.CurrencyRef.value' },
        total: { $: 'item.TotalAmt' },
        balance: { $: 'item.Balance' },
        customer_memo: { $: 'item.CustomerMemo.value' },
        private_note: { $: 'item.PrivateNote' },
        lines: {
          $map: {
            from: { $: 'item.Line' },
            to: { description: { $: 'item.Description' }, amount: { $: 'item.Amount' } },
          },
        },
      },
      item_kind: 'invoice',
      metadata: {
        total_amount: { $: 'item.TotalAmt' },
        balance: { $: 'item.Balance' },
        customer: { $: 'item.CustomerRef.name' },
        last_updated: { $: 'item.MetaData.LastUpdatedTime' },
      },
      source_url: { $: 'item.InvoiceLink' },
      note: 'QUICKBOOKS_QUERY_INVOICES returns every invoice field and pages by start_position from 1. The first sync sends no query and lists every invoice. Later syncs send the watermark inside the query clause (WHERE MetaData.LastUpdatedTime > watermark, quotes doubled), so only changed invoices come back. The connection is one QuickBooks company. A voided invoice keeps its row with a zero balance, so nothing is tombstoned. A deleted invoice leaves the query and is not seen by an incremental walk.',
    },
  },
};
