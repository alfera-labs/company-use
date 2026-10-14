import type { SessionEnv } from '@agent-core/environment/session_env';
import {
  compile_workspace_skill_index,
  recompile_skill_index_if_stale,
} from '@runtime-platform/skills/compile_workspace_skill_index';
import {
  is_procedure_folder_name,
  list_procedure_slugs,
} from '@runtime-platform/skills/procedure_folders';
import {
  read_skill_index,
  serialize_skill_index,
  skill_index_version,
} from '@runtime-platform/skills/skill_index_artifact';
import { example_procedure_slug } from '@runtime-platform/storage/workspace_seed_files';
import { describe, expect, it } from 'vitest';

const skill_file = (name: string) =>
  `---\nname: ${name}\ndescription: What ${name} does, in one line.\n---\n\n## Steps\n1. Do it.\n`;

function workspace(files: Record<string, string>) {
  const written: Record<string, string> = {};
  const environment = {
    env_key: 'e',
    env_kind: 'remote_sandbox' as const,
    metadata: {},
    list: async (input?: { path?: string }) => {
      const prefix = `${input?.path ?? ''}/`;
      const names = new Set<string>();
      for (const path of Object.keys(files)) {
        if (!path.startsWith(prefix)) continue;
        names.add(path.slice(prefix.length).split('/')[0] ?? '');
      }
      return [...names].map((name) => ({ name }));
    },
    read: async (path: string) => {
      const text = files[path];
      if (text === undefined) throw new Error(`No such file: ${path}`);
      return text;
    },
    write: async (path: string, content: string) => {
      written[path] = content;
      files[path] = content;
    },
  } as unknown as SessionEnv;
  return { environment, written };
}

describe('is_procedure_folder_name', () => {
  it('takes a procedure folder and leaves the compiler’s own output', () => {
    expect(is_procedure_folder_name('reply-to-inquiry')).toBe(true);
    expect(is_procedure_folder_name('INDEX.json')).toBe(false);
    expect(is_procedure_folder_name('index.md')).toBe(false);
    expect(is_procedure_folder_name('.keep')).toBe(false);
  });

  it('leaves out the shipped template', () => {
    expect(is_procedure_folder_name(example_procedure_slug)).toBe(false);
  });
});

describe('list_procedure_slugs', () => {
  it('answers undefined when skills/ cannot be listed at all', async () => {
    expect(await list_procedure_slugs(undefined)).toBeUndefined();

    const throws = { list: async () => Promise.reject(new Error('gone')) } as unknown as SessionEnv;
    expect(await list_procedure_slugs(throws)).toBeUndefined();
  });

  it('answers an empty list for a workspace holding only the template', async () => {
    const { environment } = workspace({
      [`skills/${example_procedure_slug}/SKILL.md`]: skill_file(example_procedure_slug),
    });

    expect(await list_procedure_slugs(environment)).toEqual([]);
  });
});

describe('compile_workspace_skill_index', () => {
  it('indexes the workspace’s own procedures and not the shipped template', async () => {
    const { environment, written } = workspace({
      [`skills/${example_procedure_slug}/SKILL.md`]: skill_file(example_procedure_slug),
      'skills/quote-drafting/SKILL.md': skill_file('quote-drafting'),
      'skills/reply-to-inquiry/SKILL.md': skill_file('reply-to-inquiry'),
    });

    const { index, rejected } = await compile_workspace_skill_index(environment);

    expect(index.entries.map((entry) => entry.skill_slug)).toEqual([
      'quote-drafting',
      'reply-to-inquiry',
    ]);
    expect(rejected).toEqual([]);
    expect(written['skills/index.md']).not.toContain(example_procedure_slug);
  });

  it('reports a procedure it could not parse rather than guessing at it', async () => {
    const { environment } = workspace({
      'skills/broken/SKILL.md': '# No frontmatter here\n',
      'skills/quote-drafting/SKILL.md': skill_file('quote-drafting'),
    });

    const { index, rejected } = await compile_workspace_skill_index(environment);

    expect(index.entries.map((entry) => entry.skill_slug)).toEqual(['quote-drafting']);
    expect(rejected.map((entry) => entry.skill_slug)).toEqual(['broken']);
  });
});

describe('recompile_skill_index_if_stale', () => {
  const an_index_naming = (skill_slugs: string[]) =>
    serialize_skill_index({
      skill_index_version,
      compiled_time: '2026-08-10T00:00:00.000Z',
      entries: skill_slugs.map((skill_slug) => ({
        skill_slug,
        skill_name: skill_slug,
        skill_hint: `What ${skill_slug} does, in one line.`,
        body_path: `skills/${skill_slug}/SKILL.md`,
        content_hash: 'sha256:stale',
        preloaded_tool_keys: [],
        available_on_source_types: null,
      })),
    });

  it('rewrites an index that names none of the procedures on the disk', async () => {
    const { environment, written } = workspace({
      'skills/INDEX.json': an_index_naming([]),
      'skills/quote-drafting/SKILL.md': skill_file('quote-drafting'),
    });

    expect(await recompile_skill_index_if_stale(environment)).toBe('written');
    expect(read_skill_index(written['skills/INDEX.json'] ?? '')).toMatchObject({
      ok: true,
      index: { entries: [{ skill_slug: 'quote-drafting' }] },
    });
  });

  it('leaves an index that already describes the folder alone', async () => {
    const { environment, written } = workspace({
      'skills/quote-drafting/SKILL.md': skill_file('quote-drafting'),
    });
    await compile_workspace_skill_index(environment);
    const compiled = written['skills/INDEX.json'];

    expect(await recompile_skill_index_if_stale(environment)).toBe('unchanged');
    expect(written['skills/INDEX.json']).toBe(compiled);
  });

  it('replaces an index that will not parse', async () => {
    const { environment } = workspace({
      'skills/INDEX.json': '{"skill_index_version": 1, "entries": [{"skill_sl',
      'skills/quote-drafting/SKILL.md': skill_file('quote-drafting'),
    });

    expect(await recompile_skill_index_if_stale(environment)).toBe('written');
  });

  it('does nothing for a run with no workspace to write to', async () => {
    expect(await recompile_skill_index_if_stale(undefined)).toBe('skipped');
  });
});
