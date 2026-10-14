const generated_file_names = new Set(['routeTree.gen.ts', 'next-env.d.ts']);
const generated_file_paths = new Set(['packages/connectors/src/apps/index.ts']);
const build_output_directories = new Set(['dist', '.next', 'node_modules', 'coverage']);
const source_roots = ['apps/', 'packages/'];

function has_build_output_directory(file_path: string): boolean {
  return file_path.split('/').some((segment) => build_output_directories.has(segment));
}

export function is_generated_file(file_path: string): boolean {
  const file_name = file_path.split('/').at(-1) ?? '';
  return generated_file_names.has(file_name) || generated_file_paths.has(file_path);
}

export function is_source_file(file_path: string): boolean {
  if (!source_roots.some((root) => file_path.startsWith(root))) return false;
  return !is_generated_file(file_path) && !has_build_output_directory(file_path);
}

export function is_test_file(file_path: string): boolean {
  return file_path.includes('/__tests__/') || /\.(test|spec)\.[cm]?tsx?$/u.test(file_path);
}

export function is_source_file_outside_tests(file_path: string): boolean {
  return is_source_file(file_path) && !is_test_file(file_path);
}
