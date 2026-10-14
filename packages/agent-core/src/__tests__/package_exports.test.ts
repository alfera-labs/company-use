import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const package_directory = resolve(import.meta.dirname, '../..');

describe('@agent-core package exports', () => {
  it('points every concrete export at a file that exists', () => {
    const package_json = JSON.parse(
      readFileSync(resolve(package_directory, 'package.json'), 'utf8'),
    ) as {
      exports: Record<string, string>;
    };

    for (const [export_name, export_target] of Object.entries(package_json.exports)) {
      if (export_target.includes('*')) continue;

      expect(
        existsSync(resolve(package_directory, export_target)),
        `${export_name} points at missing file ${export_target}`,
      ).toBe(true);
    }
  });
});
