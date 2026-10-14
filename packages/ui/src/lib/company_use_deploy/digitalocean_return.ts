import {
  type DeploySession,
  save_session,
} from '@coworker/ui/lib/company_use_deploy/deploy_session';
import {
  delete_droplets_of_install,
  find_or_make_droplet,
} from '@coworker/ui/lib/company_use_deploy/digitalocean_droplet';
import {
  give_back_the_token,
  type SignInAnswer,
  trade_code_for_token,
} from '@coworker/ui/lib/company_use_deploy/digitalocean_sign_in';
import { build_user_data } from '@coworker/ui/lib/company_use_deploy/first_boot_user_data';

export async function make_the_droplet_after_sign_in(
  answer: SignInAnswer,
  session: DeploySession,
  client_id: string,
): Promise<DeploySession> {
  const token = await trade_code_for_token(answer, session, client_id);
  save_session({ ...session, sign_in: null });
  try {
    if (session.replaces_install_id !== null) {
      await delete_droplets_of_install(token, session.replaces_install_id);
    }
    const user_data = await build_user_data(session);
    const droplet_id = await find_or_make_droplet(token, session, user_data);
    return { ...session, phase: 'making', droplet_id, sign_in: null, replaces_install_id: null };
  } finally {
    await give_back_the_token(session, token);
  }
}
