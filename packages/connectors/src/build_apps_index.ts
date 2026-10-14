import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

export const connector_apps_index_path = 'src/apps/index.ts';

type AppSource = { app_key: string; source_path: string };
type NodeSource = {
  app_key: string;
  node_name: string;
  node_version: number;
  source_path: string;
  has_execute: boolean;
};

async function list_directory_names(directory: string) {
  const entries = await readdir(directory, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

async function list_file_names(directory: string) {
  const entries = await readdir(directory, { withFileTypes: true });
  return entries.filter((entry) => entry.isFile()).map((entry) => entry.name);
}

async function collect_app_sources(apps_directory: string) {
  const apps: AppSource[] = [];
  const nodes: NodeSource[] = [];

  for (const app_key of await list_directory_names(apps_directory)) {
    const app_directory = join(apps_directory, app_key);
    const app_files = await list_file_names(app_directory);
    if (!app_files.includes('app.json')) {
      throw new Error(`Connector app folder has no app.json: apps/${app_key}`);
    }
    apps.push({ app_key, source_path: `apps/${app_key}/app.json` });

    for (const node_name of await list_directory_names(app_directory)) {
      const node_directory = join(app_directory, node_name);
      for (const version_folder of await list_directory_names(node_directory)) {
        const version_match = /^v(\d+)$/u.exec(version_folder);
        if (!version_match) {
          throw new Error(
            `Connector version folder must be v{n}: apps/${app_key}/${node_name}/${version_folder}`,
          );
        }
        const version_files = await list_file_names(join(node_directory, version_folder));
        if (!version_files.includes('node.json')) {
          throw new Error(
            `Connector version folder has no node.json: apps/${app_key}/${node_name}/${version_folder}`,
          );
        }
        nodes.push({
          app_key,
          node_name,
          node_version: Number(version_match[1]),
          source_path: `apps/${app_key}/${node_name}/${version_folder}/node.json`,
          has_execute: version_files.includes('execute.ts'),
        });
      }
    }
  }

  return { apps, nodes };
}

function app_identifier(app: AppSource) {
  return `${app.app_key}_app_definition`;
}

function node_identifier(node: NodeSource) {
  return `${node.app_key}_${node.node_name}_v${node.node_version}`;
}

function execute_specifier(node: NodeSource) {
  return `@connectors/${node.source_path.replace(/node\.json$/u, 'execute')}`;
}

export async function build_apps_index_source(package_directory: string) {
  const { apps, nodes } = await collect_app_sources(join(package_directory, 'src/apps'));
  const import_lines = [
    {
      specifier: '@connectors/types',
      line: "import type { ConnectorAppModule, ConnectorNodeModule } from '@connectors/types';",
    },
    ...apps.map((app) => {
      const specifier = `@connectors/${app.source_path}`;
      return {
        specifier,
        line: `import ${app_identifier(app)} from '${specifier}' with { type: 'json' };`,
      };
    }),
    ...nodes.map((node) => {
      const specifier = `@connectors/${node.source_path}`;
      return {
        specifier,
        line: `import ${node_identifier(node)}_definition from '${specifier}' with { type: 'json' };`,
      };
    }),
    ...nodes
      .filter((node) => node.has_execute)
      .map((node) => ({
        specifier: execute_specifier(node),
        line: `import * as ${node_identifier(node)}_execute from '${execute_specifier(node)}';`,
      })),
  ]
    .sort((left, right) => left.specifier.localeCompare(right.specifier))
    .map((entry) => entry.line);

  const app_entries = apps.map(
    (app) => `  { source_path: '${app.source_path}', definition: ${app_identifier(app)} },`,
  );
  const node_entries = nodes.map((node) => {
    const execute_entry = node.has_execute
      ? `, execute_module: ${node_identifier(node)}_execute`
      : '';
    return `  { source_path: '${node.source_path}', definition: ${node_identifier(node)}_definition${execute_entry} },`;
  });

  return [
    ...import_lines,
    '',
    'export const connector_app_modules: readonly ConnectorAppModule[] = [',
    ...app_entries,
    '];',
    '',
    'export const connector_node_modules: readonly ConnectorNodeModule[] = [',
    ...node_entries,
    '];',
    '',
  ].join('\n');
}
