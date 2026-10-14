import type { OnboardingJobThatNeedsNoApp } from '@api/services/onboarding_jobs_that_need_no_app';

export type WhatTheFirstChatCanOffer = {
  apps_or_a_channel: boolean;
  web_search: boolean;
};

export function opening_message_text(input: {
  first_name: string | null;
  company_name: string | null;
  summary: string | null;
  has_offers: boolean;
  has_brief: boolean;
  picked_job: OnboardingJobThatNeedsNoApp | null;
  install: WhatTheFirstChatCanOffer;
}) {
  const greeting_name = input.first_name ? ` ${capitalize_first_letter(input.first_name)}` : '';
  const company_name = input.company_name?.trim();
  const summary = input.summary?.trim();
  const greeting = `Hey${greeting_name}! I'm your new coworker${company_name ? ` at ${company_name}` : ''}.`;

  if (summary) {
    return [
      greeting,
      `I had a look around while you were signing up. ${summary}`,
      closing_line({ has_brief: input.has_brief, has_offers: input.has_offers }),
    ].join('\n\n');
  }
  if (input.picked_job) {
    return [greeting, input.picked_job.offer, input.picked_job.first_question].join('\n\n');
  }
  return [
    greeting,
    work_to_hand_over(input.install),
    "Tell me what's eating your week and I'll get going. You might be surprised.",
  ].join('\n\n');
}

function work_to_hand_over(install: WhatTheFirstChatCanOffer) {
  if (install.apps_or_a_channel) {
    return 'Research, reports, follow-ups, inbox triage, the spreadsheet nobody wants to touch. Most things you would hand a new hire, you can hand me.';
  }
  const work = [
    ...(install.web_search ? ['research on the web'] : []),
    'reports from the files in your workspace folder',
    'commands in my own sandbox',
    'jobs that run on a schedule',
  ];
  return `${capitalize_first_letter(work.join(', '))}. That is the work I can take on this install today, with no app connected.`;
}

export function picked_job_context(job: OnboardingJobThatNeedsNoApp) {
  return [
    'Context for you only. The user cannot see this message.',
    '',
    `On the first screen they picked this job: ${job.offer}`,
    `The steps you showed them: ${job.steps.join('; ')}`,
    `Your greeting already asked them: ${job.first_question}`,
    '',
    'Their next message is the answer. Never ask them to repeat or describe the job.',
    `Then start it by doing exactly this: ${job.prompt}`,
  ].join('\n');
}

function closing_line(input: { has_brief: boolean; has_offers: boolean }): string {
  if (input.has_brief) {
    return input.has_offers
      ? "I wrote up what I found below. When you've read it, just say the word and I'll get going."
      : "I wrote up what I found below. Tell me what's eating your week and I'll take it from there.";
  }
  return input.has_offers
    ? "Here's what I'd jump on first. Just say the word and I'll get going."
    : "Tell me what's eating your week and I'll get going. You might be surprised.";
}

function capitalize_first_letter(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
