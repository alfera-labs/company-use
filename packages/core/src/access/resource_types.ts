export type ResourceDefaultAccess = 'everyone_in_the_workspace' | 'nobody';

export type ResourceTypeDefinition = {
  resource_label: string;
  default_access: ResourceDefaultAccess;
};

export const resource_type_definitions = {
  project: { resource_label: 'Project', default_access: 'nobody' },
  connection: { resource_label: 'Connection', default_access: 'everyone_in_the_workspace' },
  node: { resource_label: 'Tool', default_access: 'everyone_in_the_workspace' },
  agent: { resource_label: 'Coworker', default_access: 'everyone_in_the_workspace' },
  trigger: { resource_label: 'Scheduled task', default_access: 'everyone_in_the_workspace' },
  channel: { resource_label: 'Channel', default_access: 'everyone_in_the_workspace' },
  memory_scope: { resource_label: 'Memory scope', default_access: 'nobody' },
} as const satisfies Record<string, ResourceTypeDefinition>;

type ResourceType = keyof typeof resource_type_definitions;

export const resource_types = Object.keys(resource_type_definitions) as readonly ResourceType[];

export const memory_scope_resource_type: ResourceType = 'memory_scope';

function is_resource_type(value: string): value is ResourceType {
  return Object.hasOwn(resource_type_definitions, value);
}

export function find_resource_type_definition(
  resource_type: string,
): ResourceTypeDefinition | null {
  return is_resource_type(resource_type) ? resource_type_definitions[resource_type] : null;
}

export function read_resource_type_definition(resource_type: string): ResourceTypeDefinition {
  const definition = find_resource_type_definition(resource_type);
  if (!definition) {
    throw new Error(
      `Unknown resource_type "${resource_type}". Add it to resource_type_definitions.`,
    );
  }
  return definition;
}
