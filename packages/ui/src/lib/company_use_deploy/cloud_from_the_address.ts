import { type CloudName, cloud_names } from '@coworker/ui/lib/company_use_deploy/deploy_words';

const is_cloud_name = (value: string | null): value is CloudName =>
  cloud_names.some((cloud) => cloud === value);

export function read_cloud_from_the_address(search: string): CloudName | null {
  const value = new URLSearchParams(search).get('cloud');
  return is_cloud_name(value) ? value : null;
}
