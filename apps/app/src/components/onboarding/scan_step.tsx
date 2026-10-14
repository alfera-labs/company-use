import { useQuery } from '@tanstack/react-query';
import { useCallback } from 'react';
import type { CompanyScanRequest } from '@/components/onboarding/company_step';
import { useLeaveStepOnce } from '@/components/onboarding/steps_this_install_offers';
import { type CompanyScan, get_onboarding } from '@/lib/api';
import { query_keys } from '@/lib/api/query_keys';

export function ScanStep({
  onScanned,
}: {
  request: CompanyScanRequest;
  onScanned: (scan: CompanyScan) => void;
}) {
  const { data } = useQuery({ queryKey: query_keys.onboarding(), queryFn: get_onboarding });
  const jobs = data?.install.jobs_that_need_no_app;
  const leave = useCallback(
    () =>
      onScanned({
        company_name: '',
        summary: '',
        scan_facts: [],
        findings: jobs ?? [],
        scanned_url: null,
        scanned_at: new Date().toISOString(),
      }),
    [onScanned, jobs],
  );
  useLeaveStepOnce(jobs !== undefined, leave);
  return null;
}
