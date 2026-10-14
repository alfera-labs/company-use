import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';

// Every file git would commit: tracked files plus new untracked ones, minus anything ignored.
// Asking git instead of walking the tree means node_modules, build output and .context never
// need their own skip list, and a brand-new file is checked before anyone runs `git add`.
export function list_repository_files(include: (repository_path: string) => boolean) {
  const output = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  return output
    .split('\n')
    .filter((repository_path) => repository_path !== '' && include(repository_path))
    .filter((repository_path) => existsSync(repository_path))
    .sort();
}
