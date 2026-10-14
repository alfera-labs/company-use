type DestructiveOperation = 'delete' | 'archive' | 'cancel' | 'revoke';

const destructive_tool_patterns: Record<DestructiveOperation, RegExp> = {
  delete: /(?:^|[/_-])(?:delete|trash|remove|destroy|purge)(?:$|[/_-])/iu,
  archive: /(?:^|[/_-])archive(?:$|[/_-])/iu,
  cancel: /(?:^|[/_-])cancel(?:$|[/_-])/iu,
  revoke: /(?:^|[/_-])revoke(?:$|[/_-])/iu,
};

const prohibit_destructive_pattern =
  /\b(?:do not|don't|never|without (?:my )?(?:approval|permission|confirmation)|ask (?:me )?(?:first|before))\b[^.?!\n]*?\b(?:delet\w*|trash\w*|remov\w*|archiv\w*|cancel\w*|revok\w*|destroy\w*|purg\w*)\b/iu;

export function destructive_tool_is_destructive(input: { node_name: string; metadata?: unknown }) {
  return (
    (is_plain_object(input.metadata) && input.metadata.destructive_hint === true) ||
    destructive_operation(input.node_name) !== null
  );
}

export function destructive_tool_reference_is_destructive(tool_reference: string) {
  return destructive_operation(tool_reference) !== null;
}

export function destructive_request_is_prohibited(user_request: string) {
  return prohibit_destructive_pattern.test(user_request);
}

function destructive_operation(value: string): DestructiveOperation | null {
  for (const [operation, pattern] of Object.entries(destructive_tool_patterns)) {
    if (pattern.test(value)) return operation as DestructiveOperation;
  }
  return null;
}

function is_plain_object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
