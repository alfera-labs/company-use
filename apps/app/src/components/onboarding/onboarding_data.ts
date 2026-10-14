import type { CompanyScan } from '@/lib/api/company_scan';

export type OnboardingStepKey =
  | 'company'
  | 'scan'
  | 'reveal'
  | 'slack'
  | 'channels'
  | 'connect_apps'
  | 'go';

export const onboarding_steps: { key: OnboardingStepKey }[] = [
  { key: 'company' },
  { key: 'scan' },
  { key: 'reveal' },
  { key: 'slack' },
  { key: 'channels' },
  { key: 'connect_apps' },
  { key: 'go' },
];

export function step_index_of(key: OnboardingStepKey) {
  return onboarding_steps.findIndex((step) => step.key === key);
}

export function step_index_for(snapshot: {
  step: string | null;
  company_scan: CompanyScan | null;
}) {
  if (snapshot.step === 'free_trial') return step_index_of('slack');
  const persisted = onboarding_steps.findIndex((step) => step.key === snapshot.step);
  if (persisted < 0) return 0;
  if (onboarding_steps[persisted]?.key === 'scan') {
    return snapshot.company_scan ? step_index_of('reveal') : 0;
  }
  return persisted;
}

export function company_name_from_domain(email_domain: string) {
  const label = email_domain.split('.')[0] ?? email_domain;
  return label
    .split(/[-_]/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}
