export type OnboardingGateState = {
  onboarding_completed: boolean;
};

export function is_onboarding_required_for_app(snapshot: OnboardingGateState | null | undefined) {
  if (!snapshot) return false;
  return !snapshot.onboarding_completed;
}
