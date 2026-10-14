import type { ComposioRecipe } from '@connectors/composio/composio_recipe_types';

export const databricks_recipe: ComposioRecipe = {
  toolkit_slug: 'DATABRICKS',
  prompt: 'Sync Databricks jobs',
  dimensions: [
    {
      key: 'account',
      label: 'Workspace',
      shape: 'flat',
      implicit_single_account: true,
      allow_select_all: true,
    },
  ],
  objects: {
    job: {
      label: 'Job',
      list_items: { node_key: 'databricks-list_jobs-1' },
      scoped_by: { account: null },
      page: { items: { $: 'response.jobs' } },
      strategy: 'relist_diff',
      listing_limit_note:
        'DATABRICKS_LIST_JOBS takes no input, so the sync reads only the first page Databricks returns (20 jobs by default). No active Databricks catalog node pages jobs: jobs_jobs_get pages one job, list_runs pages runs, not jobs. The walk never sweeps, so jobs past the first page are missing and a deleted job stays until the cap is lifted.',
      identity: { $: 'item.job_id' },
      title: { $default: [{ $: 'item.settings.name' }, { $: 'item.job_id' }] },
      content: {
        name: { $: 'item.settings.name' },
        schedule: { $: 'item.settings.schedule.quartz_cron_expression' },
        timezone: { $: 'item.settings.schedule.timezone_id' },
        paused: { $: 'item.settings.schedule.pause_status' },
        tags: { $: 'item.settings.tags' },
        on_failure: { $: 'item.settings.email_notifications.on_failure' },
        creator: { $: 'item.creator_user_name' },
        run_as: { $: 'item.run_as' },
      },
      item_kind: 'job',
      metadata: {
        creator: { $: 'item.creator_user_name' },
        created_time: { $: 'item.created_time' },
      },
      note: 'The connection is one Databricks workspace. The walk relists the first page and diffs by job_id; see listing_limit_note for the 20-job cap.',
    },
  },
};
