import { find_tool_repeat_safety } from '@runtime-platform/tools/tool_repeat_safety';
import { describe, expect, it } from 'vitest';

function unfinished_call(tool_name: string, tool_call_metadata: unknown) {
  return { tool_call_id: 'tc_1', tool_name, tool_call_metadata, started_time: new Date() };
}

describe('find_tool_repeat_safety is path-aware for memory writes', () => {
  it('is safe_to_repeat for a write into /memory', () => {
    const safety = find_tool_repeat_safety(
      unfinished_call('write', { write_path: '/memory/projects/notes/x.md' }),
    );
    expect(safety).toBe('safe_to_repeat');
  });

  it('is safe_to_repeat for an edit into /memory', () => {
    const safety = find_tool_repeat_safety(
      unfinished_call('edit', { write_path: '/memory/workspace/index.md' }),
    );
    expect(safety).toBe('safe_to_repeat');
  });

  it('asks a person for a write outside /memory', () => {
    const safety = find_tool_repeat_safety(
      unfinished_call('write', { write_path: '/code/src/index.ts' }),
    );
    expect(safety).toBe('ask_a_person');
  });

  it('asks a person when the write path is missing entirely', () => {
    const safety = find_tool_repeat_safety(unfinished_call('write', {}));
    expect(safety).toBe('ask_a_person');
  });

  it('leaves a listed tool on its own rule, unaffected by the memory path check', () => {
    const safety = find_tool_repeat_safety(
      unfinished_call('email-send-1', { write_path: '/memory/should-not-matter.md' }),
    );
    expect(safety).toBe('check_before_repeat');
  });
});
