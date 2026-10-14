import { has_consolidated_workspace_page, NotInThisEditionError } from '@coworker/memory';
import { actor_key_schema, workspace_id_schema } from '@coworker/memory/contracts/keys';
import { built_in_scope_kinds } from '@coworker/memory/contracts/scope_kinds';
import { to_document_slug } from '@coworker/memory/documents/slug_rules';
import { not_in_this_edition } from '@coworker/memory/not_in_this_edition';
import { scope_kind_of, workspace_scope_key } from '@coworker/memory/scopes/scope_keys';
import { build_scope_kind_registry } from '@coworker/memory/scopes/scope_kind_registry';
import { open_memory_view } from '@coworker/memory/view/open_memory_view';
import { describe, expect, it } from 'vitest';

const workspace_id = workspace_id_schema.parse('ws_stand_in');

describe('the company memory stand-in', () => {
  it('throws one named error for an action that is not in this edition', () => {
    expect(() => not_in_this_edition('Company memory')).toThrow(NotInThisEditionError);
    expect(() => not_in_this_edition('Company memory')).toThrow(
      'Company memory runs on Alfera Cloud. It is not in this edition.',
    );
  });

  it('refuses to open a memory view with that error', async () => {
    const registry_result = build_scope_kind_registry([]);
    if (registry_result.outcome !== 'ok') throw new Error('the built-in registry must build');
    const opening = open_memory_view(
      { extra_scope_kinds: [], embedder: null },
      registry_result.registry,
      {
        workspace_id,
        audience: { audience_kind: 'whole_workspace', home_scope_key: null },
        actor: actor_key_schema.parse('system'),
        surface: 'job',
        run_ref: null,
      },
    );
    await expect(opening).rejects.toMatchObject({ code: 'not_in_this_edition' });
  });

  it('never reports a consolidated workspace page, so the workspace digest is always written', async () => {
    const no_database = {} as Parameters<typeof has_consolidated_workspace_page>[0];
    expect(await has_consolidated_workspace_page(no_database, workspace_id)).toBe(false);
  });

  it('keeps the scope kinds, scope keys and slugs the open code reads', () => {
    expect(built_in_scope_kinds.map((kind) => kind.scope_kind)).toEqual([
      'workspace',
      'person',
      'project',
      'group',
    ]);
    expect(scope_kind_of(workspace_scope_key)).toBe('workspace');
    expect(to_document_slug('Quarterly Plan 2026')).toBe('quarterly-plan-2026');
  });
});
