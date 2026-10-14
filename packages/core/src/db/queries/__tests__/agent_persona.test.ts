import {
  imported_persona_end,
  imported_persona_start,
  remove_imported_persona_section,
} from '@coworker/core/db/queries/agent_persona';
import { describe, expect, it } from 'vitest';

const base_prompt = "You are Northwind's assistant.";
const private_text = 'Internal working rules: never quote below a 40% margin.';

function persona_block(text: string) {
  return `${imported_persona_start}\n${text}\n${imported_persona_end}`;
}

describe('remove_imported_persona_section', () => {
  it('removes a normally terminated block and keeps the operator instructions', () => {
    const stripped = remove_imported_persona_section(
      `${base_prompt}\n\n${persona_block(private_text)}`,
    );

    expect(stripped).toBe(base_prompt);
  });

  it('removes a block whose end marker is missing, to the end of the prompt', () => {
    const stripped = remove_imported_persona_section(
      `${base_prompt}\n\n${imported_persona_start}\n${private_text}`,
    );

    expect(stripped).toBe(base_prompt);
    expect(stripped).not.toContain(private_text);
    expect(stripped).not.toContain(imported_persona_start);
  });

  it('removes every block, not only the first', () => {
    const second_private_text = 'Escalate anything above 20k to Robin directly.';
    const stripped = remove_imported_persona_section(
      `${base_prompt}\n\n${persona_block(private_text)}\n\n${persona_block(second_private_text)}`,
    );

    expect(stripped).toBe(base_prompt);
    expect(stripped).not.toContain(second_private_text);
  });

  it('leaves a prompt that never had a block alone', () => {
    expect(remove_imported_persona_section(base_prompt)).toBe(base_prompt);
  });
});
