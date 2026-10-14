import { describe, expect, it } from 'vitest';
import {
  company_name_from_domain,
  onboarding_steps,
  step_index_for,
  step_index_of,
} from '@/components/onboarding/onboarding_data';
import type { CompanyScan } from '@/lib/api/company_scan';

const finished_scan: CompanyScan = {
  company_name: 'Acme Labs',
  summary: 'They sell skincare direct to consumers.',
  scan_facts: ['Shopify store, 214 products'],
  findings: [{ title: 'Rotate the tired creatives', body: 'Six weeks straight.', prompt: 'Do it' }],
  scanned_url: 'https://acme-labs.com',
  scanned_at: '2026-09-02T00:00:00.000Z',
};

describe('onboarding step model', () => {
  it('runs company → scan → reveal → slack → channels → connect_apps → go', () => {
    expect(onboarding_steps.map((step) => step.key)).toEqual([
      'company',
      'scan',
      'reveal',
      'slack',
      'channels',
      'connect_apps',
      'go',
    ]);
  });

  it('resumes on go — the closer only a Slack install reaches', () => {
    expect(step_index_for({ step: 'go', company_scan: finished_scan })).toBe(step_index_of('go'));
  });

  it('resumes on the persisted step', () => {
    expect(step_index_for({ step: 'reveal', company_scan: finished_scan })).toBe(
      step_index_of('reveal'),
    );
  });

  it('resumes a persisted free_trial step onto slack', () => {
    expect(step_index_for({ step: 'free_trial', company_scan: finished_scan })).toBe(
      step_index_of('slack'),
    );
  });

  it('resumes on slack after the Slack OAuth round trip', () => {
    expect(step_index_for({ step: 'slack', company_scan: finished_scan })).toBe(
      step_index_of('slack'),
    );
  });

  it('resumes on channels — the picker the Slack install lands on', () => {
    expect(step_index_for({ step: 'channels', company_scan: finished_scan })).toBe(
      step_index_of('channels'),
    );
  });

  it('resumes on connect_apps after a tool connection opened in another tab', () => {
    expect(step_index_for({ step: 'connect_apps', company_scan: finished_scan })).toBe(
      step_index_of('connect_apps'),
    );
  });

  it('never resumes onto scan — a finished scan lands on its result instead', () => {
    expect(step_index_for({ step: 'scan', company_scan: finished_scan })).toBe(
      step_index_of('reveal'),
    );
  });

  it('never resumes onto scan — an unfinished one asks the question again', () => {
    expect(step_index_for({ step: 'scan', company_scan: null })).toBe(0);
  });

  it('starts at the first step for an unknown or missing persisted step', () => {
    expect(step_index_for({ step: '', company_scan: null })).toBe(0);
    expect(step_index_for({ step: 'connect_slack', company_scan: finished_scan })).toBe(0);
  });
});

describe('company_name_from_domain', () => {
  it('turns a sign-in domain into a name a person recognizes', () => {
    expect(company_name_from_domain('acme-labs.com')).toBe('Acme Labs');
    expect(company_name_from_domain('acme.co.uk')).toBe('Acme');
  });
});
