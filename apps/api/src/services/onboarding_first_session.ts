import type { OnboardingJobThatNeedsNoApp } from '@api/services/onboarding_jobs_that_need_no_app';
import {
  opening_message_text,
  picked_job_context,
  type WhatTheFirstChatCanOffer,
} from '@api/services/onboarding_opening_message';
import type { Database } from '@coworker/core';
import type { OnboardingCompanyScan } from '@coworker/core/db/queries/onboarding';
import { open_personal_project } from '@coworker/core/db/queries/personal_projects';
import {
  create_run,
  create_run_message,
  create_session,
  update_run_status,
} from '@coworker/core/db/queries/sessions';
import { get_user } from '@coworker/core/db/queries/users';

export type OnboardingFirstSessionInput = {
  workspace_id: string;
  agent_id: string;
  user_id: string;
  company_scan: OnboardingCompanyScan | null;
  picked_job: OnboardingJobThatNeedsNoApp | null;
  install: WhatTheFirstChatCanOffer;
};

type FirstSessionMessage = {
  text: string;
  marked_as: string;
  is_user_visible: boolean;
};

export async function open_onboarding_first_session(
  db: Database,
  input: OnboardingFirstSessionInput,
): Promise<string | null> {
  const scan = input.company_scan?.summary.trim() ? input.company_scan : null;
  const offers = scan?.findings.length ? scan.findings : null;

  const company_name = scan?.company_name.trim() || null;
  const user = await get_user(db, input.user_id);
  const project = await open_personal_project(db, {
    workspace_id: input.workspace_id,
    user_id: input.user_id,
  });
  const session = await create_session(db, {
    workspace_id: input.workspace_id,
    agent_id: input.agent_id,
    project_id: project.project_id,
    session_title: company_name ? `Getting started with ${company_name}` : 'Getting started',
    source_metadata: { onboarding_scan: { company_name, findings: offers ?? [] } },
    actor_id: input.user_id,
  });

  const run = await create_run(db, {
    workspace_id: input.workspace_id,
    session_id: session.session_id,
    agent_id: input.agent_id,
    trigger_type: 'api',
    run_metadata: { source: 'onboarding_first_session' },
    actor_id: input.user_id,
  });
  await update_run_status(db, {
    run_id: run.run_id,
    run_status: 'completed',
    actor_id: input.user_id,
  });

  const brief = scan ? welcome_brief(scan) : null;
  const context = scan ? offered_work_context(scan) : null;
  const picked_job = scan ? null : input.picked_job;
  const opening = opening_message_text({
    first_name: user?.first_name?.trim() || null,
    company_name,
    summary: scan?.summary ?? null,
    has_offers: Boolean(offers),
    has_brief: Boolean(brief),
    picked_job,
    install: input.install,
  });
  const write = (message: FirstSessionMessage) =>
    create_run_message(db, {
      workspace_id: input.workspace_id,
      session_id: session.session_id,
      run_id: run.run_id,
      message_role: 'assistant',
      message_content: { type: 'text', text: message.text },
      source_type: 'runtime',
      source_metadata: { [message.marked_as]: true },
      is_user_visible: message.is_user_visible,
      is_model_visible: true,
      actor_id: input.user_id,
    });
  if (context) await write(model_only_message(context, 'onboarding_offered_work'));
  if (picked_job) {
    await write(model_only_message(picked_job_context(picked_job), 'onboarding_picked_job'));
  }
  await write({ text: opening, marked_as: 'onboarding_first_message', is_user_visible: true });
  if (brief) {
    await write({ text: brief, marked_as: 'onboarding_welcome_brief', is_user_visible: true });
  }

  return session.session_id;
}

function model_only_message(text: string, marked_as: string): FirstSessionMessage {
  return { text, marked_as, is_user_visible: false };
}

function welcome_brief(scan: OnboardingCompanyScan): string | null {
  const facts = scan.scan_facts.filter((fact) => fact.trim());
  if (!facts.length) return null;

  const company = scan.company_name.trim();
  const diagnosis = scan.findings[0]?.title.trim();

  return [
    `**${company ? `${company}: what stood out` : 'What stood out'}**`,
    ...(diagnosis ? ['', end_with_stop(diagnosis)] : []),
    '',
    ...facts.map((fact) => `- ${fact}`),
  ].join('\n');
}

function end_with_stop(text: string): string {
  return /[.!?]$/u.test(text) ? text : `${text}.`;
}

function offered_work_context(scan: OnboardingCompanyScan) {
  const offers = scan.findings.map((finding, index) =>
    [
      `${index + 1}. ${finding.offer ?? finding.title}`,
      `   What I offered: ${finding.body}`,
      ...(finding.steps?.length ? [`   The steps I showed them: ${finding.steps.join('; ')}`] : []),
      `   Start it by doing exactly this: ${finding.prompt}`,
    ].join('\n'),
  );

  const facts = scan.scan_facts.length
    ? ['What you found:', ...scan.scan_facts.map((fact) => `- ${fact}`), '']
    : [];

  return [
    'Context for you only. The user cannot see this message.',
    '',
    `You researched ${scan.company_name || 'this company'} before this conversation opened.`,
    '',
    ...facts,
    ...(scan.gaps?.length
      ? ['What you looked for and could not find:', ...scan.gaps.map((gap) => `- ${gap}`), '']
      : []),
    ...(offers.length
      ? [
          'The work you offered them, shown as cards under your greeting:',
          ...offers,
          '',
          'If they agree without naming one, start the first job immediately and do the work.',
          'Never ask them to repeat, paste or describe an offer you made: you have it above.',
        ]
      : ['You offered no specific work, so take whatever they ask for from here.']),
    '',
    'Ask only for something genuinely private that no public source could give you, and only',
    'after you have done the part you can already do.',
  ].join('\n');
}
