import { while_setup_is_open } from '@api/services/install/setup_token';
import { hash_password } from '@api/services/team/password_hash';
import { create_recovery_code } from '@api/services/team/recovery_code';
import { start_team_session, type TeamSession } from '@api/services/team/team_session_start';
import { local_mode_identity } from '@coworker/config/local_mode_switch';
import type { Database } from '@coworker/core';
import { save_user_password } from '@coworker/core/db/queries/user_passwords';
import { provision_workspace_for_identity } from '@coworker/core/db/queries/workspace_provisioning';

export type NewInstallOwner = { email: string; password: string; first_name?: string | undefined };
export type InstallOwnerSignedIn = TeamSession & { recovery_code: string };

export const setup_actor = 'system:setup_page';

export async function create_install_owner(
  db: Database,
  owner: NewInstallOwner,
): Promise<InstallOwnerSignedIn> {
  const [password_hash, recovery] = [await hash_password(owner.password), create_recovery_code()];
  const session = await while_setup_is_open(db, async (tx) => {
    const provisioned = await provision_workspace_for_identity(tx, {
      ...local_mode_identity,
      email: owner.email,
      ...(owner.first_name ? { first_name: owner.first_name } : {}),
    });
    await save_user_password(tx, {
      user_id: provisioned.user_id,
      password_hash,
      recovery_code_hash: recovery.recovery_code_hash,
      actor_id: setup_actor,
    });
    return start_team_session(tx, provisioned);
  });
  return { ...session, recovery_code: recovery.recovery_code };
}
