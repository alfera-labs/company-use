import { describe, expect, it } from 'vitest';
import { is_onboarding_required_for_app, type OnboardingGateState } from '@/lib/onboarding_gate';

describe('is_onboarding_required_for_app', () => {
  it('fails open when the server snapshot is unavailable', () => {
    expect(is_onboarding_required_for_app(null)).toBe(false);
    expect(is_onboarding_required_for_app(undefined)).toBe(false);
  });

  it('keeps completed workspaces in the app', () => {
    expect(is_onboarding_required_for_app(onboarding_gate_state({ completed: true }))).toBe(false);
  });

  it('requires onboarding until the flow is completed, even with Slack already connected', () => {
    expect(is_onboarding_required_for_app(onboarding_gate_state({ completed: false }))).toBe(true);
  });
});

function onboarding_gate_state(input: { completed: boolean }): OnboardingGateState {
  return { onboarding_completed: input.completed };
}
