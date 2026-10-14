import type { CatalogApp } from '@/lib/api';
import { app_matches_alias } from '@/lib/catalog_app';

export const suggestion_app_keys = [
  'stripe',
  'hubspot',
  'googlesheets',
  'slack',
  'googleads',
  'metaads',
  'facebookads',
  'gmail',
  'notion',
  'attio',
  'apollo',
  'clay',
  'instantly',
  'linear',
  'quickbooks',
  'googledrive',
  'googleanalytics',
  'googlecalendar',
  'xero',
  'zendesk',
  'dext',
  'github',
  'linkedin',
];

export function select_suggestion_apps(apps: CatalogApp[]): CatalogApp[] {
  return apps.filter((app) => suggestion_app_keys.some((key) => app_matches_alias(app, key)));
}
