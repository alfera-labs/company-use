export type Plan = {
  plan_key: string;
  catalog_slug: string;
  workspace_user_limit: number | null;
  scheduled_task_limit: number | null;
  app_trigger_limit: number | null;
  concurrent_run_limit: number | null;
};

export const default_app_trigger_limit: number | null = null;

function plan_without_limits(plan_key: string): Plan {
  return {
    plan_key,
    catalog_slug: plan_key,
    workspace_user_limit: null,
    scheduled_task_limit: null,
    app_trigger_limit: null,
    concurrent_run_limit: null,
  };
}

export const plans = {
  starter_v2: plan_without_limits('starter_v2'),
  pro_v2: plan_without_limits('pro_v2'),
  pro: plan_without_limits('pro'),
  business: plan_without_limits('business'),
};

export const selectable_model_billing_sources = ['own_account'] as const;
