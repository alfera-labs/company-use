import { describe, expect, it } from 'vitest';
import { audience_label, read_connection_audience } from '@/components/app/connection_audience';
import { read_person_tick } from '@/components/app/connection_audience_people';
import type { ResourceSharing, WorkspaceMember } from '@/lib/api/endpoints';

const kim = 'user_priya';
const ana = 'user_ana';
const tom = 'user_tom';

function sharing(shared_with: ResourceSharing['shared_with']): ResourceSharing {
  return {
    resource_type: 'connection',
    shared_with_everyone_in_the_workspace: shared_with.length === 0,
    shared_with,
  };
}

const members = [
  { user_id: kim, email: 'kim@northwind.test', first_name: 'Kim', last_name: 'Sample' },
  { user_id: ana, email: 'ana@northwind.test', first_name: 'Ana', last_name: 'Sample' },
  { user_id: tom, email: 'tom@northwind.test', first_name: 'Tom', last_name: 'Becker' },
] as WorkspaceMember[];

const kim_and_ana = sharing([
  { person: kim, can: 'manage' },
  { person: ana, can: 'use' },
]);

describe('a connection shared with named people', () => {
  it('reads two named people as people, and says both names', () => {
    const audience = read_connection_audience(kim_and_ana);

    expect(audience).toEqual({ kind: 'people', person_ids: [kim, ana] });
    expect(audience_label(audience, [], { members })).toBe('Kim Sample and Ana Sample');
  });

  it('counts the people once there are three', () => {
    const audience = read_connection_audience(
      sharing([
        { person: kim, can: 'use' },
        { person: ana, can: 'use' },
        { person: tom, can: 'use' },
      ]),
    );

    expect(audience_label(audience, [], { members })).toBe('3 people');
  });
});

describe('ticking a person in the audience menu', () => {
  it('adds a person beside the ones already named, and keeps what each could do', () => {
    expect(read_person_tick(kim_and_ana, tom)).toEqual({
      save: {
        shared_with_everyone_in_the_workspace: false,
        shared_with: [
          { person: kim, can: 'manage' },
          { person: ana, can: 'use' },
          { person: tom, can: 'use' },
        ],
        replaces: kim_and_ana.shared_with,
      },
    });
  });

  it('removes a person who was named', () => {
    expect(read_person_tick(kim_and_ana, ana)).toMatchObject({
      save: { shared_with: [{ person: kim, can: 'manage' }] },
    });
  });

  it('asks before the last named person is removed, because that opens it to everyone', () => {
    expect(read_person_tick(sharing([{ person: kim, can: 'use' }]), kim)).toEqual({
      ask: 'open_to_everyone',
    });
  });

  it('switches a connection shared with everyone to that one person', () => {
    expect(read_person_tick(sharing([]), ana)).toMatchObject({
      save: { shared_with: [{ person: ana, can: 'use' }], replaces: [] },
    });
  });

  it('switches a connection shared with projects to that one person', () => {
    const in_a_project = sharing([{ project: 'proj_phoenix', can: 'use' }]);

    expect(read_person_tick(in_a_project, ana)).toMatchObject({
      save: { shared_with: [{ person: ana, can: 'use' }], replaces: in_a_project.shared_with },
    });
  });

  it('refuses when projects and people are mixed, so nothing is lost', () => {
    const mixed = sharing([
      { project: 'proj_phoenix', can: 'use' },
      { person: ana, can: 'use' },
    ]);

    expect(read_person_tick(mixed, tom)).toMatchObject({ refuse: expect.any(String) });
  });
});
