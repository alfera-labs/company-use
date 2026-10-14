import {
  list_tool_input_setup_steps,
  tool_input_needs_schema_id,
} from '@runtime-platform/tools/tool_input_setup';
import { describe, expect, it } from 'vitest';

describe('tool input setup', () => {
  it('ignores setup flags that are explicitly disabled', () => {
    const schema = {
      type: 'object',
      properties: {
        object_id: {
          type: 'string',
          field: { reload_props: false, dynamic_options: null },
        },
      },
    };

    expect(list_tool_input_setup_steps(schema)).toEqual([]);
    expect(tool_input_needs_schema_id(schema)).toBe(false);
  });
});
