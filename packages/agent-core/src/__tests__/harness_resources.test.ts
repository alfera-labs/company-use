import { format_skill_invocation, format_skills_for_system_prompt } from '@agent-core/harness';
import { describe, expect, it } from 'vitest';

describe('harness resources', () => {
  it('indexes model-visible skills by name under their root, without loading hidden skills', () => {
    const system_prompt = format_skills_for_system_prompt([
      skill('review', 'Find bugs <fast>.'),
      { ...skill('private', 'Manual only.'), disable_model_invocation: true },
    ]);

    expect(system_prompt).toContain('<available_skills>');
    expect(system_prompt).toContain('&lt;fast&gt;');
    expect(system_prompt).toContain('<skills root="/repo/.claude/skills/review">');
    expect(system_prompt).toContain('review (SKILL.md): Find bugs &lt;fast&gt;.');
    expect(system_prompt).not.toContain('private');
  });

  it('keeps whole sentences up to the hint budget and drops the tail past it', () => {
    const trigger_sentences =
      'Use when the user asks for a research briefing. ALSO use when a claim needs a source.';
    const long_description = `${'Use when the task needs a very long trigger sentence that runs on and on past any sensible budget for one index line'.padEnd(240, ' x')}. Built on tools nobody needs before loading.`;

    const system_prompt = format_skills_for_system_prompt([
      skill(
        'brief',
        `${trigger_sentences} Built on web search in the sandbox, and on a citation formatter, neither of which anybody can act on before loading the skill anyway.`,
      ),
      skill('long', long_description),
    ]);

    expect(system_prompt).toContain(`brief (SKILL.md): ${trigger_sentences}`);
    expect(system_prompt).not.toContain('Built on web search in the sandbox');

    const long_hint = hint_for(system_prompt, 'long');
    expect(long_hint.endsWith('…')).toBe(true);
    expect(long_hint.length).toBeLessThanOrEqual(181);
    expect(long_hint).toContain('Use when the task needs a very long trigger sentence');
    expect(long_hint).not.toContain('Built on tools nobody needs');
  });

  it('does not end a hint at an abbreviation', () => {
    const system_prompt = format_skills_for_system_prompt([
      skill('invoices', 'Handles e.g. invoices and receipts from the shared mailbox. Uses pandas.'),
      skill('ads', 'Draft ads for U.S. customers when a campaign needs copy. Uses the brand kit.'),
    ]);

    expect(hint_for(system_prompt, 'invoices')).toContain('invoices and receipts');
    expect(hint_for(system_prompt, 'ads')).toContain('when a campaign needs copy');
  });

  it('shows an authored discovery hint in place of the description', () => {
    const system_prompt = format_skills_for_system_prompt([
      {
        ...skill(
          'connect',
          `${'Use when someone asks to connect an app'.padEnd(400, ' x')}. ALSO use when create_connection answers app_not_found.`,
        ),
        discovery_hint: 'Use to connect an app, and when create_connection answers app_not_found.',
      },
    ]);

    expect(hint_for(system_prompt, 'connect')).toBe(
      'Use to connect an app, and when create_connection answers app_not_found.',
    );
  });

  it('names every skill exactly once, whatever order the caller supplies', () => {
    const skills = [
      skill('alpha', 'Use when alpha.'),
      skill('bravo', 'Use when bravo.'),
      skill('charlie', 'Use when charlie.'),
      { ...skill('delta', 'Use when delta.'), file_path: '/repo/.agents/skills/delta/SKILL.md' },
    ];

    for (const ordering of permutations(skills)) {
      const index_lines = skill_index_lines(format_skills_for_system_prompt(ordering));
      expect(index_lines.map((line) => line.split(' (')[0])).toEqual([
        'delta',
        'alpha',
        'bravo',
        'charlie',
      ]);
    }
  });

  it('emits byte-identical output for the same skills in any input order', () => {
    const skills = [
      skill('alpha', 'Use when alpha.'),
      skill('bravo', 'Use when bravo.'),
      skill('charlie', 'Use when charlie.'),
      { ...skill('alpha', 'Use when the workspace alpha.'), file_path: '/repo/.agents/alpha' },
    ];

    const expected = format_skills_for_system_prompt(skills);
    for (const ordering of permutations(skills)) {
      expect(format_skills_for_system_prompt(ordering)).toBe(expected);
      expect(format_skills_for_system_prompt(ordering)).toBe(expected);
    }
  });

  it('groups skills under sorted roots and prints each root once', () => {
    const system_prompt = format_skills_for_system_prompt([
      { ...skill('zulu', 'Use when zulu.'), file_path: 'skill://workspace/zulu' },
      { ...skill('alpha', 'Use when alpha.'), file_path: 'skill://global/alpha' },
      { ...skill('bravo', 'Use when bravo.'), file_path: 'skill://global/bravo' },
    ]);

    expect(system_prompt.split('\n').filter((line) => line.includes('<skills root='))).toEqual([
      '  <skills root="skill://global">',
      '  <skills root="skill://workspace">',
    ]);
    expect(skill_index_lines(system_prompt)).toEqual([
      'alpha: Use when alpha.',
      'bravo: Use when bravo.',
      'zulu: Use when zulu.',
    ]);
  });

  it('formats an explicit skill invocation with its resolved directory', () => {
    const invocation = format_skill_invocation(
      skill('ship', 'Ship the work.'),
      'Run verification after edits.',
    );

    expect(invocation).toContain('<skill name="ship"');
    expect(invocation).toContain('References are relative to /repo/.claude/skills/ship.');
    expect(invocation).toContain('Run verification after edits.');
  });
});

function skill(name: string, description: string) {
  return {
    name,
    description,
    content: `# ${name}\n\nDo the work.`,
    file_path: `/repo/.claude/skills/${name}/SKILL.md`,
  };
}

function skill_index_lines(system_prompt: string) {
  return system_prompt
    .split('\n')
    .filter((line) => line.startsWith('    '))
    .map((line) => line.trim());
}

function hint_for(system_prompt: string, skill_name: string) {
  const line = skill_index_lines(system_prompt).find((entry) => entry.startsWith(skill_name));
  return line?.slice(line.indexOf(': ') + 2) ?? '';
}

function permutations<TItem>(items: readonly TItem[]): TItem[][] {
  if (items.length <= 1) return [[...items]];
  return items.flatMap((item, index) =>
    permutations([...items.slice(0, index), ...items.slice(index + 1)]).map((rest) => [
      item,
      ...rest,
    ]),
  );
}
