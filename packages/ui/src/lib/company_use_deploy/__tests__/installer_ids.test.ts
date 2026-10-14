import { existsSync, readFileSync } from 'node:fs';
import { box_reason_sentences } from '@coworker/ui/lib/company_use_deploy/deploy_problems';
import { row_records } from '@coworker/ui/lib/company_use_deploy/progress_rows';
import { assert, describe, test } from 'vitest';

const repository_root = new URL('../../../../../../', import.meta.url);
const deploy_folder = ['deploy/', 'oss/overlay/deploy/']
  .map((folder) => new URL(folder, repository_root))
  .find((folder) => existsSync(new URL('install.sh', folder)));
if (!deploy_folder) throw new Error('The installer folder is missing.');
const install_script = readFileSync(new URL('install.sh', deploy_folder), 'utf8');
const first_boot_script = readFileSync(new URL('first_boot.sh', deploy_folder), 'utf8');
const whole_install_step = 'install';

const all_matches = (text: string, pattern: RegExp) =>
  [...text.matchAll(pattern)].map((match) => match[1] ?? '');

function reasons_with_a_sentence_in_the_installer() {
  const start = install_script.indexOf('plain_sentence_for() {');
  const body = install_script.slice(start, install_script.indexOf('\n}\n', start));
  return all_matches(body, /^\s+([a-z_ |]+)\) printf/gm).flatMap((labels) =>
    labels.split('|').map((label) => label.trim()),
  );
}

const installer_steps = new Set([
  ...all_matches(install_script, /\brun_step ([a-z_]+)/g),
  ...all_matches(install_script, /^current_step='([a-z_]+)'/gm),
  ...all_matches(first_boot_script, /\bsend_report ([a-z_]+) started/g),
  ...all_matches(first_boot_script, /\bstop_with ([a-z_]+) [a-z_]+/g),
]);

const installer_reasons = new Set([
  ...reasons_with_a_sentence_in_the_installer(),
  ...all_matches(first_boot_script, /\bstop_with [a-z_]+ ([a-z_]+)/g),
]);

describe('the deploy page and the installer', () => {
  test('know the same progress steps', () => {
    const page_steps = row_records.flatMap((record) => record.steps);
    const steps_of_a_row = [...installer_steps].filter((step) => step !== whole_install_step);
    assert.ok(installer_steps.has(whole_install_step));
    assert.deepEqual([...page_steps].sort(), steps_of_a_row.sort());
  });

  test('give a sentence only to reasons the installer stops with', () => {
    assert.ok(installer_reasons.size > 30);
    const unknown = Object.keys(box_reason_sentences).filter((r) => !installer_reasons.has(r));
    assert.deepEqual(unknown, []);
  });
});
