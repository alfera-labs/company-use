import { type GrantRule, may_use_resource } from '@coworker/core/access/may_use_resource';
import {
  type WhereAPersonCanUse,
  where_a_person_can_use,
} from '@coworker/core/access/where_a_person_can_use';
import { describe, expect, it } from 'vitest';

const maya = 'user_maya';
const sam = 'user_sam';
const tom = 'user_tom';
const phoenix = 'proj_phoenix';
const hardware = 'proj_hardware';

const projects_by_person: Record<string, string[]> = {
  [maya]: [phoenix],
  [sam]: [phoenix],
  [tom]: [],
};

const only_maya: GrantRule[] = [{ grantee_type: 'user', grantee_id: maya, grant_level: 'use' }];
const maya_and_sam: GrantRule[] = [
  ...only_maya,
  { grantee_type: 'user', grantee_id: sam, grant_level: 'use' },
];
const only_phoenix: GrantRule[] = [
  { grantee_type: 'project', grantee_id: phoenix, grant_level: 'use' },
];
const phoenix_and_hardware: GrantRule[] = [
  ...only_phoenix,
  { grantee_type: 'project', grantee_id: hardware, grant_level: 'use' },
];
const maya_inside_phoenix: GrantRule[] = [...only_phoenix, ...only_maya];

function ask(grants: GrantRule[], person: string, owner: string | null = null) {
  return where_a_person_can_use({
    default_access: 'everyone_in_the_workspace',
    grants,
    person_user_id: person,
    owner_user_id: owner,
    project_ids_the_person_is_in: projects_by_person[person] ?? [],
  });
}

describe('where one person can use a connection', () => {
  it.each<[string, GrantRule[], string, string | null, WhereAPersonCanUse]>([
    ['shared with everyone', [], tom, null, { where: 'everywhere' }],
    ['only Maya, asked for Maya', only_maya, maya, null, { where: 'own_chats' }],
    ['only Maya, asked for Sam', only_maya, sam, null, { where: 'nowhere' }],
    ['two named people, asked for the second', maya_and_sam, sam, null, { where: 'own_chats' }],
    ['a project, asked for a member', only_phoenix, sam, null, projects([phoenix])],
    ['a project, asked for someone outside it', only_phoenix, tom, null, { where: 'nowhere' }],
    [
      'two projects, asked for a member of one',
      phoenix_and_hardware,
      maya,
      null,
      projects([phoenix]),
    ],
    [
      'a project and a named person, asked for her',
      maya_inside_phoenix,
      maya,
      null,
      projects([phoenix]),
    ],
    [
      'a project and a named person, asked for another member',
      maya_inside_phoenix,
      sam,
      null,
      { where: 'nowhere' },
    ],
    [
      'a project, asked for the owner who is outside it',
      only_phoenix,
      tom,
      tom,
      { where: 'own_chats' },
    ],
    ['only Maya, asked for the owner Sam', only_maya, sam, sam, { where: 'own_chats' }],
  ])('%s', (_case, grants, person, owner, expected) => {
    expect(ask(grants, person, owner)).toEqual(expected);
  });

  it('says nowhere for a resource that starts closed and has no grants', () => {
    expect(
      where_a_person_can_use({
        default_access: 'nobody',
        grants: [],
        person_user_id: tom,
        owner_user_id: null,
        project_ids_the_person_is_in: [],
      }),
    ).toEqual({ where: 'nowhere' });
  });
});

describe('the answer agrees with the gate that runs before every tool call', () => {
  const cases: Array<[GrantRule[], string, string | null]> = [
    [[], tom, null],
    [only_maya, maya, null],
    [only_maya, sam, null],
    [only_phoenix, sam, null],
    [only_phoenix, tom, null],
    [phoenix_and_hardware, maya, null],
    [maya_inside_phoenix, maya, null],
    [maya_inside_phoenix, sam, null],
    [only_phoenix, tom, tom],
  ];

  it.each(cases)('grants %j for %s', (grants, person, owner) => {
    const answer = ask(grants, person, owner);
    const gate = (
      participants: { project: string[]; user: string[] },
      room_private_to: string | null,
    ) =>
      may_use_resource({
        default_access: 'everyone_in_the_workspace',
        grants,
        participants: { ...participants, agent: [] },
        owner_user_id: owner,
        room_private_to,
      }).allowed;

    const in_own_room = gate({ project: [`proj_me_${person}`], user: [person] }, person);
    const in_an_open_room_beside_a_stranger = gate(
      { project: [], user: [person, 'a_stranger'] },
      null,
    );

    expect(in_an_open_room_beside_a_stranger).toBe(answer.where === 'everywhere');
    if (answer.where === 'own_chats') expect(in_own_room).toBe(true);
    if (answer.where === 'nowhere') expect(in_own_room).toBe(false);
    if (answer.where === 'projects') {
      for (const project_id of answer.project_ids) {
        expect(gate({ project: [project_id], user: [person] }, null)).toBe(true);
      }
    }
  });
});

function projects(project_ids: string[]): WhereAPersonCanUse {
  return { where: 'projects', project_ids };
}
