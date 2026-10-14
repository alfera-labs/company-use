import type { RuntimeJsonSchema } from '@agent-core/tools/runtime_tool';
import {
  canonical_shell_working_directory,
  find_workspace_tool,
} from '@runtime-platform/tools/tool_execution_service';
import { describe, expect, it } from 'vitest';

// What the provider actually receives. pi-ai's convertTools builds an explicit object and keeps
// only these three keys of our input_schema (dist/api/anthropic-messages.js, non-strict branch):
//
//   const legacyInputSchema = { type: "object", properties: schema.properties ?? {},
//                               required: schema.required ?? [] };
//
// So a tool-level `input_examples`, or an `examples` array at the schema root, is silently
// dropped and never reaches the model. Anything nested inside `properties` rides through
// verbatim. These tests pin guidance to the surviving half, because guidance that does not
// reach the wire is a comment we are paying to maintain.
function wire_input_schema(input_schema: RuntimeJsonSchema | undefined) {
  return {
    type: 'object',
    properties: input_schema?.properties ?? {},
    required: input_schema?.required ?? [],
  };
}

function wire_property(tool_name: string, property_name: string) {
  const tool = find_workspace_tool(tool_name);
  expect(tool, `${tool_name} is not a registered workspace tool`).toBeDefined();
  const property = wire_input_schema(tool?.input_schema).properties[property_name] as
    | RuntimeJsonSchema
    | undefined;
  expect(
    property,
    `${tool_name}.${property_name} did not survive the wire reduction`,
  ).toBeDefined();
  return property as RuntimeJsonSchema;
}

const tools_taking_a_workspace_path: [string, string][] = [
  ['workspace-list_files', 'path'],
  ['workspace-read_file', 'path'],
  ['workspace-read_document', 'path'],
  ['workspace-view_image', 'path'],
  ['workspace-write_file', 'path'],
  ['workspace-edit_file', 'path'],
  ['workspace-grep', 'path'],
  ['workspace-run_command', 'cwd'],
  ['workspace-start_background_command', 'cwd'],
  ['workspace-preview', 'cwd'],
];

describe('workspace path guidance reaches the provider', () => {
  it.each(
    tools_taking_a_workspace_path,
  )('%s.%s names /work and the tmp/ scratch rule', (tool_name, property_name) => {
    const property = wire_property(tool_name, property_name);

    expect(property.description).toContain('/work');
    expect(property.description).toContain('/tmp');
    expect(property.description).toContain('tmp/');
  });

  it.each(
    tools_taking_a_workspace_path,
  )('%s.%s carries worked examples', (tool_name, property_name) => {
    const property = wire_property(tool_name, property_name);

    expect(property.examples).toEqual([
      'repo/src/index.ts',
      'tmp/scratch.json',
      'artifacts/report.pdf',
    ]);
  });

  it('offers no example that the workspace tools would reject', () => {
    const property = wire_property('workspace-read_file', 'path');
    const examples = property.examples as string[];

    for (const example of examples) expect(example.startsWith('/tmp')).toBe(false);
  });

  it('teaches run_command that a bare shell line is a legal command', () => {
    const command = wire_property('workspace-run_command', 'command');

    expect(command.description).toContain('shell line');
    expect((command.examples as string[]).some((example) => example.includes('|'))).toBe(true);
  });

  it('spends its tokens on the fields that failed, not on every string in the schema', () => {
    const guidance_characters = tools_taking_a_workspace_path.reduce((total, [tool, property]) => {
      const { description, examples } = wire_property(tool, property);
      return total + JSON.stringify({ description, examples }).length;
    }, 0);

    expect(guidance_characters).toBeLessThan(2_400);
  });
});

describe('what the wire reduction drops', () => {
  it('drops schema keys that are not type, properties or required', () => {
    const reduced = wire_input_schema({
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path'],
      examples: [{ path: 'repo/src/index.ts' }],
      additionalProperties: false,
    } as RuntimeJsonSchema);

    expect(reduced).not.toHaveProperty('examples');
    expect(reduced).not.toHaveProperty('additionalProperties');
    expect((reduced.properties as Record<string, RuntimeJsonSchema>).path).toEqual({
      type: 'string',
    });
  });
});

describe('shell working directory', () => {
  it('lets a shell command run from an absolute sandbox path', () => {
    expect(canonical_shell_working_directory('/tmp/bench')).toBe('/tmp/bench');
  });

  it('resolves workspace-relative and absolute workspace paths to the same place', () => {
    expect(canonical_shell_working_directory(undefined)).toBe('.');
    expect(canonical_shell_working_directory('/workspace')).toBe('.');
    expect(canonical_shell_working_directory('files')).toBe('files');
    expect(canonical_shell_working_directory('/workspace/files')).toBe('files');
  });
});
