import { onboarding_jobs_that_need_no_app } from '@api/services/onboarding_jobs_that_need_no_app';
import { opening_message_text } from '@api/services/onboarding_opening_message';
import { describe, expect, it } from 'vitest';

const no_scan = {
  first_name: 'ada',
  company_name: null,
  summary: null,
  has_offers: false,
  has_brief: false,
  picked_job: null,
};

function second_paragraph(text: string) {
  return text.split('\n\n')[1];
}

describe('the first message of the chat onboarding lands in', () => {
  it('offers work in apps and channels when the install has one of them', () => {
    const text = opening_message_text({
      ...no_scan,
      install: { apps_or_a_channel: true, web_search: false },
    });

    expect(text.startsWith("Hey Ada! I'm your new coworker.")).toBe(true);
    expect(second_paragraph(text)).toContain('follow-ups, inbox triage');
  });

  it('names no app work on an install with a model key alone', () => {
    const text = opening_message_text({
      ...no_scan,
      install: { apps_or_a_channel: false, web_search: false },
    });

    expect(second_paragraph(text)).toBe(
      'Reports from the files in your workspace folder, commands in my own sandbox, jobs that run on a schedule. That is the work I can take on this install today, with no app connected.',
    );
    expect(text).not.toMatch(/inbox|follow-up|research/iu);
  });

  it('adds research on the web when a search provider is set', () => {
    const text = opening_message_text({
      ...no_scan,
      install: { apps_or_a_channel: false, web_search: true },
    });

    expect(second_paragraph(text)).toMatch(/^Research on the web, reports from the files/u);
  });

  it('gives every job that needs no app one question that ends the first message', () => {
    for (const picked_job of onboarding_jobs_that_need_no_app) {
      const text = opening_message_text({
        ...no_scan,
        picked_job,
        install: { apps_or_a_channel: false, web_search: false },
      });

      expect(text.split('\n\n').slice(1)).toEqual([picked_job.offer, picked_job.first_question]);
      expect(picked_job.first_question.endsWith('?')).toBe(true);
    }
  });
});
