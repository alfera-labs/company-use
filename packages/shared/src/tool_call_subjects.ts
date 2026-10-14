type ToolCallSubjectKind = 'website' | 'recipient' | 'command';

type ToolCallSubjectGrain = 'any_action' | 'this_action';

export type ToolCallSubject = {
  kind: ToolCallSubjectKind;
  grain: ToolCallSubjectGrain;
  value: string;
  display_name: string;
};

type ToolCallText = { field_name: string; text: string };

const max_texts_read = 60;
const max_depth = 5;
const max_text_length = 2_000;

const recipient_field_names = new Set([
  'to',
  'to_email',
  'recipient',
  'recipients',
  'email',
  'send_to',
]);
const command_field_names = new Set(['command', 'cmd', 'script', 'shell_command']);

const http_url_start_re = /^https?:\/\//iu;
const leading_www_re = /^www\./iu;
const email_address_re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;
const whitespace_re = /\s+/u;

const subject_kinds: readonly {
  grain: ToolCallSubjectGrain;
  find: (texts: readonly ToolCallText[]) => Omit<ToolCallSubject, 'grain'>[];
}[] = [
  { grain: 'this_action', find: find_recipients },
  { grain: 'this_action', find: find_commands },
  { grain: 'any_action', find: find_websites },
];

export function find_tool_call_subjects(tool_input: unknown): ToolCallSubject[] {
  const texts = read_texts(tool_input);
  return keep_first_of_each(
    subject_kinds.flatMap(({ grain, find }) => find(texts).map((found) => ({ ...found, grain }))),
  );
}

export function tool_call_subject_policy_id(
  subject: Pick<ToolCallSubject, 'kind' | 'value' | 'grain'>,
  node_key: string,
) {
  const named = `${subject.kind}:${subject.value}`;
  return subject.grain === 'any_action' ? named : `${node_key}/${named}`;
}

function find_websites(texts: readonly ToolCallText[]) {
  return texts.flatMap(({ text }) => {
    const host = read_url_host(text);
    return host
      ? [{ kind: 'website' as const, value: host.replace(leading_www_re, ''), display_name: host }]
      : [];
  });
}

function find_recipients(texts: readonly ToolCallText[]) {
  return texts.flatMap(({ field_name, text }) => {
    if (!recipient_field_names.has(field_name) || !email_address_re.test(text)) return [];
    return [{ kind: 'recipient' as const, value: text.toLowerCase(), display_name: text }];
  });
}

function find_commands(texts: readonly ToolCallText[]) {
  return texts.flatMap(({ field_name, text }) => {
    if (!command_field_names.has(field_name)) return [];
    const program = text.trim().split(whitespace_re)[0];
    return program ? [{ kind: 'command' as const, value: program, display_name: program }] : [];
  });
}

function read_url_host(text: string) {
  if (!http_url_start_re.test(text)) return null;
  try {
    return new URL(text).hostname.toLowerCase() || null;
  } catch {
    return null;
  }
}

function read_texts(value: unknown): ToolCallText[] {
  const texts: ToolCallText[] = [];
  collect_texts(value, '', 0, texts);
  return texts;
}

function collect_texts(value: unknown, field_name: string, depth: number, texts: ToolCallText[]) {
  if (texts.length >= max_texts_read || depth > max_depth) return;
  if (typeof value === 'string') {
    if (value.length <= max_text_length && value.trim()) {
      texts.push({ field_name, text: value.trim() });
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) collect_texts(entry, field_name, depth + 1, texts);
    return;
  }
  if (typeof value === 'object' && value !== null) {
    for (const [key, entry] of Object.entries(value)) {
      collect_texts(entry, key.toLowerCase(), depth + 1, texts);
    }
  }
}

function keep_first_of_each(subjects: readonly ToolCallSubject[]) {
  const by_id = new Map<string, ToolCallSubject>();
  for (const subject of subjects) {
    const id = `${subject.kind}:${subject.value}`;
    if (!by_id.has(id)) by_id.set(id, subject);
  }
  return [...by_id.values()];
}
