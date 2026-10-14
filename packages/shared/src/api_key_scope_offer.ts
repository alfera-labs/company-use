const scopes_of_alfera_cloud_features = new Set<string>([
  'answers.write',
  'memory.read',
  'memory.write',
  'usage.read',
]);

export function keep_offered_scopes<Scope extends string>(scopes: readonly Scope[]): Scope[] {
  return scopes.filter((scope) => !scopes_of_alfera_cloud_features.has(scope));
}
