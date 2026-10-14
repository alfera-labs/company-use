import { not_in_this_edition_error } from '@api/lib/not_in_this_edition';
import type { Database } from '@coworker/core';
import type { OnboardingCompanyScan } from '@coworker/core/db/queries/onboarding';

type CompanyScanInput = {
  workspace_id: string;
  actor_id: string;
  website_url?: string | undefined;
  company_description?: string | undefined;
};

type CompanyScanResult =
  | { company_scan: OnboardingCompanyScan }
  | { company_scan: null; reason: 'scan_failed' };

export async function run_company_scan(
  _db: Database,
  _input: CompanyScanInput,
): Promise<CompanyScanResult> {
  throw not_in_this_edition_error();
}
