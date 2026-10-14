import {
  baked_browser_home,
  sandbox_home_directory,
} from '@runtime-platform/orchestrator/e2b_command';
import {
  browser_state_path_in_sandbox,
  browser_state_path_on_volume,
  legacy_cleanup_marker,
  legacy_layout_cleanup_script,
  sandbox_bind_script,
  sandbox_workspace_link_script,
  volume_initialization_script,
  volume_layout_complete_script,
  volume_ownership_script,
} from '@runtime-platform/orchestrator/e2b_volume_scripts';
import { workspace_directories_for_layout } from '@runtime-platform/orchestrator/workspace_runtime';
import {
  current_workspace_layout,
  workspace_layout_for_version,
} from '@runtime-platform/storage/workspace_layouts';
import { workspace_seed_files } from '@runtime-platform/storage/workspace_seed_files';
import { describe, expect, it } from 'vitest';

const volume_root = '/mnt/archil';
const agent_id = 'ag_test';
const workspace_root = `${volume_root}/agents/${agent_id}/workspace`;

describe('volume_initialization_script', () => {
  const script = volume_initialization_script(volume_root, agent_id);
  const migrating_script = volume_initialization_script(volume_root, agent_id, undefined, {
    migrate_existing_layout: true,
  });

  it('creates every folder the layout record declares', () => {
    for (const folder of current_workspace_layout.folders) {
      expect(script).toContain(`'${workspace_root}/${folder.path}'`);
    }
  });

  it('seeds every file the layout record derives, and stamps the version it wrote', () => {
    for (const file of workspace_seed_files()) {
      expect(script).toContain(`'${workspace_root}/${file.path}'`);
    }
    expect(script).toContain(`"layout_version": ${current_workspace_layout.layout_version}`);
  });

  it('leaves no compatibility symlink behind', () => {
    expect(script).not.toContain('ln -s -- ');
  });

  it('treats a volume with no v1 marker as already current', () => {
    expect(script).toContain(`previous_layout_version=${current_workspace_layout.layout_version}`);
    expect(script).toContain(`[ -e '${volume_root}/.coworker-initialized' ]`);
  });

  it('cannot be bricked by an unparsable version marker', () => {
    expect(script).toContain('*[!0-9]*');
  });

  it('refuses to move into a symlinked destination', () => {
    const move_guards = migrating_script
      .split('\n')
      .filter((line) => line.includes('-d ') && line.includes('! -L '));
    expect(move_guards.length).toBeGreaterThan(0);
    for (const guard of move_guards) {
      expect(guard.match(/! -L /gu)?.length ?? 0).toBeGreaterThanOrEqual(1);
    }
    expect(migrating_script).toContain(`! -L '${workspace_root}/files'`);
  });
});

describe('volume_ownership_script', () => {
  const script = volume_ownership_script(volume_root, agent_id, '1000:1000');

  it('hands over the agent workspace and nothing above it', () => {
    expect(script).toContain(`'${workspace_root}'`);
    expect(script).not.toContain(`find '${volume_root}' `);
    expect(script).not.toContain(`'${volume_root}/agents'`);
  });
});

describe('sandbox_bind_script', () => {
  const script = sandbox_bind_script(volume_root, agent_id);

  it('mounts the agent workspace at the model root', () => {
    expect(script).toContain(
      `mount --bind '${workspace_root}' '${current_workspace_layout.model_root}'`,
    );
  });

  it('never changes permissions on the mount root', () => {
    expect(script).not.toContain('chmod');
  });
});

describe('volume_layout_complete_script', () => {
  it('passes only when the tree matches this layout version', () => {
    const script = volume_layout_complete_script(volume_root, agent_id, '1000:1000');

    expect(script).toContain(`"layout_version": *${current_workspace_layout.layout_version}`);
    for (const folder of current_workspace_layout.folders) {
      expect(script).toContain(`[ -d '${workspace_root}/${folder.path}' ]`);
    }
  });
});

