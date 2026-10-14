import type { DeploySession } from '@coworker/ui/lib/company_use_deploy/deploy_session';
import { first_boot_values } from '@coworker/ui/lib/company_use_deploy/first_boot_user_data';
import { test_resource_prefix } from '@coworker/ui/lib/company_use_deploy/test_overrides';

const regions_by_part_of_the_world: Record<string, string> = {
  Europe: 'eu-central-1',
  Africa: 'eu-central-1',
  America: 'us-east-1',
  Asia: 'ap-southeast-1',
  Australia: 'ap-southeast-2',
};

export function pick_aws_region(time_zone: string) {
  return regions_by_part_of_the_world[time_zone.split('/')[0] ?? ''] ?? 'us-east-1';
}

const parameter_name_by_value: Record<string, string> = {
  ALFERA_INSTALL_ID: 'InstallId',
  ALFERA_SETUP_TOKEN: 'SetupToken',
  ALFERA_REPORT_TOKEN: 'ReportToken',
  ALFERA_REPORT_URL: 'ReportUrl',
  ALFERA_NAME: 'Name',
  ALFERA_VERSION: 'Version',
  ALFERA_REGISTRY_USER: 'RegistryUser',
  ALFERA_REGISTRY_TOKEN: 'RegistryToken',
  ALFERA_SOURCE_ARCHIVE_URL: 'SourceArchiveUrl',
  ALFERA_INSTALL_FILES_URL: 'InstallFilesUrl',
};

function stack_name_of(session: DeploySession) {
  const prefix = session.test_overrides ? test_resource_prefix : 'alfera';
  const name_part = session.name ? `${session.name}-` : '';
  return `${prefix}-${name_part}${session.install_id.slice(0, 8)}`;
}

export function aws_quick_create_link(
  session: DeploySession,
  template_url: string,
  time_zone: string,
) {
  const region = pick_aws_region(time_zone);
  const values: Record<string, string | undefined> = {
    templateURL: template_url,
    stackName: stack_name_of(session),
  };
  for (const [name, value] of first_boot_values(session)) {
    values[`param_${parameter_name_by_value[name]}`] = value;
  }
  const query = new URLSearchParams(
    Object.entries(values).filter((entry): entry is [string, string] => Boolean(entry[1])),
  );
  return `https://${region}.console.aws.amazon.com/cloudformation/home?region=${region}#/stacks/create/review?${query}`;
}
