import { list_workspace_files_folder } from '@api/services/workspace_files/list_workspace_files_folder';
import type { WorkspaceVolumeAddress } from '@coworker/runtime-platform';
import { workspace_layout_for_version } from '@runtime-platform/storage/workspace_layouts';
import { describe, expect, it } from 'vitest';

const cloud_address: WorkspaceVolumeAddress = {
  volume_id: 'vol_test',
  provider_volume_id: 'dsk_test',
  region: 'aws-us-west-2',
  volume_workspace_path: 'agents/agt_1/workspace',
  layout: workspace_layout_for_version(2),
};

const cloud_root = async () => ({
  folder_names: ['.venv', 'files', 'tmp'],
  files: [{ file_name: 'user.md', byte_size: 4, last_modified_time: '2026-10-01T08:00:00.000Z' }],
});

describe('a folder of a workspace on a cloud volume', () => {
  it('lists every name the volume has and does not say which folders are empty', async () => {
    const listed = await list_workspace_files_folder(cloud_address, '', cloud_root);

    expect(listed.folders).toEqual([
      { folder_name: '.venv', description: null },
      { folder_name: 'files', description: 'what the agent produced or downloaded' },
      { folder_name: 'tmp', description: null },
    ]);
    expect(listed.files.map((file) => file.file_name)).toEqual(['user.md']);
  });
});
