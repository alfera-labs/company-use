import {
  automation_conditions_schema,
  automation_run_policy_schema,
  notification_evidence_schema,
  notification_proposed_action_schema,
} from '@coworker/core/db/schema/automation_contracts';
import { describe, expect, it } from 'vitest';

describe('automation and notification contracts', () => {
  it('refuses a notification with no evidence and accepts one with a single reference', () => {
    const empty = { event_ids: [], brain_slugs: [], run_ids: [], message_refs: [] };

    expect(notification_evidence_schema.safeParse(empty).success).toBe(false);
    expect(notification_evidence_schema.safeParse({ ...empty, run_ids: ['run_1'] }).success).toBe(
      true,
    );
  });

  it('refuses fields nobody reads', () => {
    const policy = automation_run_policy_schema.safeParse({
      subject_from: 'thread_id',
      when_a_run_is_already_going: 'wait_for_it_to_finish',
      also_do_this: true,
    });
    const conditions = automation_conditions_schema.safeParse([
      { field: 'from', operation: 'contains_any_of', values: ['@'], invert: true },
    ]);

    expect(policy.success).toBe(false);
    expect(conditions.success).toBe(false);
  });

  it('keeps every proposed action to the one thing it needs', () => {
    expect(notification_proposed_action_schema.safeParse({ kind: 'none' }).success).toBe(true);
    expect(notification_proposed_action_schema.safeParse({ kind: 'open_draft' }).success).toBe(
      false,
    );
    expect(
      notification_proposed_action_schema.safeParse({ kind: 'open_draft', session_id: 'ses_1' })
        .success,
    ).toBe(true);
  });

  it('carries an offer to act with the apps the step needs', () => {
    const offer = notification_proposed_action_schema.safeParse({
      kind: 'offer_to_act',
      instruction: 'check you in for AZ1234 on Friday',
      needs_apps: ['gmail'],
    });
    const without_apps = notification_proposed_action_schema.safeParse({
      kind: 'offer_to_act',
      instruction: "chase Acme's failed 900 EUR payment",
    });

    expect(offer.success && offer.data).toEqual({
      kind: 'offer_to_act',
      instruction: 'check you in for AZ1234 on Friday',
      needs_apps: ['gmail'],
    });
    expect(without_apps.success && without_apps.data).toMatchObject({ needs_apps: [] });
    expect(notification_proposed_action_schema.safeParse({ kind: 'offer_to_act' }).success).toBe(
      false,
    );
  });

  it('names the app it wants connected and what it would do with it', () => {
    expect(
      notification_proposed_action_schema.safeParse({
        kind: 'connect_app',
        app_name: 'Stripe',
        reason: 'chase the payments that fail',
      }).success,
    ).toBe(true);
    expect(
      notification_proposed_action_schema.safeParse({ kind: 'connect_app', app_name: 'Stripe' })
        .success,
    ).toBe(false);
  });

  it('names the automation the review wants changed and the change', () => {
    expect(
      notification_proposed_action_schema.safeParse({
        kind: 'improve_automation',
        automation_id: 'atm_1',
        suggestion: 'stop the judge dropping threads with more than two replies',
      }).success,
    ).toBe(true);
    expect(
      notification_proposed_action_schema.safeParse({
        kind: 'improve_automation',
        automation_id: 'atm_1',
      }).success,
    ).toBe(false);
  });

  it('lets a run policy say it only listens', () => {
    const listening = automation_run_policy_schema.safeParse({
      subject_from: null,
      when_a_run_is_already_going: 'start_another_one',
      listen: true,
    });

    expect(listening.success && listening.data.listen).toBe(true);
  });
});
