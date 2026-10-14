import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec_file = promisify(execFile);

export const sandbox_image = 'node:24-bookworm';

export async function wait_for_the_sandbox_image() {
  const is_here = await exec_file('docker', [
    'image',
    'inspect',
    '--format',
    '{{.Id}}',
    sandbox_image,
  ]).then(
    () => true,
    () => false,
  );
  if (is_here) return;
  await exec_file('docker', ['pull', '--quiet', sandbox_image]).catch((error: unknown) => {
    throw new Error(
      `The sandbox image ${sandbox_image} is not on this server and did not download. Check that the server reaches the internet, then try again. ${String(error)}`,
    );
  });
}
