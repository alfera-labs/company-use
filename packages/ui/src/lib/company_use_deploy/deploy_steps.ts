import { aws_quick_create_link } from '@coworker/ui/lib/company_use_deploy/aws_quick_create';
import {
  type DeployProblem,
  DeployStopped,
  describe_problem,
} from '@coworker/ui/lib/company_use_deploy/deploy_problems';
import {
  create_session,
  type DeployChoices,
  type DeploySession,
  forget_session,
  forget_the_secrets_as_setup_opens,
  read_session,
  register_session,
  save_session,
  type TestOverrides,
  with_secrets_kept_for_an_hour,
} from '@coworker/ui/lib/company_use_deploy/deploy_session';
import type { CloudName, ProblemAction } from '@coworker/ui/lib/company_use_deploy/deploy_words';
import { make_the_droplet_after_sign_in } from '@coworker/ui/lib/company_use_deploy/digitalocean_return';
import {
  leave_for_digitalocean,
  take_sign_in_answer_from_the_address,
} from '@coworker/ui/lib/company_use_deploy/digitalocean_sign_in';

export type DeployConfig = {
  digitalocean_client_id: string | null;
  version: string | null;
  aws_template_url: string | null;
  allows_test_overrides: boolean;
  api_origin: string;
};

export type Screen =
  | { name: 'loading' }
  | { name: 'choose' }
  | { name: 'leaving' }
  | { name: 'creating'; session: DeploySession }
  | { name: 'open_aws'; session: DeploySession }
  | { name: 'making'; session: DeploySession }
  | { name: 'opened'; session: DeploySession }
  | { name: 'problem'; problem: DeployProblem; session: DeploySession | null };

export type SetScreen = (screen: Screen) => void;

export function problem_screen_for(
  error: unknown,
  cloud: CloudName,
  session: DeploySession | null,
): Screen {
  if (!(error instanceof DeployStopped)) console.error('[company-use-deploy] stopped', error);
  const stopped = error instanceof DeployStopped ? error : new DeployStopped('unexpected');
  const problem = describe_problem(stopped.reason, cloud, { cloud_words: stopped.cloud_words });
  return { name: 'problem', problem, session };
}

export async function come_back_from_digitalocean(set_screen: SetScreen, client_id: string | null) {
  const answer = take_sign_in_answer_from_the_address();
  const session = read_session();
  if (!answer) return false;
  if (!session) {
    set_screen(problem_screen_for(new DeployStopped('sign_in_lost'), 'digitalocean', null));
    return true;
  }
  const creating: DeploySession = {
    ...with_secrets_kept_for_an_hour(session),
    phase: 'creating',
    started_at: Date.now(),
  };
  save_session(creating);
  set_screen({ name: 'creating', session: creating });
  try {
    if (!client_id) throw new DeployStopped('digitalocean_not_set_up');
    await register_again_before_the_server_is_made(creating);
    const making = await make_the_droplet_after_sign_in(answer, creating, client_id);
    save_session(making);
    set_screen({ name: 'making', session: making });
  } catch (error) {
    set_screen(problem_screen_for(error, 'digitalocean', creating));
  }
  return true;
}

export async function begin_deploy(
  picked: DeployChoices,
  replaces_install_id: string | null,
  context: { config: DeployConfig; test_overrides: TestOverrides | null; set_screen: SetScreen },
) {
  const { config, set_screen } = context;
  if (!window.isSecureContext) {
    return set_screen(problem_screen_for(new DeployStopped('needs_https'), picked.cloud, null));
  }
  const is_digitalocean = picked.cloud === 'digitalocean';
  const client_id = config.digitalocean_client_id;
  const is_ready = is_digitalocean ? client_id : config.aws_template_url;
  if (!is_ready || !config.version) {
    const reason = is_digitalocean ? 'digitalocean_not_set_up' : 'aws_not_set_up';
    return set_screen(problem_screen_for(new DeployStopped(reason), picked.cloud, null));
  }
  const fresh = create_session(picked, {
    version: config.version,
    api_origin: config.api_origin,
    test_overrides: context.test_overrides,
  });
  const session = { ...fresh, replaces_install_id };
  const is_registered = await register_session(session).catch((error: unknown) => {
    console.warn('[company-use-deploy] the start did not reach this site', error);
    return false;
  });
  if (!is_registered) {
    return set_screen(problem_screen_for(new DeployStopped('start_refused'), picked.cloud, null));
  }
  save_session(session);
  if (!is_digitalocean || !client_id) return set_screen({ name: 'open_aws', session });
  set_screen({ name: 'leaving' });
  await leave_for_digitalocean(session, client_id);
}

export async function sign_in_again(
  session: DeploySession,
  client_id: string,
  set_screen: SetScreen,
) {
  set_screen({ name: 'leaving' });
  await leave_for_digitalocean(session, client_id);
}

export type AwsLink = { href: string } | { problem: Screen };

export function read_aws_link(session: DeploySession, template_url: string): AwsLink {
  const time_zone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? '';
  try {
    return { href: aws_quick_create_link(session, template_url, time_zone) };
  } catch (error) {
    return { problem: problem_screen_for(error, 'aws', session) };
  }
}

export function wait_after_aws_opened(session: DeploySession, set_screen: SetScreen) {
  const making: DeploySession = {
    ...with_secrets_kept_for_an_hour(session),
    phase: 'making',
    started_at: Date.now(),
  };
  save_session(making);
  set_screen({ name: 'making', session: making });
  register_again_before_the_server_is_made(making).catch((error: unknown) =>
    console.warn('[company-use-deploy] the start was not renewed', error),
  );
}

async function register_again_before_the_server_is_made(session: DeploySession) {
  if (!(await register_session(session))) throw new DeployStopped('start_refused');
}

export const setup_address_of = (session: DeploySession) =>
  `${session.server_address}/setup#token=${encodeURIComponent(session.setup_token)}`;

export function open_the_new_server(session: DeploySession, address: string) {
  const opened: DeploySession = {
    ...session,
    phase: 'opened',
    server_address: address,
    opened_at: Date.now(),
  };
  forget_the_secrets_as_setup_opens(opened);
  window.location.assign(setup_address_of(opened));
}

export function start_over(set_screen: SetScreen) {
  forget_session();
  set_screen({ name: 'choose' });
}

export function act_on_problem_action(
  action: ProblemAction,
  session: DeploySession | null,
  context: {
    client_id: string | null;
    begin: (replaces_install_id: string | null) => Promise<void>;
    set_screen: SetScreen;
  },
) {
  if (action === 'start_again') return start_over(context.set_screen);
  const { client_id } = context;
  if (action === 'try_again' && session?.cloud === 'digitalocean' && client_id) {
    return sign_in_again(session, client_id, context.set_screen);
  }
  const replaces = action === 'delete_and_start_again' ? (session?.install_id ?? null) : null;
  return context.begin(replaces);
}
