import { useCallback } from 'react';
import { useLeaveStepOnce } from '@/components/onboarding/steps_this_install_offers';

export type CompanyScanRequest = { website_url?: string; company_description?: string };

export function CompanyStep({
  onSubmit,
}: {
  emailDomain: string | null;
  onSubmit: (input: CompanyScanRequest) => void;
}) {
  const leave = useCallback(() => onSubmit({}), [onSubmit]);
  useLeaveStepOnce(true, leave);
  return null;
}
