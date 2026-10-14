import path from 'node:path';

const workspace_root = '/workspace';

export function is_path_inside(root: string, candidate: string) {
  return candidate === root || candidate.startsWith(`${root}${path.sep}`);
}

export function assert_path_inside_workspace(root: string, candidate: string, given_path: string) {
  if (!is_path_inside(root, candidate)) throw new Error(workspace_path_escape_message(given_path));
}

export function workspace_path_escape_message(given_path: string): string {
  return `Path escapes workspace: ${given_path}. These tools only reach files under ${workspace_root}. ${remedy_for(given_path)}`;
}

function remedy_for(given_path: string): string {
  if (given_path === '/tmp' || given_path.startsWith('/tmp/')) {
    const suggested_path = `${workspace_root}/tmp/${given_path.slice('/tmp/'.length)}`;
    return (
      `The sandbox has its own /tmp, and a shell command can write there, but these tools cannot ` +
      `read it. Use ${workspace_root}/tmp instead — either write it there in the first place, or ` +
      `move it with \`mv ${given_path} ${suggested_path}\` and use that path.`
    );
  }
  return `Pass a path relative to the workspace (e.g. \`people/alice.md\`) or one under ${workspace_root}. For scratch files, ${workspace_root}/tmp is writable.`;
}
