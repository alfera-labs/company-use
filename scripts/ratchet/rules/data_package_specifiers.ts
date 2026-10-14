export const data_package_names: readonly string[] = [
  '@coworker/core',
  '@coworker/db',
  '@coworker/db-connection',
  '@coworker/credentials',
  '@coworker/integrations',
  '@coworker/templates',
  '@coworker/access',
  '@coworker/billing',
  '@coworker/connections',
  '@coworker/workspaces',
  '@coworker/events',
  '@coworker/sessions',
  '@coworker/automations',
];

export function matches_data_package_name(specifier: string, name: string): boolean {
  return specifier === name || specifier.startsWith(`${name}/`);
}

export function is_data_package_specifier(specifier: string): boolean {
  return data_package_names.some((name) => matches_data_package_name(specifier, name));
}

export function find_data_package_name(specifier: string): string | undefined {
  return data_package_names.find((name) => matches_data_package_name(specifier, name));
}
