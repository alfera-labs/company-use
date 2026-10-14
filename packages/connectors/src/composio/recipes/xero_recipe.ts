import type { ComposioRecipe } from '@connectors/composio/composio_recipe_types';

export const xero_recipe: ComposioRecipe = {
  toolkit_slug: 'XERO',
  prompt: 'Pick the Xero organisations whose invoices to keep in sync.',
  dimensions: [
    {
      key: 'organisations',
      label: 'Organisations',
      shape: 'flat',
      list_scope_options: { node_key: 'xero-get_connections-1' },
      option_items: { $: 'response.connections' },
      option_mapping: {
        id: { $: 'item.tenantId' },
        label: { $default: [{ $: 'item.tenantName' }, { $: 'item.tenantId' }] },
        kind: 'organisation',
      },
      allow_select_all: true,
      prompt: 'Pick the Xero organisations to sync invoices from.',
    },
  ],
  objects: {
    invoice: {
      label: 'Invoice',
      list_items: { node_key: 'xero-list_invoices-1' },
      scoped_by: { organisations: 'tenantId' },
      page: {
        items: { $: 'response.Invoices' },
        cursor_kind: 'page_number',
        cursor_param: 'page',
        first_cursor: 1,
        page_size: 100,
      },
      strategy: 'modified_since',
      cursor: {
        field: { $: 'item.UpdatedDateUTC' },
        param: 'If-Modified-Since',
        marker_format: 'iso_time',
        overlap_minutes: 5,
      },
      identity: { $: 'item.InvoiceID' },
      version_signal: { $: 'item.UpdatedDateUTC' },
      tombstone: { value_of: { $: 'item.Status' }, is_one_of: ['DELETED', 'VOIDED'] },
      title: { $default: [{ $: 'item.InvoiceNumber' }, { $: 'item.InvoiceID' }] },
      content: {
        number: { $: 'item.InvoiceNumber' },
        type: { $: 'item.Type' },
        status: { $: 'item.Status' },
        contact: { $: 'item.Contact.name' },
        reference: { $: 'item.Reference' },
        date: { $: 'item.Date' },
        due_date: { $: 'item.DueDate' },
        currency: { $: 'item.CurrencyCode' },
        total: { $: 'item.Total' },
        amount_due: { $: 'item.AmountDue' },
        lines: {
          $map: {
            from: { $: 'item.LineItems' },
            to: {
              description: { $: 'item.Description' },
              quantity: { $: 'item.Quantity' },
              amount: { $: 'item.LineAmount' },
            },
          },
        },
      },
      item_kind: 'invoice',
      container: { id: { $: 'scope.id' }, path: { $: 'scope.label' } },
      metadata: {
        total: { $: 'item.Total' },
        currency_code: { $: 'item.CurrencyCode' },
        status: { $: 'item.Status' },
        contact_id: { $: 'item.Contact.ContactID' },
        organisation: { $: 'scope.label' },
      },
      note: 'XERO_GET_CONNECTIONS lists the organisations, and each invoice call sends the real tenantId. XERO_LIST_INVOICES returns 100 invoices per page from page 1. The first sync lists every invoice. Later syncs send the watermark as the If-Modified-Since input, five minutes back; UpdatedDateUTC may come as an ISO time or as Xero /Date(ms)/, and the runtime reads both. A DELETED or VOIDED invoice is tombstoned.',
    },
  },
};
