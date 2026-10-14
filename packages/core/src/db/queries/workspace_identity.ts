import { type AnyColumn, sql } from 'drizzle-orm';

export type WorkspaceIdentity = {
  provider_key: string;
  provider_user_id: string;
  organization_id?: string;
  organization_name?: string;
  membership_id?: string;
  member_role?: string;
  member_status?: string;
  email?: string;
  first_name?: string;
  last_name?: string;
  avatar_url?: string;
  user_data?: Record<string, unknown>;
  workspace_data?: Record<string, unknown>;
};

export function normalize_workspace_identity(input: WorkspaceIdentity): WorkspaceIdentity {
  return {
    ...input,
    provider_key: required_text(input.provider_key, 'provider_key').toLowerCase(),
    provider_user_id: required_text(input.provider_user_id, 'provider_user_id'),
  };
}

export function workspace_identity_id(identity: Pick<WorkspaceIdentity, 'organization_id'>) {
  return `organization:${required_text(identity.organization_id, 'organization_id')}`;
}

export function organization_id_from_external_identity(
  provider: string | null | undefined,
  external_identity_id: string | null | undefined,
): string | null {
  if (provider !== 'workos') return null;
  const prefix = 'organization:';
  if (!external_identity_id?.startsWith(prefix)) return null;
  return clean_text(external_identity_id.slice(prefix.length)) ?? null;
}

export function membership_identity_id(identity: WorkspaceIdentity) {
  if (identity.membership_id) return `membership:${identity.membership_id}`;
  const organization_id = required_text(identity.organization_id, 'organization_id');
  return `organization_membership:${organization_id}:${identity.provider_user_id}`;
}

export function workspace_name(identity: WorkspaceIdentity) {
  const first_name = clean_text(identity.first_name);
  if (first_name) return `${first_name}'s Workspace`;

  return (
    clean_text(identity.organization_name) ??
    normalize_email(identity.email)?.split('@')[0] ??
    'Workspace'
  );
}

export function user_name(identity: WorkspaceIdentity) {
  return {
    first_name: clean_text(identity.first_name),
    last_name: clean_text(identity.last_name),
  };
}

export function fallback_email(identity: WorkspaceIdentity) {
  return `${slug_from_parts(identity.provider_user_id)}@${slug_from_parts(identity.provider_key)}.identity.local`;
}

export function is_fallback_email(email: string) {
  return email.endsWith('.identity.local');
}

export function normalize_email(email: string | undefined) {
  return clean_text(email)?.toLowerCase();
}

export function slug_from_parts(...parts: string[]) {
  return (
    parts
      .join('-')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 72) || 'identity'
  );
}

export function system_actor_for_identity(identity: WorkspaceIdentity) {
  return `system:${identity.provider_key}`;
}

export function external_identity_target(table: {
  external_identity_provider: AnyColumn;
  external_identity_id: AnyColumn;
}) {
  return sql`${table.external_identity_provider} IS NOT NULL AND ${table.external_identity_id} IS NOT NULL`;
}

function clean_text(value: string | undefined) {
  return value?.trim() || undefined;
}

function required_text(value: string | undefined, label: string) {
  const text = clean_text(value);
  if (!text) throw new Error(`${label} is required`);
  return text;
}
