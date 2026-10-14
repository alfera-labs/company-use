import { workspace_path_escape_message } from '@agent-core/environment/workspace_path_escape';
import { describe, expect, it } from 'vitest';

describe('workspace_path_escape_message', () => {
  it('keeps the prefix the error classifier matches on', () => {
    expect(
      workspace_path_escape_message('/etc/passwd').startsWith('Path escapes workspace: '),
    ).toBe(true);
  });

  it('tells the agent where to put a /tmp file, with a command that moves it', () => {
    const message = workspace_path_escape_message('/tmp/apulian_pages/page-13.png');

    expect(message).toContain('/tmp/apulian_pages/page-13.png');
    expect(message).toContain('/workspace/tmp');
    expect(message).toContain(
      'mv /tmp/apulian_pages/page-13.png /workspace/tmp/apulian_pages/page-13.png',
    );
    expect(message).toMatch(/shell command can write there/u);
  });

  it('handles bare /tmp without producing a broken suggestion', () => {
    const message = workspace_path_escape_message('/tmp');
    expect(message).toContain('/workspace/tmp');
    expect(message).not.toContain('undefined');
  });

  it('gives general guidance for a path that is not under /tmp', () => {
    const message = workspace_path_escape_message('/mnt/coworker/workspace/artifacts');
    expect(message).toContain('relative to the workspace');
    expect(message).not.toContain('mv ');
  });
});
