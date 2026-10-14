import {
  assert_messages_well_formed,
  make_messages_well_formed,
} from '@agent-core/messages/message_integrity';
import type { RuntimeAgentMessage } from '@agent-core/messages/runtime_message';
import { describe, expect, it } from 'vitest';

function user_message(text: string): RuntimeAgentMessage {
  return { role: 'user', content: [{ type: 'text', text }] };
}

function assistant_text_message(text: string): RuntimeAgentMessage {
  return { role: 'assistant', content: [{ type: 'text', text }] };
}

function assistant_tool_call_message(id: string, name = 'do_thing'): RuntimeAgentMessage {
  return {
    role: 'assistant',
    content: [{ type: 'tool_call', id, name, arguments: {} }],
  };
}

function tool_result_message(id: string, name = 'do_thing'): RuntimeAgentMessage {
  return {
    role: 'tool',
    tool_call_id: id,
    name,
    content: [
      {
        type: 'tool_result',
        tool_call_id: id,
        tool_name: name,
        result: { ok: true, content_text: 'ok' },
      },
    ],
  };
}

describe('make_messages_well_formed', () => {
  it('leaves a well-formed conversation unchanged', () => {
    const messages = [
      user_message('hello'),
      assistant_tool_call_message('call_1'),
      tool_result_message('call_1'),
      assistant_text_message('done'),
      user_message('thanks'),
    ];

    expect(make_messages_well_formed(messages)).toEqual(messages);
  });

  it('drops an orphan tool_result whose tool_call was cut off by windowing', () => {
    const messages = [
      tool_result_message('call_gone'),
      assistant_text_message('continuing'),
      user_message('next'),
    ];

    const repaired = make_messages_well_formed(messages);

    expect(repaired).toEqual([assistant_text_message('continuing'), user_message('next')]);
  });

  it('drops an orphan tool_result identified by its content part id when the message id is absent', () => {
    const orphan: RuntimeAgentMessage = {
      role: 'tool',
      content: [
        {
          type: 'tool_result',
          tool_call_id: 'call_gone',
          tool_name: 'do_thing',
          result: { ok: true, content_text: 'ok' },
        },
      ],
    };
    const messages = [orphan, user_message('next')];

    expect(make_messages_well_formed(messages)).toEqual([user_message('next')]);
  });

  it('resolves a dangling tool_call by inserting a synthetic error tool_result right after it', () => {
    const messages = [
      user_message('hello'),
      assistant_tool_call_message('call_1'),
      user_message('are you there?'),
    ];

    const repaired = make_messages_well_formed(messages);

    expect(repaired).toHaveLength(4);
    expect(repaired[0]).toEqual(user_message('hello'));
    expect(repaired[1]).toEqual(assistant_tool_call_message('call_1'));
    expect(repaired[2]?.role).toBe('tool');
    expect(repaired[2]?.tool_call_id).toBe('call_1');
    const synthetic_part = repaired[2]?.content[0];
    expect(synthetic_part?.type).toBe('tool_result');
    if (synthetic_part?.type === 'tool_result') {
      expect(synthetic_part.result.ok).toBe(false);
    }
    expect(repaired[3]).toEqual(user_message('are you there?'));
  });

  it('pairs the answered tool_calls and synthesizes results only for the unanswered ones', () => {
    const assistant: RuntimeAgentMessage = {
      role: 'assistant',
      content: [
        { type: 'tool_call', id: 'call_1', name: 'a', arguments: {} },
        { type: 'tool_call', id: 'call_2', name: 'b', arguments: {} },
      ],
    };
    const messages = [
      user_message('hello'),
      assistant,
      tool_result_message('call_1', 'a'),
      user_message('next'),
    ];

    const repaired = make_messages_well_formed(messages);

    const tool_messages = repaired.filter((message) => message.role === 'tool');
    expect(tool_messages).toHaveLength(2);
    const call_2_result = tool_messages.find((message) => message.tool_call_id === 'call_2');
    expect(call_2_result).toBeDefined();
    const part = call_2_result?.content[0];
    if (part?.type === 'tool_result') expect(part.result.ok).toBe(false);
  });

  it('moves tool results up to follow their tool call when a failure notice landed in between', () => {
    const parallel_calls: RuntimeAgentMessage = {
      role: 'assistant',
      content: [
        { type: 'tool_call', id: 'call_1', name: 'a', arguments: {} },
        { type: 'tool_call', id: 'call_2', name: 'b', arguments: {} },
      ],
    };
    const messages = [
      user_message('hello'),
      parallel_calls,
      assistant_text_message('Something went wrong'),
      tool_result_message('call_2', 'b'),
      tool_result_message('call_1', 'a'),
      user_message('continue'),
    ];

    const repaired = make_messages_well_formed(messages);

    expect(repaired).toEqual([
      user_message('hello'),
      parallel_calls,
      tool_result_message('call_2', 'b'),
      tool_result_message('call_1', 'a'),
      assistant_text_message('Something went wrong'),
      user_message('continue'),
    ]);
    expect(() => assert_messages_well_formed(repaired)).not.toThrow();
  });

  it('keeps a well-formed conversation with parallel results in completion order unchanged', () => {
    const messages: RuntimeAgentMessage[] = [
      user_message('hello'),
      {
        role: 'assistant',
        content: [
          { type: 'tool_call', id: 'call_1', name: 'a', arguments: {} },
          { type: 'tool_call', id: 'call_2', name: 'b', arguments: {} },
        ],
      },
      tool_result_message('call_2', 'b'),
      tool_result_message('call_1', 'a'),
      assistant_text_message('done'),
    ];

    expect(make_messages_well_formed(messages)).toEqual(messages);
  });

  it('drops a duplicate tool result for a call that already has one', () => {
    const messages = [
      assistant_tool_call_message('call_1'),
      tool_result_message('call_1'),
      tool_result_message('call_1'),
      user_message('next'),
    ];

    expect(make_messages_well_formed(messages)).toEqual([
      assistant_tool_call_message('call_1'),
      tool_result_message('call_1'),
      user_message('next'),
    ]);
  });

  it('drops messages whose content is empty', () => {
    const messages: RuntimeAgentMessage[] = [
      user_message('hello'),
      { role: 'assistant', content: [] },
      user_message('still here'),
    ];

    expect(make_messages_well_formed(messages)).toEqual([
      user_message('hello'),
      user_message('still here'),
    ]);
  });

  it('is idempotent: repairing an already-repaired array changes nothing', () => {
    const messages = [
      tool_result_message('call_gone'),
      assistant_tool_call_message('call_1'),
      user_message('next'),
    ];

    const once = make_messages_well_formed(messages);
    const twice = make_messages_well_formed(once);

    expect(twice).toEqual(once);
  });

  it('converges after one pass and stays stable across repeated repairs (retry-safe)', () => {
    const parallel_calls: RuntimeAgentMessage = {
      role: 'assistant',
      content: [
        { type: 'tool_call', id: 'call_1', name: 'a', arguments: {} },
        { type: 'tool_call', id: 'call_2', name: 'b', arguments: {} },
      ],
    };
    const messages: RuntimeAgentMessage[] = [
      tool_result_message('orphan'),
      user_message('hi'),
      parallel_calls,
      tool_result_message('call_1', 'a'),
      { role: 'assistant', content: [] },
      assistant_tool_call_message('call_3'),
      user_message('bye'),
    ];

    const round_1 = make_messages_well_formed(messages);
    const round_2 = make_messages_well_formed(round_1);
    const round_3 = make_messages_well_formed(round_2);

    expect(round_2).toEqual(round_1);
    expect(round_3).toEqual(round_1);
    expect(() => assert_messages_well_formed(round_1)).not.toThrow();
    const synthetic_results = round_1.filter(
      (message) =>
        message.role === 'tool' &&
        message.content[0]?.type === 'tool_result' &&
        message.content[0].result.ok === false,
    );
    expect(synthetic_results).toHaveLength(2);
  });
});

describe('assert_messages_well_formed', () => {
  it('throws on an orphan tool_result', () => {
    expect(() =>
      assert_messages_well_formed([tool_result_message('call_gone'), user_message('next')]),
    ).toThrow(/tool_result/i);
  });

  it('throws on a dangling tool_call', () => {
    expect(() =>
      assert_messages_well_formed([assistant_tool_call_message('call_1'), user_message('next')]),
    ).toThrow(/tool_call/i);
  });

  it('throws when a message sits between a tool call and its tool result', () => {
    expect(() =>
      assert_messages_well_formed([
        assistant_tool_call_message('call_1'),
        assistant_text_message('Something went wrong'),
        tool_result_message('call_1'),
      ]),
    ).toThrow(/tool_call/i);
  });

  it('passes for the output of make_messages_well_formed', () => {
    const repaired = make_messages_well_formed([
      tool_result_message('call_gone'),
      user_message('hello'),
      assistant_tool_call_message('call_1'),
      user_message('next'),
    ]);

    expect(() => assert_messages_well_formed(repaired)).not.toThrow();
  });
});
