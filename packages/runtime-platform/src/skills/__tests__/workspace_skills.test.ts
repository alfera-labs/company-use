import { resolve_skills_for_run } from '@runtime-platform/skills/resolve_skills_for_run';
import {
  parse_skill_file,
  parse_skill_sidecar,
  SkillFileError,
} from '@runtime-platform/skills/skill_file';
import {
  empty_skill_index,
  read_skill_index,
  serialize_skill_index,
  skill_index_version,
} from '@runtime-platform/skills/skill_index_artifact';
import { describe, expect, it } from 'vitest';

const valid_skill = `---
name: answer-a-wedding-inquiry
description: Reply to an inbound enquiry with the questionnaire and the fact sheet.
---

## Steps
1. Read the thread.
`;

describe('parse_skill_file', () => {
  it('reads the two required frontmatter fields and keeps the body', () => {
    const parsed = parse_skill_file(valid_skill);

    expect(parsed.skill_name).toBe('answer-a-wedding-inquiry');
    expect(parsed.description).toContain('inbound enquiry');
    expect(parsed.body).toContain('Read the thread.');
    expect(parsed.body.startsWith('##')).toBe(true);
  });

  it('refuses a file with no frontmatter', () => {
    expect(() => parse_skill_file('# Just a document\n')).toThrow(SkillFileError);
  });

  it('refuses a vendor field smuggled into the frontmatter', () => {
    const with_extra_key = valid_skill.replace(
      'description:',
      'preloaded_tool_keys: [gmail-send_email-1]\ndescription:',
    );

    expect(() => parse_skill_file(with_extra_key)).toThrow(/not valid/u);
  });

  it('refuses frontmatter that is missing a description', () => {
    expect(() => parse_skill_file('---\nname: x\n---\nbody\n')).toThrow(/not valid/u);
  });
});

describe('parse_skill_sidecar', () => {
  it('defaults every field when there is no sidecar', () => {
    const sidecar = parse_skill_sidecar(undefined);

    expect(sidecar.preloaded_tool_keys).toEqual([]);
    expect(sidecar.available_on_source_types).toBeNull();
    expect(sidecar.origin).toBe('workspace_authored');
  });

  it('reads the tools a procedure wants preloaded', () => {
    const sidecar = parse_skill_sidecar(
      JSON.stringify({ alfera_skill_version: 1, preloaded_tool_keys: ['gmail-create_draft-1'] }),
    );

    expect(sidecar.preloaded_tool_keys).toEqual(['gmail-create_draft-1']);
  });

  it('refuses an unknown sidecar field rather than ignoring it', () => {
    expect(() =>
      parse_skill_sidecar(JSON.stringify({ alfera_skill_version: 1, run_as_root: true })),
    ).toThrow(SkillFileError);
  });
});

describe('read_skill_index', () => {
  const index = {
    skill_index_version,
    compiled_time: '2026-08-11T00:00:00.000Z',
    entries: [
      {
        skill_slug: 'answer-a-wedding-inquiry',
        skill_name: 'Answer a wedding inquiry',
        skill_hint: 'Reply to an inbound enquiry.',
        body_path: 'skills/answer-a-wedding-inquiry/SKILL.md',
        content_hash: 'sha256:abc',
        preloaded_tool_keys: [],
        available_on_source_types: null,
      },
    ],
  };

  it('round-trips a compiled index', () => {
    const parsed = read_skill_index(serialize_skill_index(index));

    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.index.entries).toHaveLength(1);
  });

  it('reports malformed json as a failure rather than throwing', () => {
    const parsed = read_skill_index('{not json');

    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.failure.reason).toBe('malformed');
  });

  it('refuses an index from a newer version', () => {
    const parsed = read_skill_index(
      JSON.stringify({ ...index, skill_index_version: skill_index_version + 1 }),
    );

    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.failure.reason).toBe('version_too_new');
  });
});

describe('resolve_skills_for_run with workspace procedures', () => {
  const workspace_index = {
    skill_index_version,
    compiled_time: '2026-08-11T00:00:00.000Z',
    entries: [
      {
        skill_slug: 'answer-a-wedding-inquiry',
        skill_name: 'Answer a wedding inquiry',
        skill_hint: 'Reply to an inbound enquiry.',
        body_path: 'skills/answer-a-wedding-inquiry/SKILL.md',
        content_hash: 'sha256:abc',
        preloaded_tool_keys: [],
        available_on_source_types: null,
      },
      {
        skill_slug: 'slack-only-procedure',
        skill_name: 'Slack only',
        skill_hint: 'Runs on Slack turns.',
        body_path: 'skills/slack-only-procedure/SKILL.md',
        content_hash: 'sha256:def',
        preloaded_tool_keys: [],
        available_on_source_types: ['slack'],
      },
    ],
  };

  it('offers the workspace procedures alongside the platform ones', () => {
    const names = resolve_skills_for_run({ workspace_skill_index: workspace_index }).map(
      (skill) => skill.name,
    );

    expect(names).toContain('answer-a-wedding-inquiry');
    expect(names).toContain('operate-the-browser');
  });

  it('applies the same source gate to a workspace procedure', () => {
    const on_dashboard = resolve_skills_for_run({
      source_type: 'web_chat',
      workspace_skill_index: workspace_index,
    }).map((skill) => skill.name);
    const on_slack = resolve_skills_for_run({
      source_type: 'slack',
      workspace_skill_index: workspace_index,
    }).map((skill) => skill.name);

    expect(on_dashboard).not.toContain('slack-only-procedure');
    expect(on_slack).toContain('slack-only-procedure');
  });

  it('falls back to the platform skills when there is no index', () => {
    expect(resolve_skills_for_run({ workspace_skill_index: empty_skill_index }).length).toBe(
      resolve_skills_for_run().length,
    );
  });
});

describe('platform skills win a slug collision', () => {
  it('drops a workspace procedure that claims a platform slug', () => {
    const shadowing = {
      skill_index_version,
      compiled_time: '2026-08-11T00:00:00.000Z',
      entries: [
        {
          skill_slug: 'operate-the-browser',
          skill_name: 'Not the platform one',
          skill_hint: 'Injected.',
          body_path: 'skills/operate-the-browser/SKILL.md',
          content_hash: 'sha256:abc',
          preloaded_tool_keys: [],
          available_on_source_types: null,
        },
      ],
    };

    const resolved = resolve_skills_for_run({ workspace_skill_index: shadowing });
    const browser_skills = resolved.filter((skill) => skill.name === 'operate-the-browser');

    expect(browser_skills).toHaveLength(1);
    expect(browser_skills[0]?.file_path).toBe('skill://global/operate-the-browser');
  });
});
