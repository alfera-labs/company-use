// Copies the packages that the bundles of the API image still read from disk at run time, and
// every package those depend on, into a new node_modules folder. `bun build` puts the code of
// all other packages inside the bundles, so the image does not carry them a second time
// (apps/api/Dockerfile).
//
//   bun scripts/copy_run_time_packages.ts <node_modules> <new node_modules> <bundle folder>...

import { cpSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

type PackageManifest = {
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
};

// A bundle asks for these by a name it puts together at run time, so `bun build` cannot follow
// the import. Each name is in the source of the package that its comment names.
const packages_imported_by_computed_name = [
  // rivetkit: the native core of the queue worker, and its WebAssembly twin.
  '@rivetkit/rivetkit-napi',
  '@rivetkit/rivetkit-wasm',
  // rivetkit: finds the Rivet Engine binary. The engine service starts that binary.
  '@rivetkit/engine-cli',
  '@rivet-dev/services',
  // Sentry: registers this module loader hook by name.
  'import-in-the-middle',
];

const [node_modules_argument, target_argument, ...bundle_folders] = process.argv.slice(2);
if (!node_modules_argument || !target_argument || bundle_folders.length === 0) {
  throw new Error(
    'usage: copy_run_time_packages.ts <node_modules> <new node_modules> <bundle folder>...',
  );
}
const node_modules = resolve(node_modules_argument);
const target = resolve(target_argument);

// For a CommonJS file, `bun build` writes the folder the file came from into the bundle as its
// __dirname. A package named that way reads its own files from that folder: a native module, a
// worker thread file, a .proto or .wasm file.
function find_packages_named_by_folder() {
  const folder_in_pattern = node_modules.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const package_pattern = new RegExp(`${folder_in_pattern}/((?:@[\\w.-]+/)?[\\w.-]+)`, 'g');
  const names = new Set<string>();
  for (const bundle_folder of bundle_folders) {
    for (const file_name of readdirSync(bundle_folder)) {
      if (!file_name.endsWith('.js')) continue;
      const bundle_text = readFileSync(join(bundle_folder, file_name), 'utf8');
      for (const match of bundle_text.matchAll(package_pattern)) names.add(match[1] as string);
    }
  }
  return [...names];
}

// The folders of the packages in one node_modules folder. A scope folder holds packages too.
function list_package_folders(node_modules_folder: string): string[] {
  if (!existsSync(node_modules_folder)) return [];
  return readdirSync(node_modules_folder).flatMap((name) => {
    if (name.startsWith('.')) return [];
    const folder = join(node_modules_folder, name);
    return name.startsWith('@') ? list_package_folders(folder) : [folder];
  });
}

// The dependencies of a package, and of each other version of a package that sits inside it.
function read_dependency_names(package_folder: string): string[] {
  const manifest_path = join(package_folder, 'package.json');
  if (!existsSync(manifest_path)) return [];
  const manifest: PackageManifest = JSON.parse(readFileSync(manifest_path, 'utf8'));
  const nested_folders = list_package_folders(join(package_folder, 'node_modules'));
  return [
    ...Object.keys({ ...manifest.dependencies, ...manifest.optionalDependencies }),
    ...nested_folders.flatMap(read_dependency_names),
  ];
}

// An optional dependency for another platform is not installed. It is skipped.
function add_package_with_dependencies(package_name: string, kept_names: Set<string>) {
  const package_folder = join(node_modules, package_name);
  if (kept_names.has(package_name) || !existsSync(package_folder)) return;
  kept_names.add(package_name);
  for (const dependency_name of read_dependency_names(package_folder)) {
    add_package_with_dependencies(dependency_name, kept_names);
  }
}

const run_time_names = [...packages_imported_by_computed_name, ...find_packages_named_by_folder()];
const not_installed = run_time_names.filter((name) => !existsSync(join(node_modules, name)));
if (not_installed.length > 0) {
  throw new Error(`a bundle needs a package that is not installed: ${not_installed.join(', ')}`);
}

const kept_names = new Set<string>();
for (const name of run_time_names) add_package_with_dependencies(name, kept_names);
for (const name of kept_names) {
  cpSync(join(node_modules, name), join(target, name), { recursive: true, verbatimSymlinks: true });
}
console.log(
  `copied ${kept_names.size} packages for the ${run_time_names.length} that a bundle reads at run time: ${run_time_names.sort().join(', ')}`,
);
