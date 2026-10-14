import { writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { build_apps_index_source, connector_apps_index_path } from '@connectors/build_apps_index';

const package_directory = resolve(process.cwd(), 'packages/connectors');
const source = await build_apps_index_source(package_directory);
const index_path = join(package_directory, connector_apps_index_path);
await writeFile(index_path, source, 'utf8');
console.log(`wrote ${connector_apps_index_path}`);
