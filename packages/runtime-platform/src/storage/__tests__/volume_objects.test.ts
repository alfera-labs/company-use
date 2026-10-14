import { replace_archil_volume_bytes } from '@runtime-platform/storage/atomic_volume_replace';
import {
  list_archil_volume_entries,
  list_archil_volume_folders,
  read_archil_volume_bytes,
  volume_object_key,
  workspace_object_key,
  write_archil_volume_bytes,
} from '@runtime-platform/storage/volume_objects';
import { describe, expect, it, vi } from 'vitest';

describe('volume object access', () => {
  it('reads the key exactly as given, relative to the volume root', async () => {
    const get_object = vi.fn().mockResolvedValue(new TextEncoder().encode('durable file'));
    const get_disk = vi.fn().mockResolvedValue({ getObject: get_object });
    const create_client = vi.fn().mockReturnValue({ disks: { get: get_disk } });

    const bytes = await read_archil_volume_bytes(
      {
        provider_volume_id: 'dsk_test',
        volume_relative_path: 'agents/agt_1/workspace/skills/INDEX.json',
        api_key: 'archil-test-key',
        region: 'aws-us-east-1',
      },
      create_client,
    );

    expect(new TextDecoder().decode(bytes)).toBe('durable file');
    expect(get_disk).toHaveBeenCalledWith('dsk_test');
    expect(get_object).toHaveBeenCalledWith('agents/agt_1/workspace/skills/INDEX.json');
  });

  it('names the folders directly inside a folder on the volume', async () => {
    const list_objects = vi.fn().mockResolvedValue({
      commonPrefixes: [
        'agents/agt_1/workspace/skills/quote-drafting/',
        'agents/agt_1/workspace/skills/reply-to-inquiry/',
      ],
    });
    const create_client = vi.fn().mockReturnValue({
      disks: { get: vi.fn().mockResolvedValue({ listObjects: list_objects }) },
    });

    const names = await list_archil_volume_folders(
      {
        provider_volume_id: 'dsk_test',
        volume_relative_path: 'agents/agt_1/workspace/skills',
        api_key: 'archil-test-key',
        region: 'aws-us-east-1',
      },
      create_client,
    );

    expect(names).toEqual(['quote-drafting', 'reply-to-inquiry']);
    expect(list_objects).toHaveBeenCalledWith('agents/agt_1/workspace/skills/', {
      recursive: false,
    });
  });

  it('lists one folder as files plus subfolder names, dropping the folder marker object', async () => {
    const list_objects = vi.fn().mockResolvedValue({
      objects: [
        {
          key: 'agents/agt_1/workspace/skills/INDEX.json',
          size: 512,
          lastModified: new Date('2026-08-11T10:00:00Z'),
        },
        { key: 'agents/agt_1/workspace/skills/', size: 0 },
      ],
      commonPrefixes: ['agents/agt_1/workspace/skills/quote-drafting/'],
    });
    const create_client = vi.fn().mockReturnValue({
      disks: { get: vi.fn().mockResolvedValue({ listObjects: list_objects }) },
    });

    const listed = await list_archil_volume_entries(
      {
        provider_volume_id: 'dsk_test',
        volume_relative_path: 'agents/agt_1/workspace/skills',
        api_key: 'archil-test-key',
        region: 'aws-us-east-1',
      },
      create_client,
    );

    expect(listed).toEqual({
      folder_names: ['quote-drafting'],
      files: [
        {
          file_name: 'INDEX.json',
          byte_size: 512,
          last_modified_time: '2026-08-11T10:00:00.000Z',
        },
      ],
    });
    expect(list_objects).toHaveBeenCalledWith('agents/agt_1/workspace/skills/', {
      recursive: false,
    });
  });

  it('writes bytes to the key exactly as given', async () => {
    const put_object = vi.fn().mockResolvedValue({});
    const create_client = vi.fn().mockReturnValue({
      disks: { get: vi.fn().mockResolvedValue({ putObject: put_object }) },
    });
    const data = new TextEncoder().encode('# Updated');

    await write_archil_volume_bytes(
      {
        provider_volume_id: 'dsk_test',
        volume_relative_path: 'agents/agt_1/workspace/user.md',
        data,
        api_key: 'archil-test-key',
        region: 'aws-us-east-1',
      },
      create_client,
    );

    expect(put_object).toHaveBeenCalledWith('agents/agt_1/workspace/user.md', data);
  });

  it('replaces bytes under parent ownership after an in-container version check', async () => {
    const put_object = vi.fn().mockResolvedValue({});
    const exec = vi.fn().mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 });
    const disk = { putObject: put_object, deleteObject: vi.fn() };
    const create_client = vi.fn().mockReturnValue({
      exec,
      disks: { get: vi.fn().mockResolvedValue(disk) },
    });
    const data = new TextEncoder().encode('# Updated');

    await replace_archil_volume_bytes(
      {
        provider_volume_id: 'dsk_test',
        volume_relative_path: 'agents/agt_1/workspace/files/report.md',
        data,
        expected_version: 'a'.repeat(64),
        content_version: 'b'.repeat(64),
        api_key: 'archil-test-key',
        region: 'aws-us-east-1',
      },
      create_client,
    );

    expect(put_object).toHaveBeenCalledWith(
      expect.stringMatching(
        /^agents\/agt_1\/workspace\/files\/\.alfera-file-saves\/.+\/replacement$/u,
      ),
      data,
    );
    expect(exec).toHaveBeenCalledWith(
      expect.objectContaining({
        disks: {
          volume: expect.objectContaining({
            disk,
            checkoutPaths: ['agents/agt_1/workspace/files'],
          }),
        },
      }),
    );
  });

  it('returns the current version when the protected compare finds a conflict', async () => {
    const current_version = 'c'.repeat(64);
    const create_client = vi.fn().mockReturnValue({
      exec: vi.fn().mockResolvedValue({
        stdout: `VERSION_CONFLICT:${current_version}\n`,
        stderr: '',
        exitCode: 42,
      }),
      disks: {
        get: vi.fn().mockResolvedValue({ putObject: vi.fn(), deleteObject: vi.fn() }),
      },
    });

    await expect(
      replace_archil_volume_bytes(
        {
          provider_volume_id: 'dsk_test',
          volume_relative_path: 'workspace/files/report.docx',
          data: new Uint8Array([1]),
          expected_version: 'a'.repeat(64),
          content_version: 'b'.repeat(64),
          api_key: 'archil-test-key',
          region: 'aws-us-east-1',
        },
        create_client,
      ),
    ).rejects.toMatchObject({
      code: 'workspace_file_version_conflict',
      status: 409,
      details: { content_version: current_version },
    });
  });

  it('joins a workspace file onto the workspace its volume actually holds', () => {
    expect(workspace_object_key('agents/agt_1/workspace', 'artifacts/report.md')).toBe(
      'agents/agt_1/workspace/artifacts/report.md',
    );
    expect(workspace_object_key('workspace', 'artifacts/report.md')).toBe(
      'workspace/artifacts/report.md',
    );
  });

  it('drops a trailing slash so a folder path pasted with one still names the folder', () => {
    expect(volume_object_key('agents/agt_1/workspace/skills/')).toBe(
      'agents/agt_1/workspace/skills',
    );
    expect(workspace_object_key('agents/agt_1/workspace', 'skills/')).toBe(
      'agents/agt_1/workspace/skills',
    );
  });

  it('rejects a path that escapes the volume or its workspace', () => {
    expect(() => volume_object_key('../secret')).toThrow(/escapes/u);
    expect(() => volume_object_key('/etc/passwd')).toThrow(/relative/u);
    expect(() =>
      workspace_object_key('agents/agt_1/workspace', '../../agt_2/workspace/user.md'),
    ).toThrow(/escapes/u);
    expect(() => workspace_object_key('agents/agt_1/workspace', '/etc/passwd')).toThrow(
      /relative/u,
    );
  });
});
