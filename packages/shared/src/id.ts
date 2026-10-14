import { TypeID, typeid } from 'typeid-js';

export const id_prefixes = {
  user: 'user',
  workspace: 'ws',
  workspace_member: 'wmem',
  project: 'proj',
  resource_grant: 'grant',
  policy: 'policy',
  agent: 'agt',
  session: 'ses',
  session_tree_entry: 'entry',
  session_context_operation: 'ctxop',
  run: 'run',
  run_message: 'msg',
  run_event: 'evt',
  event: 'event',
  event_job: 'ejob',
  run_model_context_snapshot: 'ctx',
  runtime_environment: 'renv',
  sandbox: 'sb',
  volume: 'vol',
  artifact: 'art',
  tool_call: 'tcall',
  eval_report: 'eval',
  app: 'app',
  node: 'node',
  connection: 'conn',
  channel: 'chn',
  trigger: 'trg',
  automation: 'atm',
  usage_record: 'usage',
  api_key: 'key',
  billing_plan: 'plan',
  subscription: 'sub',
  billing_credit_ledger: 'credit',
  source_actor: 'sactor',
  import_grant: 'igrant',
  memory_fact: 'fact',
  memory_job: 'mjob',
  memory_source: 'msrc',
  memory_episode: 'mepi',
  memory_chunk: 'mchunk',
  template: 'tmpl',
  task: 'tsk',
  skill: 'skl',
  library_asked_for: 'asked',
  brain_source: 'bsrc',
  brain_item: 'bitem',
  brain_item_revision: 'brev',
  brain_item_chunk: 'bchunk',
  brain_item_link: 'blink',
  brain_sweep: 'sweep',
  connector_health: 'chealth',
} as const;

export type IdPrefix = (typeof id_prefixes)[keyof typeof id_prefixes];

export function create_id(prefix: IdPrefix) {
  return typeid(prefix).toString();
}

export function parse_id<const Prefix extends string>(value: string, prefix: Prefix) {
  return TypeID.fromString(value, prefix);
}

// A typeid carries its own type tag, so this asks the id what it is rather than guessing
// from a substring. Used where one field can hold ids minted by different owners — a message
// file_id may be an artifact id, a Slack file reference, or a client-side upload id — and the
// tag decides which one resolves it.
export function is_id<const Prefix extends string>(
  value: string,
  prefix: Prefix,
): value is `${Prefix}_${string}` {
  try {
    parse_id(value, prefix);
    return true;
  } catch {
    // Not this kind of id. The caller has other kinds to try, so this is an answer,
    // not a failure.
    return false;
  }
}
