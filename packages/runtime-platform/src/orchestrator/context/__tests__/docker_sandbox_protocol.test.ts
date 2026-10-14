import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { env } from '@coworker/config';
import { estimate_context_tokens_roughly } from '@coworker/shared';
import {
  build_docker_sandbox_protocol,
  docker_sandbox,
} from '@runtime-platform/orchestrator/context/docker_sandbox_protocol';
import { build_system_prompt } from '@runtime-platform/orchestrator/context/system_prompt_protocols';
import { get_workspace_library_context } from '@runtime-platform/orchestrator/context/workspace_library_context';
import { describe, expect, it } from 'vitest';

const heading = '## The Sandbox On This Install';

function prompt_of_an_install_with_sandbox(sandbox_provider: 'local' | 'docker' | 'e2b') {
  return build_system_prompt({
    system_instructions: 'You are the agent.',
    workspace_root: '/workspace',
    workspace_library: { document_count: 0, services_not_set_up: [], sandbox_provider },
  });
}

function block_of(prompt: string, block_heading: string) {
  const start = prompt.indexOf(block_heading);
  const end = prompt.indexOf('\n\n##', start + 1);
  return start === -1 ? '' : prompt.slice(start, end === -1 ? undefined : end);
}

describe('what the prompt says about the Docker sandbox of this install', () => {
  const block = block_of(prompt_of_an_install_with_sandbox('docker'), heading);

  it('says there is no preview link and no browser, and what to do in their place', () => {
    expect(block).toContain('There is no live preview link and no browser on this install.');
    expect(block).toContain('never install a browser');
    expect(block).toContain('Never start a web server for the person to open');
    expect(block).toContain(
      'write the files and say in one sentence that they open in the Files panel, where an HTML file renders',
    );
  });

  it('says it is not root, so no system package can be installed', () => {
    expect(block).toContain('as a user who is not root');
    expect(block).toContain('`apt-get` and `sudo` do not work');
  });

  it('lists what the image holds and what it lacks', () => {
    expect(block).toContain(
      'It has: node 24 with npm and npx, python3, git, curl, wget, gcc and make, unzip, ImageMagick (`convert`).',
    );
    expect(block).toContain(
      'It does not have: pip, a browser, LibreOffice, Pandoc, Poppler, Ghostscript, zip.',
    );
  });

  it('gives the commands of the one shared Python environment, and promises no file before it', () => {
    expect(block).toContain('python3 -m venv --without-pip /workspace/.venv');
    expect(block).toContain('curl -sSo tmp/get-pip.py https://bootstrap.pypa.io/get-pip.py');
    expect(block).toContain('/workspace/.venv/bin/python -m pip install <library>');
    expect(block).toContain(
      'Do not promise a spreadsheet, a deck, a PDF or a chart image before its library is installed.',
    );
    expect(block).toContain(
      'offer a file kind that needs none: CSV, Markdown, HTML, or an SVG chart',
    );
  });

  it('names the image and the user that the sandbox is started with', () => {
    const docker_workspace = readFileSync(
      resolve(import.meta.dirname, '../../docker_workspace.ts'),
      'utf8',
    );

    expect(docker_workspace).toContain(`'${docker_sandbox.image}'`);
    expect(docker_workspace).toMatch(
      new RegExp(`'--user',\\s+'${docker_sandbox.runs_as_user}'`, 'u'),
    );
    expect(block).toContain(`(image ${docker_sandbox.image})`);
  });

  it('is its own block and stays small', () => {
    expect(block).toBe(build_docker_sandbox_protocol());
    expect(estimate_context_tokens_roughly(block)).toBeLessThanOrEqual(520);
  });

  it('is not in the prompt of an install with another sandbox', () => {
    expect(prompt_of_an_install_with_sandbox('e2b')).not.toContain(heading);
    expect(prompt_of_an_install_with_sandbox('local')).not.toContain(heading);
  });

  it('is in the prompt of a run on this install only when its sandbox is Docker', async () => {
    const library = await get_workspace_library_context(
      {} as Parameters<typeof get_workspace_library_context>[0],
    );
    const prompt = build_system_prompt({
      system_instructions: 'You are the agent.',
      ...(library ? { workspace_library: library } : {}),
    });

    expect(library?.sandbox_provider).toBe(env.COWORKER_WORKSPACE_RUNTIME_PROVIDER);
    expect(prompt.includes(heading)).toBe(env.COWORKER_WORKSPACE_RUNTIME_PROVIDER === 'docker');
  });
});
