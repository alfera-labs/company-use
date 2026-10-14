import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';

const exec_file = promisify(execFile);
const repository_root = path.resolve(import.meta.dirname, '../../..');

export async function current_git_version() {
  try {
    const result = await exec_file('git', ['rev-parse', '--short', 'HEAD'], {
      cwd: repository_root,
    });
    return result.stdout.trim() || 'unknown';
  } catch {
    return 'unknown';
  }
}
