import { DeployStopped } from '@coworker/ui/lib/company_use_deploy/deploy_problems';
import {
  type DeployChoices,
  type DeploySession,
  read_server_without_its_link,
  read_session,
  type ServerWithoutItsLink,
} from '@coworker/ui/lib/company_use_deploy/deploy_session';
import {
  come_back_from_digitalocean,
  problem_screen_for,
  type Screen,
  type SetScreen,
} from '@coworker/ui/lib/company_use_deploy/deploy_steps';

const hours_an_opened_server_is_remembered = 24;

function was_opened_recently(session: DeploySession) {
  const limit = hours_an_opened_server_is_remembered * 60 * 60 * 1000;
  return session.opened_at !== null && Date.now() - session.opened_at < limit;
}

export function screen_for_a_stored_session(session: DeploySession | null): Screen {
  if (!session) return { name: 'choose' };
  if (session.phase === 'making') return { name: 'making', session };
  if (session.phase === 'open_aws') return { name: 'open_aws', session };
  if (session.phase === 'opened' && was_opened_recently(session))
    return { name: 'opened', session };
  if (session.phase === 'creating') {
    return problem_screen_for(new DeployStopped('sign_in_lost'), session.cloud, session);
  }
  return { name: 'choose' };
}

export function screen_for_a_server_without_its_link(server: ServerWithoutItsLink | null): Screen {
  const has_no_server = !server || server.phase === 'leaving_for_digitalocean';
  if (has_no_server || server.phase === 'opened') return { name: 'choose' };
  return problem_screen_for(new DeployStopped('setup_link_lost'), server.cloud, null);
}

export const choices_of = (
  session: Pick<DeploySession, 'cloud' | 'name' | 'backups'>,
): DeployChoices => ({
  cloud: session.cloud,
  name: session.name,
  backups: session.backups,
});

export function show_the_deploy_this_browser_remembers(
  set_screen: SetScreen,
  set_choices: (choices: DeployChoices) => void,
  client_id: string | null,
) {
  const stored = read_session();
  const server_without_its_link = stored ? null : read_server_without_its_link();
  const remembered = stored ?? server_without_its_link;
  if (remembered) set_choices(choices_of(remembered));
  return come_back_from_digitalocean(set_screen, client_id).then((came_back) => {
    if (came_back) return;
    set_screen(
      stored
        ? screen_for_a_stored_session(stored)
        : screen_for_a_server_without_its_link(server_without_its_link),
    );
  });
}