describe('legacy v1 directories at the root of the disk', () => {
  it('takes the initialize path once while either one still exists', () => {
    const probe = volume_layout_complete_script(volume_root, agent_id, '1000:1000');

    expect(probe).toContain(`[ ! -e '${volume_root}/workspace' ]`);
    expect(probe).toContain(`[ ! -e '${volume_root}/system' ]`);
  });

  it('stops gating once the cleanup has run, whatever it managed to remove', () => {
    const probe = volume_layout_complete_script(volume_root, agent_id, '1000:1000');
    const cleanup = legacy_layout_cleanup_script(volume_root, agent_id);

    expect(probe).toContain(`[ -f '${workspace_root}/${legacy_cleanup_marker}' ] ||`);
    expect(cleanup).toContain(`> '${workspace_root}/${legacy_cleanup_marker}'`);
  });

  it('sweeps the retired entries out of the workspace', () => {
    const cleanup = legacy_layout_cleanup_script(volume_root, agent_id);

    for (const name of ['artifacts', 'downloads', 'screenshots', 'logs', '.agent-browser']) {
      expect(cleanup).toContain(`[ -L '${workspace_root}/${name}' ]`);
      expect(cleanup).toContain(`rmdir '${workspace_root}/${name}'`);
    }
    expect(cleanup).not.toContain('rm -rf');
  });

  it('removes them with rmdir, which cannot touch a directory that still holds files', () => {
    const cleanup = legacy_layout_cleanup_script(volume_root, agent_id);

    expect(cleanup).toContain(`rmdir '${volume_root}/workspace'`);
    expect(cleanup).toContain(`rmdir '${volume_root}/system'`);
    expect(cleanup).not.toContain('rm -rf');
    expect(cleanup).not.toContain('rm -r');
  });

  it('is not attempted by the step that runs as the sandbox user', () => {
    expect(volume_initialization_script(volume_root, agent_id)).not.toContain(
      `rmdir '${volume_root}/workspace'`,
    );
  });
});

describe('sandbox_workspace_link_script', () => {
  const script = sandbox_workspace_link_script('run_test', '/mnt/coworker');

  it('bakes the browser outside HOME, so a cold sandbox never re-downloads Chrome', () => {
    expect(baked_browser_home.startsWith(sandbox_home_directory)).toBe(false);
    expect(baked_browser_home.startsWith('/tmp')).toBe(false);
  });

  it('links the browser cache in HOME to wherever the image baked it', () => {
    expect(script).toContain(
      `ln -s -- '${baked_browser_home}/.agent-browser/browsers' '${sandbox_home_directory}/.agent-browser/browsers'`,
    );
  });

  it('does not link when the image has no baked browser', () => {
    expect(script).toContain(`if [ -d '${baked_browser_home}/.agent-browser/browsers' ]`);
  });

  it('keeps saved logins and sessions on the durable volume, not in the image', () => {
    for (const kind of ['sessions', 'auth']) {
      expect(script).toContain(`${current_workspace_layout.model_root}/system/browser/${kind}`);
    }
  });

  it('sweeps spilled tool output older than a week', () => {
    expect(script).toContain(
      `find '${current_workspace_layout.model_root}/${current_workspace_layout.tool_output_folder}' -type f -mtime +7 -delete`,
    );
  });

  it('deletes nothing from a workspace the platform did not lay out', () => {
    const older = sandbox_workspace_link_script(
      'run_test',
      '/mnt/coworker',
      workspace_layout_for_version(1),
    );
    expect(older).not.toContain('-delete');
  });
});

