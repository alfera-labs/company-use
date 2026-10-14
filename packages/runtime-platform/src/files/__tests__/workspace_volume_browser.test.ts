import path from 'node:path';
import {
  list_workspace_volume_folder,
  read_workspace_volume_file,
  replace_workspace_volume_file,
  user_may_write_workspace_path,
  validate_workspace_file_path,
  type WorkspaceVolumeAddress,
  write_workspace_volume_file,
} from '@runtime-platform/files/workspace_volume_browser';
import { workspace_layout_for_version } from '@runtime-platform/storage/workspace_layouts';
import { describe, expect, it, vi } from 'vitest';

const v2_address: WorkspaceVolumeAddress = {
  volume_id: 'vol_test',
  provider_volume_id: 'dsk_test',
  region: 'aws-us-west-2',
  volume_workspace_path: 'agents/agt_1/workspace',
  layout: workspace_layout_for_version(2),
};

describe('list_workspace_volume_folder', () => {
  it('lists the workspace root when the folder path is empty', async () => {
    const list_volume_entries = vi.fn().mockResolvedValue({ folder_names: ['skills'], files: [] });

    const listed = await list_workspace_volume_folder(v2_address, '', list_volume_entries);

    expect(listed.folder_names).toEqual(['skills']);
    expect(list_volume_entries).toHaveBeenCalledWith({
      provider_volume_id: 'dsk_test',
      volume_relative_path: 'agents/agt_1/workspace',
      region: 'aws-us-west-2',
    });
  });

  it('classifies a deleted disk as a 404, not an outage', async () => {
    const deleted_disk_error = Object.assign(new Error('Disk not found'), { status: 404 });
    const list_volume_entries = vi.fn().mockRejectedValue(deleted_disk_error);

    await expect(
      list_workspace_volume_folder(v2_address, '', list_volume_entries),
    ).rejects.toMatchObject({ code: 'workspace_file_not_found', status: 404 });
  });

  it('rejects a folder path that escapes the workspace as a 400, not an outage', async () => {
    const list_volume_entries = vi.fn();

    await expect(
      list_workspace_volume_folder(v2_address, '../agt_2/workspace', list_volume_entries),
    ).rejects.toMatchObject({ code: 'workspace_path_invalid', status: 400 });
    expect(list_volume_entries).not.toHaveBeenCalled();
  });
});

describe('read_workspace_volume_file', () => {
  it('reads a file relative to the agent workspace on the volume', async () => {
    const read_volume_bytes = vi.fn().mockResolvedValue(new TextEncoder().encode('# Steps'));

    const bytes = await read_workspace_volume_file(
      v2_address,
      'skills/quote-drafting/SKILL.md',
      read_volume_bytes,
    );

    expect(new TextDecoder().decode(bytes)).toBe('# Steps');
    expect(read_volume_bytes).toHaveBeenCalledWith({
      provider_volume_id: 'dsk_test',
      volume_relative_path: 'agents/agt_1/workspace/skills/quote-drafting/SKILL.md',
      region: 'aws-us-west-2',
    });
  });

  it('reports a provider failure as temporarily unavailable', async () => {
    const read_volume_bytes = vi.fn().mockRejectedValue(new Error('socket hang up'));

    await expect(
      read_workspace_volume_file(v2_address, 'user.md', read_volume_bytes),
    ).rejects.toMatchObject({ code: 'workspace_storage_temporarily_unavailable', status: 503 });
  });
});

describe('write_workspace_volume_file', () => {
  it('writes an edited file back under the agent workspace', async () => {
    const write_volume_bytes = vi.fn().mockResolvedValue(undefined);
    const data = new TextEncoder().encode('# Updated steps');

    await write_workspace_volume_file(
      v2_address,
      { file_path: 'skills/quote-drafting/SKILL.md', data },
      write_volume_bytes,
    );

    expect(write_volume_bytes).toHaveBeenCalledWith({
      provider_volume_id: 'dsk_test',
      volume_relative_path: 'agents/agt_1/workspace/skills/quote-drafting/SKILL.md',
      data,
      region: 'aws-us-west-2',
    });
  });

  it('refuses to write into platform-owned folders, off the layout record', async () => {
    const write_volume_bytes = vi.fn();

    await expect(
      write_workspace_volume_file(
        v2_address,
        { file_path: 'system/layout.json', data: new Uint8Array() },
        write_volume_bytes,
      ),
    ).rejects.toMatchObject({ code: 'workspace_path_not_writable', status: 403 });
    expect(write_volume_bytes).not.toHaveBeenCalled();
  });
});

describe('replace_workspace_volume_file', () => {
  it('passes both content versions to the protected volume replacement', async () => {
    const replace_volume_bytes = vi.fn().mockResolvedValue(undefined);
    const data = new TextEncoder().encode('# Updated');

    await replace_workspace_volume_file(
      v2_address,
      {
        file_path: 'files/report.md',
        data,
        expected_version: 'a'.repeat(64),
        content_version: 'b'.repeat(64),
      },
      replace_volume_bytes,
    );

    expect(replace_volume_bytes).toHaveBeenCalledWith({
      provider_volume_id: 'dsk_test',
      volume_relative_path: 'agents/agt_1/workspace/files/report.md',
      data,
      expected_version: 'a'.repeat(64),
      content_version: 'b'.repeat(64),
      region: 'aws-us-west-2',
    });
  });
});

describe('user_may_write_workspace_path', () => {
  it('mirrors the layout record: agent folders yes, system and its alias no', () => {
    const layout = workspace_layout_for_version(2);
    expect(user_may_write_workspace_path(layout, 'skills/quote-drafting/SKILL.md')).toBe(true);
    expect(user_may_write_workspace_path(layout, 'system/tool-output/log.txt')).toBe(false);
    expect(user_may_write_workspace_path(layout, 'logs/old.txt')).toBe(false);
    expect(
      user_may_write_workspace_path(layout, path.posix.normalize('files/../system/a.txt')),
    ).toBe(false);
    expect(() => validate_workspace_file_path(v2_address, 'files/../system/a.txt')).toThrow(
      'maintained by Alfera',
    );
  });
});
