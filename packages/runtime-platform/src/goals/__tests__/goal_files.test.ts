import type { Database } from '@coworker/core';
import { AppError } from '@coworker/shared';
import type { WorkspaceVolumeAddress } from '@runtime-platform/files/workspace_volume_browser';
import { parse_goal_file, render_goal_file } from '@runtime-platform/goals/goal_file_format';
import {
  type GoalFileReaders,
  list_goal_files,
  read_goal_file,
  save_goal_file,
} from '@runtime-platform/goals/goal_files';
import { current_workspace_layout } from '@runtime-platform/storage/workspace_layouts';
import { describe, expect, it } from 'vitest';

const address: WorkspaceVolumeAddress = {
  volume_id: 'vol_1',
  provider_volume_id: 'pvol_1',
  region: undefined,
  volume_workspace_path: 'agents/agt_1/workspace',
  layout: current_workspace_layout,
};

const who = { workspace_id: 'ws_1', agent_id: 'agt_1' };
const db = {} as Database;

function fake_volume(files: Record<string, string> = {}) {
  const written = new Map<string, string>(Object.entries(files));
  const replaced_against: string[] = [];
  const readers: GoalFileReaders = {
    resolve_address: async () => address,
    read_file: async (_address, file_path) => {
      const text = written.get(file_path);
      if (text === undefined) throw new AppError('workspace_file_not_found', 'gone', 404);
      return new TextEncoder().encode(text);
    },
    list_folder: async () => ({
      folder_names: [],
      files: [...written.keys()]
        .filter((file_path) => file_path.startsWith('goals/'))
        .map((file_path) => ({
          file_name: file_path.slice('goals/'.length),
          byte_size: 1,
          last_modified_time: null,
        })),
    }),
    write_file: async (_address, input) => {
      written.set(input.file_path, new TextDecoder().decode(input.data));
    },
    replace_file: async (_address, input) => {
      replaced_against.push(input.expected_version);
      written.set(input.file_path, new TextDecoder().decode(input.data));
    },
  };
  return { written, replaced_against, readers };
}

const marathon = {
  slug: 'sub-4-hour-marathon',
  objective: 'Run a marathon in under four hours',
  status: 'active' as const,
  review: 'weekly' as const,
  automation_id: 'atm_1',
  constraints: 'No running on travel weeks.',
  plan: 'Long run every Saturday.',
  progress: ['2026-09-16: goal started'],
};

describe('a goal on the volume', () => {
  it('reads back exactly what was written', () => {
    expect(parse_goal_file(marathon.slug, render_goal_file(marathon))).toEqual(marathon);
  });

  it('is not a goal when the frontmatter is missing or refused', () => {
    expect(parse_goal_file('notes', '# just some notes\n')).toBeNull();
    expect(parse_goal_file('broken', '---\nstatus: active\n---\nno objective\n')).toBeNull();
  });

  it('writes the file, then replaces the exact version it read', async () => {
    const volume = fake_volume();
    await save_goal_file(db, { ...who, goal: marathon }, volume.readers);
    expect(volume.written.get('goals/sub-4-hour-marathon.md')).toContain(
      'objective: Run a marathon in under four hours',
    );
    expect(volume.replaced_against).toEqual([]);

    const first = await read_goal_file(db, { ...who, slug: marathon.slug }, volume.readers);
    await save_goal_file(
      db,
      { ...who, goal: { ...marathon, progress: [...marathon.progress, '2026-09-20: 18k done'] } },
      volume.readers,
    );
    expect(volume.replaced_against).toEqual([first?.content_version]);
    const second = await read_goal_file(db, { ...who, slug: marathon.slug }, volume.readers);
    expect(second?.goal?.progress).toEqual(['2026-09-16: goal started', '2026-09-20: 18k done']);
  });

  it('lists the goals and leaves everything else in the folder alone', async () => {
    const volume = fake_volume({
      'goals/sub-4-hour-marathon.md': render_goal_file(marathon),
      'goals/scratch.md': '# a note somebody dropped here\n',
    });
    const goals = await list_goal_files(db, who, volume.readers);
    expect(goals.map((goal) => goal.slug)).toEqual(['sub-4-hour-marathon']);
  });

  it('answers with no goals when the workspace has no volume', async () => {
    expect(await list_goal_files(db, who, { resolve_address: async () => null })).toEqual([]);
  });
});