describe('a volume still on layout v1', () => {
  const v1 = workspace_layout_for_version(1);

  it('binds its own tree where the tools look', () => {
    const script = sandbox_bind_script(volume_root, agent_id, v1);
    expect(script).toContain(`mount --bind '${volume_root}/workspace' '/workspace'`);
    expect(script).not.toContain('/agents/');
  });

  it('keeps the name its own files use', () => {
    expect(sandbox_bind_script(volume_root, agent_id, v1)).toContain(
      `[ -e '/work' ] || ln -s -- '/workspace' '/work'`,
    );
  });

  it('is initialized by nothing at all beyond its own root existing', () => {
    expect(volume_initialization_script(volume_root, agent_id, v1)).toBe(
      ['set -euo pipefail', `mkdir -p -- '${volume_root}/workspace'`].join('\n'),
    );
  });

  it('moves its files only when an operator asks for it', () => {
    const migrating = volume_initialization_script(volume_root, agent_id, undefined, {
      migrate_existing_layout: true,
    });
    expect(migrating).toContain('files/legacy-repo');
    expect(migrating).toContain('system/layout.json');
  });

  it('hands over its own tree and nothing above it', () => {
    expect(volume_ownership_script(volume_root, agent_id, 'agent:agent', v1)).toContain(
      `${volume_root}/workspace`,
    );
  });

  it('is judged complete on what it actually has', () => {
    const probe = volume_layout_complete_script(volume_root, agent_id, 'agent:agent', v1);
    expect(probe.split('\n')).toEqual([
      'set -euo pipefail',
      `[ -d '${volume_root}/workspace' ]`,
      `[ "$(stat -c '%u:%g' '${volume_root}/workspace')" = 'agent:agent' ]`,
      `[ -d '${volume_root}/system/browser-sessions' ]`,
      `[ -d '${volume_root}/system/browser-auth' ]`,
    ]);
  });

  it('asks for nothing inside the workspace that the workspace does not already have', () => {
    const probe = volume_layout_complete_script(volume_root, agent_id, 'agent:agent', v1);
    const workspace_paths = probe
      .match(/'[^']*'/gu)
      ?.filter((quoted) => quoted.includes(`${volume_root}/workspace/`));
    expect(workspace_paths ?? []).toEqual([]);
  });

  it('still holds the current layout to every artifact it does create', () => {
    const probe = volume_layout_complete_script(volume_root, agent_id, 'agent:agent');
    expect(probe).toContain('system/layout.json');
    expect(probe).toContain('README.md');
    expect(probe).toContain('/people');
  });

  it('refuses a layout version this deploy does not know', () => {
    expect(() => workspace_layout_for_version(99)).toThrow(/does not know/u);
  });
});

describe('the folders a sandbox creates', () => {
  it('are the ones the volume’s own layout declares', () => {
    expect(workspace_directories_for_layout(workspace_layout_for_version(1))).toEqual([]);
    expect(workspace_directories_for_layout(workspace_layout_for_version(2))).toContain('people');
  });
});

describe('browser state paths', () => {
  const v1 = workspace_layout_for_version(1);
  const v2 = workspace_layout_for_version(2);

  it('keeps an older volume reading the folder it already filled', () => {
    expect(browser_state_path_on_volume('/mnt/coworker', 'ag_1', 'sessions', v1)).toBe(
      '/mnt/coworker/system/browser-sessions',
    );
    expect(browser_state_path_on_volume('/mnt/coworker', 'ag_1', 'auth', v1)).toBe(
      '/mnt/coworker/system/browser-auth',
    );
  });

  it('keeps the current layout inside the agent workspace, where its folder list puts it', () => {
    expect(browser_state_path_on_volume('/mnt/coworker', 'ag_1', 'sessions', v2)).toBe(
      '/mnt/coworker/agents/ag_1/workspace/system/browser/sessions',
    );
  });

  it('addresses the sandbox side through the bind for the current layout only', () => {
    expect(browser_state_path_in_sandbox('/mnt/coworker', 'sessions', v2)).toBe(
      '/workspace/system/browser/sessions',
    );
    expect(browser_state_path_in_sandbox('/mnt/coworker', 'sessions', v1)).toBe(
      '/mnt/coworker/system/browser-sessions',
    );
  });

  it('links HOME at the path the volume actually uses', () => {
    const older = sandbox_workspace_link_script('run_test', '/mnt/coworker', v1);
    expect(older).toContain(
      `ln -s -- '/mnt/coworker/system/browser-sessions' '${sandbox_home_directory}/.agent-browser/sessions'`,
    );
    expect(older).not.toContain('/workspace/system/browser/sessions');
  });

  it('makes the directory it is about to link, on both layouts', () => {
    expect(volume_ownership_script('/mnt/coworker', 'ag_1', '1000:1000', v1)).toContain(
      "mkdir -p -- '/mnt/coworker/system/browser-sessions'",
    );
    expect(volume_ownership_script('/mnt/coworker', 'ag_1', '1000:1000', v2)).toContain(
      "mkdir -p -- '/mnt/coworker/agents/ag_1/workspace/system/browser/auth'",
    );
  });
});
