import { generate_agent_visible_path } from '@agent-core/environment/agent_visible_path';
import { workspace_path_escape_message } from '@agent-core/environment/workspace_path_escape';
import {
  read_agent_workspace_path,
  volume_metadata,
} from '@runtime-platform/storage/volume_metadata';
import {
  current_workspace_layout,
  migrated_workspace_path,
  migration_steps_to_current,
  model_may_write_workspace_path,
  procedures_folder,
  volume_workspace_path,
  workspace_path_is_durable,
} from '@runtime-platform/storage/workspace_layouts';
import { workspace_seed_files } from '@runtime-platform/storage/workspace_seed_files';
import { describe, expect, it } from 'vitest';

describe('volume_workspace_path', () => {
  it('places an agent workspace under its own id', () => {
    expect(volume_workspace_path('ag_01k9')).toBe('agents/ag_01k9/workspace');
  });

  it('refuses an agent id that is not a safe path segment', () => {
    for (const unsafe_id of ['../escape', 'ag/1', "ag'; rm -rf /", '']) {
      expect(() => volume_workspace_path(unsafe_id)).toThrow(/not usable as a path segment/u);
    }
  });
});

describe('model_may_write_workspace_path', () => {
  it('lets the model write its own memory, procedures and files', () => {
    for (const writable of ['people/alice.md', 'skills/x/SKILL.md', 'files/report.pdf', 'notes']) {
      expect(model_may_write_workspace_path(writable)).toBe(true);
    }
  });

  it('refuses a write anywhere under system/', () => {
    for (const reserved of [
      'system',
      'system/layout.json',
      'system/activity/2026-08-11.jsonl',
      'system/browser/auth/vault.enc',
      'system/tool-output/tc_1.txt',
    ]) {
      expect(model_may_write_workspace_path(reserved)).toBe(false);
    }
  });

  it('is not fooled by a leading slash', () => {
    expect(model_may_write_workspace_path('/system/activity/x.jsonl')).toBe(false);
  });
});

describe('workspace_path_is_durable', () => {
  it('excludes the scratch link and nothing else', () => {
    expect(workspace_path_is_durable('tmp')).toBe(false);
    expect(workspace_path_is_durable('tmp/attachments/a.pdf')).toBe(false);
    expect(workspace_path_is_durable('files/a.pdf')).toBe(true);
    expect(workspace_path_is_durable('tmpfiles/a.pdf')).toBe(true);
  });
});

describe('migration_steps_to_current', () => {
  it('carries a v1 volume forward and stops at the current version', () => {
    expect(migration_steps_to_current(1).length).toBeGreaterThan(0);
    expect(migration_steps_to_current(2)).toEqual([]);
    expect(migration_steps_to_current(3)).toEqual([]);
  });

  it('resolves every old top-level name it moves away from', () => {
    expect(migrated_workspace_path('artifacts/report.pdf')).toBe('files/report.pdf');
    expect(migrated_workspace_path('downloads/invoice.pdf')).toBe('files/invoice.pdf');
    expect(migrated_workspace_path('screenshots/page.png')).toBe('files/page.png');
    expect(migrated_workspace_path('logs/tc_1.txt')).toBe('system/tool-output/tc_1.txt');
  });

  it('leaves a current path alone', () => {
    expect(migrated_workspace_path('files/report.pdf')).toBeNull();
    expect(migrated_workspace_path('people/alice.md')).toBeNull();
  });

  it('resolves every name the write deny reserves', () => {
    for (const alias of current_workspace_layout.reserved_write_aliases) {
      expect(migrated_workspace_path(`${alias}/x.txt`)).not.toBeNull();
    }
  });
});

describe('workspace_seed_files', () => {
  it('seeds an index in every folder that asked for one, and nowhere else', () => {
    const seeded = new Set(workspace_seed_files().map((file) => file.path));
    for (const folder of current_workspace_layout.folders) {
      expect(seeded.has(`${folder.path}/index.md`)).toBe(folder.seed_index);
    }
  });

  it('seeds the readme, the user page and one example procedure', () => {
    const seeded = workspace_seed_files().map((file) => file.path);
    expect(seeded).toContain('README.md');
    expect(seeded).toContain('user.md');
    expect(seeded).toContain(`${procedures_folder}/example-procedure/SKILL.md`);
  });

  it('ships no invented facts', () => {
    for (const file of workspace_seed_files()) {
      expect(file.content).not.toMatch(/\b(?:Acme|John Doe|example\.com|555-)\b/u);
    }
  });
});

describe('the model root agent-core mirrors', () => {
  it('matches the layout record', () => {
    expect(workspace_path_escape_message('/etc/passwd')).toContain(
      `under ${current_workspace_layout.model_root}`,
    );
    expect(generate_agent_visible_path(undefined, 'people/alice.md')).toBe(
      `${current_workspace_layout.model_root}/people/alice.md`,
    );
  });
});

describe('reserved write aliases', () => {
  it('refuses a write through an old top-level name that now points into system/', () => {
    expect(model_may_write_workspace_path('logs/tc_1.txt')).toBe(false);
    expect(model_may_write_workspace_path('/logs/tc_1.txt')).toBe(false);
    expect(model_may_write_workspace_path('artifacts/report.pdf')).toBe(true);
  });

  it('keeps every alias pointing at somewhere a move step actually created', () => {
    const moves = migration_steps_to_current(1).flatMap((step) =>
      'move' in step ? [step.move] : [],
    );
    for (const alias of current_workspace_layout.reserved_write_aliases) {
      expect(moves).toContain(alias);
    }
  });
});

describe('agent workspace path on the environment metadata', () => {
  it('is written whenever the run knows its agent', () => {
    const metadata = volume_metadata(
      {
        volume_id: 'vol_1',
        workspace_mount_key: 'ws:ses',
        provider: 'archil',
        workspace_layout_version: 2,
        provider_volume_id: 'dsk_1',
        root_path: '/mnt/coworker',
        mount_token: 'token',
      },
      'ag_01k9',
    );

    expect(metadata.agent_workspace_path).toBe('agents/ag_01k9/workspace');
    expect(read_agent_workspace_path(metadata)).toBe('agents/ag_01k9/workspace');
  });

  it('reads null for an environment that predates the layout', () => {
    expect(read_agent_workspace_path({})).toBeNull();
    expect(read_agent_workspace_path({ agent_workspace_path: '' })).toBeNull();
  });
});
