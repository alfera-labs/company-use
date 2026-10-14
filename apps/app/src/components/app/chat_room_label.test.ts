import { describe, expect, it } from 'vitest';
import { read_shared_rooms, room_label } from '@/components/app/chat_room_label';
import type { Project } from '@/lib/api/types';

function room(overrides: Partial<Project> & { project_id: string }): Project {
  return {
    workspace_id: 'ws_1',
    project_name: 'A room',
    project_status: 'active',
    project_access: 'members',
    is_workspace_default: false,
    project_description: null,
    project_instructions: null,
    membership_version: 1,
    personal_for_user_id: null,
    created_time: '2026-08-23T00:00:00Z',
    last_updated_time: '2026-08-23T00:00:00Z',
    ...overrides,
  };
}

const my_own_room = room({ project_id: 'proj_mine', personal_for_user_id: 'user_alice' });
const shared_room = room({ project_id: 'proj_acme', project_name: 'Acme Support' });

describe('which rooms earn a sidebar section', () => {
  it('keeps the shared ones and drops your own', () => {
    expect(read_shared_rooms([my_own_room, shared_room]).map((one) => one.project_id)).toEqual([
      'proj_acme',
    ]);
  });
});

describe('chat project labels', () => {
  it('labels personal projects without exposing their stored name', () => {
    expect(room_label(my_own_room.project_id, [my_own_room], 'Alfera')).toBe('Personal');
  });

  it('uses the company name for the default project and legacy chats', () => {
    const company = room({ project_id: 'proj_company', is_workspace_default: true });
    expect(room_label(company.project_id, [company], 'Alfera')).toBe('Alfera');
    expect(room_label(null, [company], 'Alfera')).toBe('Alfera');
  });

  it('uses the actual name for custom projects, including archived projects', () => {
    const archived = room({
      project_id: 'proj_old',
      project_name: 'Launch archive',
      project_status: 'archived',
    });
    expect(room_label(shared_room.project_id, [shared_room], 'Alfera')).toBe('Acme Support');
    expect(room_label(archived.project_id, [archived], 'Alfera')).toBe('Launch archive');
  });

  it('does not label an unresolved project as the company', () => {
    expect(room_label('proj_missing', [shared_room], 'Alfera')).toBe('Project');
  });
});
