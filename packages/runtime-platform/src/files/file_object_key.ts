import { generate_safe_file_name } from '@runtime-platform/files/safe_file_name';

export function generate_file_object_key(input: {
  workspace_id: string;
  file_id: string;
  file_name: string;
}) {
  return [
    'workspace',
    input.workspace_id,
    'files',
    input.file_id,
    generate_safe_file_name(input.file_name),
  ].join('/');
}

const workspace_object_key_roots = ['workspace', 'workspaces', 'ws'] as const;

export function is_file_object_key_inside_workspace(object_key: string, workspace_id: string) {
  const [root, key_workspace_id] = object_key.split('/');
  if (!root || !key_workspace_id) return false;
  return (
    (workspace_object_key_roots as readonly string[]).includes(root) &&
    key_workspace_id === workspace_id
  );
}
