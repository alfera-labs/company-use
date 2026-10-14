import type { CloudName, ProblemAction } from '@coworker/ui/lib/company_use_deploy/deploy_words';

const page_problem_sentences = {
  not_authorized: 'DigitalOcean did not let this page make the server.',
  digitalocean_refused: 'DigitalOcean did not make the server.',
  digitalocean_not_reachable:
    'This page could not reach DigitalOcean. Check your internet connection.',
  digitalocean_not_set_up: 'Servers on DigitalOcean cannot be made from this page yet.',
  aws_not_set_up: 'Servers on AWS cannot be made from this page yet.',
  no_region: 'DigitalOcean has no free server of this size right now.',
  start_refused: 'This page could not start your setup.',
  script_not_found: 'This page could not download the setup of your server.',
  sign_in_lost: 'This page lost your DigitalOcean sign-in.',
  setup_link_lost:
    'This page no longer has the setup link of your server. Delete the server in your cloud account, then start again.',
  no_report: 'Your server stopped reporting its progress.',
  install_failed: 'Setup stopped on your server.',
  install_unknown: 'This page no longer has the progress of your server.',
  unexpected: 'Something went wrong on this page.',
  needs_https: 'This page works only at an address that starts with https.',
} as const;

export type PageProblemReason = keyof typeof page_problem_sentences;

export const box_reason_sentences: Record<string, string> = {
  not_enough_memory: 'Your server has too little memory for Alfera.',
  docker_install_failed: 'Your server could not install Docker.',
  source_download_failed: 'Your server could not download Alfera.',
  image_pull_failed: 'Your server could not download Alfera.',
  stack_start_failed: 'Alfera did not start on your server.',
  api_did_not_answer: 'Alfera started on your server but did not answer in time.',
  dashboard_did_not_answer: 'Alfera started on your server but did not answer in time.',
  certificate_not_issued: 'Your server did not get its security certificate.',
  version_not_published: 'This version of Alfera is not published yet.',
  registry_login_failed: 'Your server could not sign in to download Alfera.',
  public_address_not_stable: 'Your server did not get a fixed public address.',
  ssh_password_login_not_closed: 'Your server could not turn off password sign-in.',
  setup_token_not_usable: 'Your server could not keep its setup link safe.',
};

const actions_before_a_server_exists: Partial<Record<PageProblemReason, ProblemAction>> = {
  not_authorized: 'try_again',
  digitalocean_refused: 'try_again',
  digitalocean_not_reachable: 'try_again',
  no_region: 'try_again',
  start_refused: 'try_again',
  script_not_found: 'try_again',
  sign_in_lost: 'try_again',
  setup_link_lost: 'start_again',
  unexpected: 'try_again',
  digitalocean_not_set_up: 'start_again',
  aws_not_set_up: 'start_again',
  needs_https: 'start_again',
};

export type DeployProblem = { sentence: string; action: ProblemAction };

export class DeployStopped extends Error {
  constructor(
    readonly reason: PageProblemReason,
    readonly cloud_words: string | null = null,
  ) {
    super(reason);
  }
}

function action_for(reason: PageProblemReason, cloud: CloudName): ProblemAction {
  const before = actions_before_a_server_exists[reason];
  if (before) return before;
  return cloud === 'digitalocean' ? 'delete_and_start_again' : 'start_again';
}

const aws_cleanup_sentence = ' Delete its stack in AWS, then start again.';

export function describe_problem(
  reason: PageProblemReason,
  cloud: CloudName,
  details: { box_reason?: string | null; cloud_words?: string | null } = {},
): DeployProblem {
  const action = action_for(reason, cloud);
  const base =
    (details.box_reason && box_reason_sentences[details.box_reason]) ||
    page_problem_sentences[reason];
  const quoted = details.cloud_words ? ` It says: "${details.cloud_words}"` : '';
  const cleanup =
    cloud === 'aws' && action === 'start_again' && !actions_before_a_server_exists[reason];
  return { sentence: `${base}${quoted}${cleanup ? aws_cleanup_sentence : ''}`, action };
}
