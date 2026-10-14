import { default_project_display_name, local_app_origin } from '@coworker/config/constants';

export const production_app_origin = local_app_origin;
export const marketing_site_origin = local_app_origin;
export const public_api_origin = 'http://localhost:3001';
export const public_api_docs_url =
  'https://github.com/alfera-labs/company-use/blob/main/SELF_HOSTING.md#use-it-from-your-own-code';
export const sandbox_preview_base_domain = 'sandboxes.localhost';
export const notifications_reply_to_email = 'notifications@example.com';
export const notifications_from_email = `${default_project_display_name} <${notifications_reply_to_email}>`;
export const image_search_user_agent = `${default_project_display_name}Coworker/1.0 image-search`;
export const logo_dev_publishable_token = '';
export const alfera_cloud_sign_up_url = 'https://app.alfera.ai/sign-up?from=self-host';
export const connect_your_apps_guide_url =
  'https://github.com/alfera-labs/company-use/blob/main/SELF_HOSTING.md#connect-your-apps';
export const app_event_automations_guide_url =
  'https://github.com/alfera-labs/company-use/blob/main/SELF_HOSTING.md#an-automation-that-starts-on-an-app-event';
export const slack_guide_url =
  'https://github.com/alfera-labs/company-use/blob/main/SELF_HOSTING.md#alfera-inside-your-slack';
export const email_guide_url =
  'https://github.com/alfera-labs/company-use/blob/main/SELF_HOSTING.md#alfera-by-email';
export const terms_and_privacy_urls: { terms: string; privacy: string } | null = null;
export const model_catalog_refreshes_by_default = false;
export const model_provider_logo_base_url = '';
