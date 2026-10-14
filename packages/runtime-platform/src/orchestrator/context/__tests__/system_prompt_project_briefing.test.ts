import { build_system_prompt } from '@runtime-platform/orchestrator/context/system_prompt_protocols';
import { describe, expect, it } from 'vitest';

describe('what a coworker is told about the project it is in', () => {
  it('names the project, so it can answer where it is', () => {
    const prompt = build_system_prompt({
      system_instructions: 'Base agent instructions.',
      project: { project_name: 'marketing' },
    });

    expect(prompt).toContain('This chat is in the "marketing" project.');
  });

  it('still names a project that has no instructions', () => {
    const prompt = build_system_prompt({
      system_instructions: 'Base agent instructions.',
      project: { project_name: 'marketing', project_instructions: '   ' },
    });

    expect(prompt).toContain('marketing');
    expect(prompt).not.toContain('Rules for every chat in this project');
  });

  it('places the project after the agent instructions', () => {
    const prompt = build_system_prompt({
      system_instructions: 'Base agent instructions.',
      project: { project_name: 'Support', project_instructions: 'Use the Acme support policy.' },
    });

    expect(prompt.indexOf('Base agent instructions.')).toBeLessThan(prompt.indexOf('## Project'));
    expect(prompt).toContain('Use the Acme support policy.');
  });

  it('carries the description, which says what work belongs in the room', () => {
    const prompt = build_system_prompt({
      system_instructions: 'Base agent instructions.',
      project: { project_name: 'Support', project_description: 'Customer replies only.' },
    });

    expect(prompt).toContain('What belongs here: Customer replies only.');
  });

  it('keeps the prompt byte-identical when there is no project at all', () => {
    const without_project = build_system_prompt({
      system_instructions: 'Base agent instructions.',
    });
    const with_nameless_project = build_system_prompt({
      system_instructions: 'Base agent instructions.',
      project: { project_name: '   ' },
    });

    expect(with_nameless_project).toBe(without_project);
  });

  it('names the people in the room, so "who is in here" has an answer', () => {
    const prompt = build_system_prompt({
      system_instructions: 'Base agent instructions.',
      project: {
        project_name: 'robin inspo',
        member_names: ['Robin', 'robin tate'],
      },
    });

    expect(prompt).toContain('People in this project (2): Robin, robin tate.');
  });
});
