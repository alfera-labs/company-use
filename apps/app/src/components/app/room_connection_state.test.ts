import { describe, expect, it } from 'vitest';
import {
  read_project_removal,
  read_room_connection_state,
} from '@/components/app/room_connection_state';
import type { ResourceSharing, SharingGrantee } from '@/lib/api/endpoints';

const this_room = 'proj_sales';
const other_room = 'proj_ops';
const owner = 'usr_nina';

function sharing(...shared_with: SharingGrantee[]): ResourceSharing {
  return {
    resource_type: 'connection',
    shared_with_everyone_in_the_workspace: shared_with.length === 0,
    shared_with,
  };
}

function room(project_id: string): SharingGrantee {
  return { project: project_id, can: 'use' };
}

function person(user_id: string): SharingGrantee {
  return { person: user_id, can: 'use' };
}

describe('a connection read from inside one room', () => {
  it('is available when the whole workspace already shares it', () => {
    expect(read_room_connection_state(sharing(), this_room, owner)).toBe('available');
  });

  it('is available when this room is one of the rooms it belongs to', () => {
    expect(read_room_connection_state(sharing(room(this_room)), this_room, owner)).toBe(
      'available',
    );
    expect(
      read_room_connection_state(sharing(room(other_room), room(this_room)), this_room, owner),
    ).toBe('available');
  });

  it('can be added when it belongs to other rooms only', () => {
    expect(read_room_connection_state(sharing(room(other_room)), this_room, owner)).toBe('addable');
  });

  it("converts the owner's own private connection into this room", () => {
    expect(read_room_connection_state(sharing(person(owner)), this_room, owner)).toBe('convert');
  });

  it("leaves another person's private connection alone", () => {
    expect(read_room_connection_state(sharing(person('usr_robin')), this_room, owner)).toBe(
      'private',
    );
  });

  it('leaves a custom audience of people and rooms alone', () => {
    expect(
      read_room_connection_state(sharing(person('usr_robin'), room(other_room)), this_room, owner),
    ).toBe('private');
  });

  it('never offers to add a room to a connection the whole workspace shares', () => {
    for (const owner_id of [owner, 'usr_robin', null, undefined]) {
      for (const project_id of [this_room, other_room]) {
        expect(read_room_connection_state(sharing(), project_id, owner_id)).toBe('available');
      }
    }
  });
});

describe('taking a connection out of one room', () => {
  it('drops this room only, while other rooms keep it', () => {
    expect(
      read_project_removal(sharing(room(this_room), room(other_room)), this_room, owner),
    ).toEqual({ kind: 'untick' });
  });

  it('hands the last room back to the owner instead of opening it to everyone', () => {
    expect(read_project_removal(sharing(room(this_room)), this_room, owner)).toEqual({
      kind: 'make_owner_only',
      owner_user_id: owner,
    });
  });

  it('asks first when the last room goes and nobody owns the connection', () => {
    expect(read_project_removal(sharing(room(this_room)), this_room, null)).toEqual({
      kind: 'needs_everyone_confirm',
    });
  });

  it('does nothing for a connection this room was never given', () => {
    expect(read_project_removal(sharing(room(other_room)), this_room, owner)).toEqual({
      kind: 'nothing',
    });
    expect(read_project_removal(sharing(), this_room, owner)).toEqual({ kind: 'nothing' });
    expect(read_project_removal(sharing(person(owner)), this_room, owner)).toEqual({
      kind: 'nothing',
    });
  });

  it('leaves a custom audience to the connection settings page', () => {
    expect(
      read_project_removal(sharing(person('usr_robin'), room(this_room)), this_room, owner),
    ).toEqual({ kind: 'nothing' });
  });
});
