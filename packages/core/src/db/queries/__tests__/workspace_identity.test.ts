import {
  organization_id_from_external_identity,
  workspace_name,
} from '@coworker/core/db/queries/workspace_identity';
import { describe, expect, it } from 'vitest';

const base_identity = { provider_key: 'workos', provider_user_id: 'user_1' };

describe('workspace_name', () => {
  it("uses the first name as {first_name}'s Workspace when one is present", () => {
    expect(workspace_name({ ...base_identity, first_name: 'Mark' })).toBe("Mark's Workspace");
  });

  it('prefers the first name even when an org name is available', () => {
    expect(
      workspace_name({ ...base_identity, first_name: 'Mark', organization_name: 'Acme Inc' }),
    ).toBe("Mark's Workspace");
  });

  it('trims surrounding whitespace from the first name', () => {
    expect(workspace_name({ ...base_identity, first_name: '  Mark  ' })).toBe("Mark's Workspace");
  });

  it('falls back to the org name when there is no first name', () => {
    expect(workspace_name({ ...base_identity, organization_name: 'Acme Inc' })).toBe('Acme Inc');
  });

  it('falls back to the email local-part when there is no first name or org', () => {
    expect(workspace_name({ ...base_identity, email: 'founder@example.com' })).toBe('founder');
  });

  it("falls back to 'Workspace' when nothing identifying is present", () => {
    expect(workspace_name(base_identity)).toBe('Workspace');
  });

  it('ignores a blank first name and uses the next fallback', () => {
    expect(
      workspace_name({ ...base_identity, first_name: '   ', organization_name: 'Acme Inc' }),
    ).toBe('Acme Inc');
  });
});

describe('organization_id_from_external_identity', () => {
  it('recovers the org id from a workos organization identity', () => {
    expect(organization_id_from_external_identity('workos', 'organization:org_123')).toBe(
      'org_123',
    );
  });

  it('trims surrounding whitespace on the recovered id', () => {
    expect(organization_id_from_external_identity('workos', 'organization:  org_123  ')).toBe(
      'org_123',
    );
  });

  it('returns null for a non-workos provider', () => {
    expect(organization_id_from_external_identity('slack', 'organization:org_123')).toBeNull();
  });

  it('returns null when the organization prefix is missing', () => {
    expect(organization_id_from_external_identity('workos', 'org_123')).toBeNull();
  });

  it('returns null for a prefix with an empty id', () => {
    expect(organization_id_from_external_identity('workos', 'organization:')).toBeNull();
  });

  it('returns null for missing provider or identity', () => {
    expect(organization_id_from_external_identity(null, null)).toBeNull();
    expect(organization_id_from_external_identity('workos', undefined)).toBeNull();
  });
});
