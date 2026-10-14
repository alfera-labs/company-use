import { describe, expect, it } from 'vitest';
import {
  audience_label,
  body_for_everyone,
  body_for_only_person,
  read_connection_audience,
  read_project_tick,
} from '@/components/app/connection_audience';
import type { ResourceSharing, WorkspaceMember } from '@/lib/api/endpoints';
import type { Project } from '@/lib/api/types';

const me = 'user_2';
const maria = 'user_9';

function sharing(shared_with: ResourceSharing['shared_with']): ResourceSharing {
  return {
    resource_type: 'connection',
    shared_with_everyone_in_the_workspace: shared_with.length === 0,
    shared_with,
  };
}

const rooms = [
  { project_id: 'proj_eng', project_name: 'engineering' },
  { project_id: 'proj_gtm', project_name: 'GTM' },
] as Project[];

const members = [
  { user_id: me, email: 'you@bigco.test', first_name: 'You', last_name: 'Tester' },
  { user_id: maria, email: 'maria@bigco.test', first_name: 'Maria', last_name: 'Sample' },
] as WorkspaceMember[];

describe('a connection has one audience', () => {
  it('no rows means everyone', () => {
    expect(read_connection_audience(sharing([]))).toEqual({ kind: 'everyone' });
  });

  it('your personal Notion: one named person, and the person is you', () => {
    expect(read_connection_audience(sharing([{ person: me, can: 'use' }]))).toEqual({
      kind: 'only_person',
      person_id: me,
    });
  });

  it('your GitHub for engineering and GTM, not sales', () => {
    const audience = read_connection_audience(
      sharing([
        { project: 'proj_eng', can: 'use' },
        { project: 'proj_gtm', can: 'use' },
      ]),
    );
    expect(audience).toEqual({ kind: 'projects', project_ids: ['proj_eng', 'proj_gtm'] });
    expect(audience_label(audience, rooms)).toBe('2 projects');
  });

  it('someone else being the only person is that person, not custom', () => {
    expect(read_connection_audience(sharing([{ person: maria, can: 'use' }]))).toEqual({
      kind: 'only_person',
      person_id: maria,
    });
  });

  it('a mix of people and projects is custom', () => {
    expect(
      read_connection_audience(
        sharing([
          { project: 'proj_eng', can: 'use' },
          { person: maria, can: 'use' },
        ]),
      ),
    ).toEqual({ kind: 'custom' });
  });
});

describe('a one-person audience says whose it is', () => {
  const audience = read_connection_audience(sharing([{ person: maria, can: 'manage' }]));

  it('names the person to a colleague', () => {
    expect(audience_label(audience, rooms, { members, viewer_user_id: me })).toBe(
      'Only Maria Sample',
    );
  });

  it('names the same person to herself, and adds that it is her', () => {
    expect(audience_label(audience, rooms, { members, viewer_user_id: maria })).toBe(
      'Only Maria Sample (you)',
    );
  });

  it('falls back to the address, then to a count, when the name is not loaded', () => {
    const without_names = [{ user_id: maria, email: 'maria@bigco.test' }] as WorkspaceMember[];
    expect(audience_label(audience, rooms, { members: without_names })).toBe(
      'Only maria@bigco.test',
    );
    expect(audience_label(audience, rooms, { members: [] })).toBe('Only one person');
  });
});

describe('what the label says from inside a project', () => {
  it('names the one project it lives in', () => {
    const audience = read_connection_audience(sharing([{ project: 'proj_eng', can: 'use' }]));
    expect(audience_label(audience, rooms, { current_project_id: 'proj_eng' })).toBe(
      'Only engineering',
    );
  });

  it('says plainly when this room is not on the list', () => {
    const audience = read_connection_audience(
      sharing([
        { project: 'proj_eng', can: 'use' },
        { project: 'proj_gtm', can: 'use' },
      ]),
    );
    expect(audience_label(audience, rooms, { current_project_id: 'proj_sales' })).toBe(
      '2 projects, not this one',
    );
  });
});

describe('the bodies each choice sends', () => {
  it('everyone is the empty list, said explicitly', () => {
    expect(body_for_everyone()).toEqual({
      shared_with_everyone_in_the_workspace: true,
      shared_with: [],
    });
  });

  it('only one person names exactly that person', () => {
    expect(body_for_only_person(me).shared_with).toEqual([{ person: me, can: 'use' }]);
  });
});

describe('what a room tick is allowed to do', () => {
  it('adds a room to an audience that is everyone', () => {
    expect(read_project_tick(sharing([]), 'proj_eng')).toEqual({ allowed: 'add' });
  });

  it('adds a second room without restating the first', () => {
    const current = sharing([{ project: 'proj_eng', can: 'use' }]);
    expect(read_project_tick(current, 'proj_gtm')).toEqual({ allowed: 'add' });
  });

  it('removes one room of several', () => {
    const current = sharing([
      { project: 'proj_eng', can: 'use' },
      { project: 'proj_gtm', can: 'use' },
    ]);
    expect(read_project_tick(current, 'proj_eng')).toEqual({ allowed: 'remove' });
  });

  it('calls unticking the last room what it is', () => {
    const current = sharing([{ project: 'proj_eng', can: 'use' }]);
    expect(read_project_tick(current, 'proj_eng')).toEqual({ allowed: 'open_to_everyone' });
  });

  it('refuses to tick a room onto a custom audience, and says who set it', () => {
    const current = sharing([
      { project: 'proj_eng', can: 'use' },
      { person: maria, can: 'use' },
    ]);
    const decision = read_project_tick(current, 'proj_gtm');
    expect(decision.allowed).toBe('no');
    expect(decision.allowed === 'no' && decision.reason).toContain(
      'An admin set a custom audience',
    );
  });

  it("refuses to tick a room onto someone else's one-person audience, because that reads as AND", () => {
    const decision = read_project_tick(sharing([{ person: maria, can: 'use' }]), 'proj_gtm', me);
    expect(decision.allowed).toBe('no');
    expect(decision.allowed === 'no' && decision.reason).toContain('set to one person');
  });

  it("converts the owner's own one-person audience into the ticked room", () => {
    const decision = read_project_tick(sharing([{ person: me, can: 'use' }]), 'proj_gtm', me);
    expect(decision).toEqual({ allowed: 'convert_from_only_person' });
  });
});
