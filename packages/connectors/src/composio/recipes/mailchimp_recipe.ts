import type { ComposioRecipe } from '@connectors/composio/composio_recipe_types';

export const mailchimp_recipe: ComposioRecipe = {
  toolkit_slug: 'MAILCHIMP',
  prompt: 'Sync Mailchimp campaigns',
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
    campaign: {
      label: 'Campaign',
      list_items: {
        node_key: 'mailchimp-list_campaigns-1',
        input: { status: 'sent', sort_field: 'send_time', sort_dir: 'ASC' },
      },
      scoped_by: { account: null },
      page: {
        items: { $: 'response.campaigns' },
        cursor_kind: 'offset',
        cursor_param: 'offset',
        page_size: 100,
        page_size_param: 'count',
      },
      strategy: 'modified_since',
      cursor: {
        field: { $: 'item.sendTime' },
        param: 'since_send_time',
        marker_format: 'iso_time',
      },
      identity: { $: 'item.id' },
      version_signal: { $: 'item.sendTime' },
      title: {
        $default: [
          { $: 'item.settings.subjectLine' },
          { $: 'item.settings.title' },
          { $: 'item.id' },
        ],
      },
      read_item: {
        node_key: 'mailchimp-get_campaign_content-1',
        input: { campaign_id: { $: 'item.id' } },
        text: { $default: [{ $: 'response.plain_text' }, { $: 'response.archive_html' }] },
      },
      item_kind: 'campaign',
      metadata: {
        status: { $: 'item.status' },
        emails_sent: { $: 'item.emailsSent' },
        list_name: { $: 'item.recipients.listName' },
        send_time: { $: 'item.sendTime' },
      },
      source_url: { $: 'item.archiveUrl' },
      note: 'MAILCHIMP_LIST_CAMPAIGNS lists sent campaigns by send time (offset paging, 100 per page) and MAILCHIMP_GET_CAMPAIGN_CONTENT reads the plain-text body. A sent campaign does not change, so version_signal on sendTime skips the content read for a campaign already stored.',
    },
  },
};
