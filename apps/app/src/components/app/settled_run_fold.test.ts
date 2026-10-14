import { describe, expect, it } from 'vitest';
import type {
  ProjectedChatMessagePart,
  ProjectedChatToolPart,
} from '@/components/app/chat_stream_projection';
import {
  describe_folded_work,
  describe_live_work,
  type SettledRunGroup,
  split_settled_run,
} from '@/components/app/settled_run_fold';

function text_group(text: string, startIndex: number): SettledRunGroup {
  return {
    type: 'part',
    part: { type: 'text', text } as ProjectedChatMessagePart,
    startIndex,
  };
}

function tool_group(count: number, startIndex: number): SettledRunGroup {
  return {
    type: 'internal',
    parts: Array.from(
      { length: count },
      () => ({ type: 'tool-workspace-read_file' }) as unknown as ProjectedChatMessagePart,
    ),
    startIndex,
  };
}

function thought_group(durationMs: number, startIndex: number): SettledRunGroup {
  return { type: 'thought', parts: [{ text: 'thinking', durationMs }], startIndex };
}

describe('split_settled_run', () => {
  it('keeps text in order and folds thought and tool groups', () => {
    const groups = [
      thought_group(3000, 0),
      tool_group(4, 1),
      text_group('Working on it.', 2),
      tool_group(2, 3),
      text_group('Reconciled 412 payouts.', 4),
      text_group('The report is attached.', 5),
    ];

    const split = split_settled_run(groups);

    expect(split.folded).toEqual([groups[0], groups[1], groups[3]]);
    expect(split.shown).toEqual([groups[2], groups[4], groups[5]]);
  });

  it('keeps what the agent produced after its answer visible with it', () => {
    const artifact: SettledRunGroup = {
      type: 'part',
      part: { type: 'artifact' } as unknown as ProjectedChatMessagePart,
      startIndex: 2,
    };
    const groups = [tool_group(1, 0), text_group('Here is the report.', 1), artifact];

    const split = split_settled_run(groups);

    expect(split.shown).toHaveLength(2);
    expect(split.shown[1]).toBe(artifact);
  });

  it('never folds a next action away, even when it lands before the answer', () => {
    const connection_ask: SettledRunGroup = {
      type: 'part',
      part: { type: 'tool-runtime-create_connection-1' } as unknown as ProjectedChatMessagePart,
      startIndex: 1,
    };
    const groups = [
      tool_group(2, 0),
      connection_ask,
      text_group('Connect Gmail and I will finish.', 2),
    ];

    const split = split_settled_run(groups);

    expect(split.folded).toHaveLength(1);
    expect(split.shown).toContain(connection_ask);
  });

  it('folds nothing when the answer is the first thing in the turn', () => {
    const groups = [text_group('Yes.', 0)];

    const split = split_settled_run(groups);

    expect(split.folded).toEqual([]);
    expect(split.shown).toEqual(groups);
  });

  it('folds a turn that only contains work', () => {
    const groups = [tool_group(3, 0), thought_group(1000, 1)];

    const split = split_settled_run(groups);

    expect(split.folded).toEqual(groups);
    expect(split.shown).toEqual([]);
  });

  it('keeps text visible after later work', () => {
    const current = text_group('I found the account.', 2);
    const first_tool = tool_group(1, 0);
    const second_tool = tool_group(1, 3);
    const with_current_text = split_settled_run([first_tool, current]);
    const superseded = split_settled_run([first_tool, current, second_tool]);

    expect(with_current_text.shown).toEqual([current]);
    expect(superseded.folded).toEqual([first_tool, second_tool]);
    expect(superseded.shown).toEqual([current]);
  });

  it('folds a source without hiding the answer before it', () => {
    const answer = text_group('The final answer.', 1);
    const source: SettledRunGroup = {
      type: 'part',
      part: { type: 'source', sourceId: 'memory' } as ProjectedChatMessagePart,
      startIndex: 2,
    };

    const split = split_settled_run([tool_group(1, 0), answer, source]);

    expect(split.folded).toContain(source);
    expect(split.shown).toEqual([answer]);
  });
});

describe('describe_folded_work', () => {
  it('counts the real steps and the real thinking time', () => {
    const label = describe_folded_work([
      tool_group(4, 0),
      tool_group(3, 1),
      thought_group(8000, 2),
    ]);

    expect(label).toBe('Worked · 7 steps · thought for 8s');
  });

  it('says nothing it cannot count', () => {
    expect(describe_folded_work([tool_group(1, 0)])).toBe('Worked · 1 step');
    expect(describe_folded_work([thought_group(2000, 0)])).toBe('Worked · thought for 2s');
  });

  it('shows a failure in the closed fold label', () => {
    const failed: SettledRunGroup = {
      type: 'internal',
      parts: [
        {
          type: 'tool-workspace-read_file',
          toolCallId: 'call_failed',
          toolName: 'workspace-read_file',
          state: 'failed',
        } as ProjectedChatToolPart,
      ],
      startIndex: 0,
    };

    expect(describe_folded_work([failed])).toBe('Worked · 1 step · 1 failed');
  });

  it('says stopped, and counts no failure, for a step the person stopped', () => {
    const stopped: SettledRunGroup = {
      type: 'internal',
      parts: [
        {
          type: 'tool-workspace-run_command',
          toolCallId: 'call_stopped',
          toolName: 'workspace-run_command',
          state: 'cancelled',
          errorText: 'Stopped before it finished.',
        } as ProjectedChatToolPart,
      ],
      startIndex: 0,
    };

    expect(describe_folded_work([stopped])).toBe('Worked · 1 step · 1 stopped');
    expect(describe_live_work([stopped])).toBe('Worked so far');
  });

  it('puts what the turn read from memory before the count of its steps', () => {
    expect(describe_folded_work([tool_group(2, 0)], 'read 3 pages')).toBe('Worked · read 3 pages');
    expect(describe_folded_work([tool_group(2, 0)], undefined, 1)).toBe('Worked · 1 source');
    expect(describe_folded_work([tool_group(2, 0)], undefined, 3)).toBe('Worked · 3 sources');
    expect(describe_folded_work([tool_group(2, 0)], undefined, 0)).toBe('Worked · 2 steps');
  });

  it('names the fold honestly when there is nothing countable behind it', () => {
    const label = describe_folded_work([text_group('On it.', 0)]);

    expect(label).toBe('Worked');
  });

  it('reads minutes as minutes once the thinking is long', () => {
    expect(describe_folded_work([thought_group(125_000, 0)])).toBe('Worked · thought for 2m 5s');
    expect(describe_folded_work([thought_group(120_000, 0)])).toBe('Worked · thought for 2m');
  });
});
