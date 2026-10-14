import type { RuntimeToolSourceContext } from '@runtime-platform/tools/types';

export function read_automation_id(source_context: RuntimeToolSourceContext | undefined) {
  const automation_id = source_context?.source_metadata?.automation_id;
  return typeof automation_id === 'string' ? automation_id : null;
}
