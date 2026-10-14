import {
  type OnboardingFirstSessionInput,
  open_onboarding_first_session,
} from '@api/services/onboarding_first_session';
import { find_onboarding_job_that_needs_no_app } from '@api/services/onboarding_jobs_that_need_no_app';
import type { WhatTheFirstChatCanOffer } from '@api/services/onboarding_opening_message';
import { read_what_this_install_has_set_up } from '@api/services/onboarding_snapshot';
import type { Database } from '@coworker/core';
import { sessions } from '@coworker/core/db/schema';
import { create_logger } from '@coworker/shared';
import { web_search_providers } from '@runtime-platform/tools/research';
import { and, asc, eq, ne, sql } from 'drizzle-orm';

const onboarding_log = create_logger('onboarding');

type FirstSessionRequest = Omit<OnboardingFirstSessionInput, 'picked_job' | 'install'> & {
  picked_job_name: string | undefined;
  first_completion: boolean;
};

export async function open_onboarding_first_session_once(
  db: Database,
  input: FirstSessionRequest,
): Promise<string | null> {
  if (!input.first_completion) return find_onboarding_first_session_id(db, input);
  const first_session = {
    ...input,
    picked_job: find_onboarding_job_that_needs_no_app(input.picked_job_name),
    install: read_what_the_first_chat_can_offer(),
  };
  return open_onboarding_first_session(db, first_session).catch((error: unknown) => {
    onboarding_log.error('seeding the first onboarding chat failed', error);
    return null;
  });
}

function read_what_the_first_chat_can_offer(): WhatTheFirstChatCanOffer {
  const install = read_what_this_install_has_set_up();
  return {
    apps_or_a_channel: install.app_provider_configured || install.slack_app_configured,
    web_search: web_search_providers('auto').length > 0,
  };
}

async function find_onboarding_first_session_id(
  db: Database,
  input: { workspace_id: string; user_id: string },
): Promise<string | null> {
  const session = await db.query.sessions.findFirst({
    columns: { session_id: true },
    where: and(
      eq(sessions.workspace_id, input.workspace_id),
      eq(sessions.created_by, input.user_id),
      ne(sessions.session_status, 'deleted'),
      sql`${sessions.source_metadata} -> 'onboarding_scan' IS NOT NULL`,
    ),
    orderBy: [asc(sessions.created_time)],
  });
  return session?.session_id ?? null;
}
