import { resolve_workos_client } from '@api/lib/workos_client';
import { create_logger } from '@coworker/shared';
import { ConflictException, NotFoundException } from '@workos-inc/node';

const log = create_logger('workspace');

export type WorkosOrganizationRecord = { id: string; name: string };

export async function update_workos_organization_name(organization_id: string, name: string) {
  const workos = resolve_workos_client();
  if (!workos) {
    log.info('WORKOS_API_KEY unset — skipping WorkOS org name sync');
    return;
  }
  await workos.organizations.updateOrganization({ organization: organization_id, name });
}

export async function find_workos_organization_by_external_id(
  external_id: string,
): Promise<WorkosOrganizationRecord | null> {
  const workos = resolve_workos_client();
  if (!workos) return null;
  try {
    const organization = await workos.organizations.getOrganizationByExternalId(external_id);
    return { id: organization.id, name: organization.name };
  } catch (error) {
    if (error instanceof NotFoundException) return null;
    throw error;
  }
}

export async function create_workos_organization(input: {
  name: string;
  external_id?: string;
  workos_user_id: string;
}): Promise<WorkosOrganizationRecord | null> {
  const workos = resolve_workos_client();
  if (!workos) return null;
  try {
    const organization = await workos.organizations.createOrganization(
      {
        name: input.name,
        ...(input.external_id ? { externalId: input.external_id } : {}),
        metadata: { source: 'alfera_authkit', workos_user_id: input.workos_user_id },
      },
      input.external_id ? { idempotencyKey: input.external_id } : undefined,
    );
    return { id: organization.id, name: organization.name };
  } catch (error) {
    if (error instanceof ConflictException && input.external_id) {
      return find_workos_organization_by_external_id(input.external_id);
    }
    throw error;
  }
}
