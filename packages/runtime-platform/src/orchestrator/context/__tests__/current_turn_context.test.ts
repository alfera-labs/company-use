import { format_current_turn_context } from '@runtime-platform/orchestrator/context/current_turn_context';
import { expect, it } from 'vitest';

it('never offers it on an automation, scout, or scheduled run', () => {
  const text = format_current_turn_context({
    source_type: 'headless',
    headless: { reason: 'automation' },
  });

  expect(text).toContain('No user is present in this run.');
  expect(text).not.toContain('automations-create_automation-1');
});

it('never offers it to a stranger asking through the public API', () => {
  const text = format_current_turn_context({ source_type: 'api', api: { speaker_name: 'Ada' } });

  expect(text).not.toContain('automations-create_automation-1');
});
