import type { ComposioRecipe } from '@connectors/composio/composio_recipe_types';

const sales_transaction_columns =
  "SELECT id, tranid, type, BUILTIN.DF(type) AS type_name, trandate, TO_CHAR(lastmodifieddate, 'YYYY-MM-DD HH24:MI:SS') AS last_modified_time, BUILTIN.DF(status) AS status_name, BUILTIN.DF(entity) AS entity_name, foreigntotal, memo, voided FROM transaction WHERE type IN ('CustInvc', 'SalesOrd', 'Estimate', 'CustCred')";

const sales_transactions_query = `${sales_transaction_columns} ORDER BY id`;

const changed_sales_transactions_query = `${sales_transaction_columns} AND lastmodifieddate >= TO_DATE('{watermark}', 'YYYY-MM-DD') ORDER BY id`;

export const netsuite_recipe: ComposioRecipe = {
  toolkit_slug: 'NETSUITE',
  app_display_name: 'NetSuite',
  prompt: 'Sync NetSuite sales transactions',
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
    transaction: {
      label: 'Sales transaction',
      list_items: {
        node_key: 'netsuite-run_suiteql_query-1',
        input: { q: sales_transactions_query },
      },
      scoped_by: { account: null },
      page: {
        items: { $: 'response.items' },
        cursor_kind: 'offset',
        cursor_param: 'offset',
        page_size: 500,
        page_size_param: 'limit',
        has_more: { $: 'response.hasMore' },
      },
      strategy: 'modified_since',
      cursor: {
        field: { $: 'item.last_modified_time' },
        param: 'q',
        marker_format: 'iso_date',
        overlap_minutes: 1440,
        template: { text: changed_sales_transactions_query, escape: 'sql_quote' },
      },
      identity: { $: 'item.id' },
      version_signal: { $: 'item.last_modified_time' },
      tombstone: { value_of: { $: 'item.voided' }, is_one_of: ['T'] },
      title: { $default: [{ $: 'item.tranid' }, { $: 'item.id' }] },
      content: {
        number: { $: 'item.tranid' },
        type: { $: 'item.type_name' },
        status: { $: 'item.status_name' },
        customer: { $: 'item.entity_name' },
        date: { $: 'item.trandate' },
        total: { $: 'item.foreigntotal' },
        memo: { $: 'item.memo' },
      },
      item_kind: 'sales_transaction',
      metadata: {
        record_type: { $: 'item.type' },
        status: { $: 'item.status_name' },
        last_modified: { $: 'item.last_modified_time' },
      },
      note: 'NETSUITE_LIST_RECORDS returns only id and links, so content would cost one read per record. NETSUITE_RUN_SUITEQL_QUERY returns the selected columns in one call per page of 500, ordered by id for stable offsets. The first sync lists every sales transaction. Later syncs send the watermark day inside the SuiteQL WHERE clause (lastmodifieddate >= TO_DATE(day), quotes doubled), one day back to cover the account time zone; last_modified_time is TO_CHAR in a fixed format so the watermark never depends on the user date preference. SuiteQL rows are open objects, so the column paths are checked against the SELECT list, not the output schema. A voided transaction is tombstoned.',
    },
  },
};
