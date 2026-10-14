import { deploy_api_address } from '@coworker/ui/lib/company_use_deploy/deploy_api';
import { DeployStopped } from '@coworker/ui/lib/company_use_deploy/deploy_problems';
import type { DeploySession } from '@coworker/ui/lib/company_use_deploy/deploy_session';

const most_user_data_bytes = 16 * 1024;

export const first_boot_script_address = (version: string) =>
  `https://raw.githubusercontent.com/alfera-labs/company-use/${encodeURIComponent(version)}/deploy/first_boot.sh`;

const quote_for_a_shell = (value: string) => `'${value.replaceAll("'", `'\\''`)}'`;

export const report_address = (session: DeploySession) =>
  deploy_api_address(session.api_origin, 'report');

const value_patterns: Record<string, RegExp> = {
  ALFERA_INSTALL_ID: /^[0-9a-f-]{36}$/,
  ALFERA_SETUP_TOKEN: /^[A-Za-z0-9_-]{43}$/,
  ALFERA_REPORT_TOKEN: /^[A-Za-z0-9_-]{43}$/,
  ALFERA_REPORT_URL: /^https:\/\/[A-Za-z0-9./_-]+$/,
  ALFERA_NAME: /^[a-z0-9]{0,20}$/,
  ALFERA_VERSION: /^[A-Za-z0-9._-]+$/,
};
const test_report_url_pattern = /^https?:\/\/[A-Za-z0-9.:/_-]+$/;

export type FirstBootValues = [string, string | undefined][];

function check_values(values: FirstBootValues, is_test: boolean) {
  for (const [name, value] of values) {
    const pattern =
      is_test && name === 'ALFERA_REPORT_URL' ? test_report_url_pattern : value_patterns[name];
    if (value !== undefined && pattern && !pattern.test(value)) {
      console.error(`[company-use-deploy] ${name} has a shape the server cannot use`);
      throw new DeployStopped('unexpected');
    }
  }
  return values;
}

export function first_boot_values(session: DeploySession): FirstBootValues {
  const overrides = session.test_overrides ?? {};
  const values: FirstBootValues = [
    ['ALFERA_INSTALL_ID', session.install_id],
    ['ALFERA_SETUP_TOKEN', session.setup_token],
    ['ALFERA_REPORT_TOKEN', session.report_token],
    ['ALFERA_REPORT_URL', report_address(session)],
    ['ALFERA_NAME', session.name],
    ['ALFERA_VERSION', session.version],
    ['ALFERA_REGISTRY_USER', overrides.registry_user],
    ['ALFERA_REGISTRY_TOKEN', overrides.registry_token],
    ['ALFERA_SOURCE_ARCHIVE_URL', overrides.source_archive_url],
    ['ALFERA_INSTALL_FILES_URL', overrides.install_files_url],
  ];
  return check_values(values, session.test_overrides !== null);
}

export function add_values_to_the_script(script: string, values: FirstBootValues) {
  const [first_line, ...rest] = script.split('\n');
  if (!first_line?.startsWith('#!')) throw new DeployStopped('script_not_found');
  const exports = values
    .filter((entry): entry is [string, string] => entry[1] !== undefined)
    .map(([name, value]) => `export ${name}=${quote_for_a_shell(value)}`);
  const user_data = [first_line, ...exports, ...rest].join('\n');
  if (new TextEncoder().encode(user_data).length > most_user_data_bytes) {
    throw new DeployStopped('script_not_found');
  }
  return user_data;
}

export async function build_user_data(session: DeploySession) {
  const address =
    session.test_overrides?.first_boot_url ?? first_boot_script_address(session.version);
  const answer = await fetch(address, { cache: 'no-store' }).catch((error: unknown) => {
    console.warn('[company-use-deploy] the setup script did not download', error);
    throw new DeployStopped('script_not_found');
  });
  if (!answer.ok) throw new DeployStopped('script_not_found');
  return add_values_to_the_script(await answer.text(), first_boot_values(session));
}
