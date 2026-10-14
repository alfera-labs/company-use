import { spawnSync } from 'node:child_process';
import { mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { e2b_workspace_root } from '@runtime-platform/orchestrator/e2b_command';
import {
  glob_shell_command,
  grep_shell_command,
  parse_grep_output,
  searcher_failure_message,
} from '@runtime-platform/orchestrator/e2b_sandbox_client';
import { Sandbox } from 'e2b';
import { describe, expect, it } from 'vitest';

function run_grep_branch(pattern: string, target_path: string, max_results = 100) {
  const command = grep_shell_command({ pattern }, target_path, max_results);
  const result = spawnSync('bash', ['-c', command], {
    encoding: 'utf8',
    env: { PATH: '/usr/bin:/bin' },
  });
  return { stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

function write_search_fixture(contents: string) {
  const directory = mkdtempSync(path.join(tmpdir(), 'grep-branch-'));
  const file_path = path.join(directory, 'orders.md');
  writeFileSync(file_path, contents);
  return file_path;
}

describe('grep_shell_command', () => {
  it('prefers ripgrep and falls back to grep in the same command', () => {
    const command = grep_shell_command({ pattern: 'needle' }, '/workspace', 100);

    expect(command).toContain('if command -v rg >/dev/null 2>&1; then');
    expect(command).toContain('rg --no-heading --line-number --with-filename');
    expect(command).toContain('--no-ignore --hidden');
    expect(command).not.toContain('--text');
    expect(command).toContain('else grep -E -RHnI');
    expect(command).toContain('head -n 100');
    expect(command).not.toContain('2>/dev/null || true');
  });

  it('forces the filename prefix on both searchers', () => {
    const command = grep_shell_command({ pattern: 'needle' }, '/workspace/one.ts', 10);

    expect(command).toContain('--with-filename');
    expect(command).toMatch(/grep -E -RHnI/);
  });

  it('asks both searchers for a case-insensitive match', () => {
    const command = grep_shell_command(
      { pattern: 'needle', case_sensitive: false },
      '/workspace',
      10,
    );

    expect(command).toContain('--ignore-case');
    expect(command).toContain('grep -E -RHInI');
  });

  it('quotes a pattern that would otherwise run as shell', () => {
    const command = grep_shell_command({ pattern: "'; rm -rf /; echo '" }, '/workspace', 10);

    expect(command).toContain(String.raw`'\''`);
    expect(command).not.toMatch(/[^\\']; rm -rf \//);
  });

  it('passes the pattern after -e so a leading dash is not read as a flag', () => {
    const command = grep_shell_command({ pattern: '--version' }, '/workspace', 10);

    expect(command).toContain("-e '--version'");
    expect(command).toContain("grep -E -RHnI -- '--version'");
  });

  it('finds an alternation match through the grep branch', () => {
    const file_path = write_search_fixture(
      'SHIPPING and handling\nCustoms Fee applies\nwarehouse\n',
    );

    const { stdout } = run_grep_branch('SHIPPING|Customs Fee', file_path);

    expect(stdout).toContain('SHIPPING and handling');
    expect(stdout).toContain('Customs Fee applies');
  });
});

describe('searcher_failure_message', () => {
  it('stays silent when the searcher matched', () => {
    const file_path = write_search_fixture('order shipped by courier\n');

    const { stderr } = run_grep_branch('order|courier', file_path);

    expect(searcher_failure_message(stderr)).toBeUndefined();
  });

  it('stays silent when the searcher matched nothing', () => {
    const file_path = write_search_fixture('order shipped by courier\n');

    const { stderr } = run_grep_branch('no-such-word', file_path);

    expect(searcher_failure_message(stderr)).toBeUndefined();
  });

  it('stays silent when head closes the pipe before the searcher finishes', () => {
    const file_path = write_search_fixture(`${'order\n'.repeat(5_000)}`);

    const { stdout, stderr } = run_grep_branch('order', file_path, 1);

    expect(stdout.split('\n').filter(Boolean)).toHaveLength(1);
    expect(searcher_failure_message(stderr)).toBeUndefined();
  });

  it('reports a pattern the searcher rejects', () => {
    const file_path = write_search_fixture('order shipped by courier\n');

    const { stdout, stderr } = run_grep_branch('order (shipped', file_path);

    expect(stdout).toBe('');
    expect(searcher_failure_message(stderr)).toBeTruthy();
  });

  it('reports a path the searcher cannot read', () => {
    const { stdout, stderr } = run_grep_branch('order', '/work/no/such/file.md');

    expect(stdout).toBe('');
    expect(searcher_failure_message(stderr)).toContain('No such file');
  });
});

describe('glob_shell_command', () => {
  it('follows the symlink a workspace directory is', () => {
    const volume = mkdtempSync(path.join(tmpdir(), 'glob-volume-'));
    const workspace_root = mkdtempSync(path.join(tmpdir(), 'glob-work-'));
    writeFileSync(path.join(volume, '04_PRICE_LIST.md'), 'order\n');
    symlinkSync(volume, path.join(workspace_root, 'docs'));

    const command = glob_shell_command('docs/*.md', 100);
    const result = spawnSync(
      'bash',
      ['-c', command.replaceAll(e2b_workspace_root, workspace_root)],
      { encoding: 'utf8' },
    );

    expect(command).toContain(`find -L ${e2b_workspace_root} -path`);
    expect(result.stdout).toContain('04_PRICE_LIST.md');
  });
});

describe.runIf(Boolean(process.env.E2B_API_KEY))('grep in the sandbox image', () => {
  it('finds an alternation match and reports a rejected pattern', async () => {
    const sandbox = await Sandbox.create('coworker-nextjs', { timeoutMs: 120_000 });
    try {
      await sandbox.files.write('/tmp/orders.md', 'SHIPPING and handling\nCustoms Fee applies\n');
      const search = (pattern: string) =>
        sandbox.commands.run(grep_shell_command({ pattern }, '/tmp/orders.md', 100));

      const alternation = await search('SHIPPING|Customs Fee');
      expect(alternation.stdout).toContain('SHIPPING and handling');
      expect(alternation.stdout).toContain('Customs Fee applies');
      expect(searcher_failure_message(alternation.stderr)).toBeUndefined();

      const rejected = await search('order (shipped');
      expect(rejected.stdout).toBe('');
      expect(searcher_failure_message(rejected.stderr)).toBeTruthy();
    } finally {
      await sandbox.kill();
    }
  }, 180_000);
});

describe('parse_grep_output', () => {
  it('keeps real matches', () => {
    expect(parse_grep_output('/workspace/a.ts:12:const x = 1')).toEqual([
      { path: 'a.ts', line: 12, text: 'const x = 1' },
    ]);
  });

  it('drops a searcher line that carries no line number', () => {
    const stdout = [
      '/workspace/a.ts:12:const x = 1',
      '/workspace/logo.png: binary file matches (found "\\0" byte around offset 5)',
    ].join('\n');

    expect(parse_grep_output(stdout)).toEqual([{ path: 'a.ts', line: 12, text: 'const x = 1' }]);
  });

  it('keeps a match whose own text contains colons', () => {
    expect(parse_grep_output('/workspace/a.ts:7:url: https://example.com')).toEqual([
      { path: 'a.ts', line: 7, text: 'url: https://example.com' },
    ]);
  });
});
