import { createHash } from 'node:crypto';

// What the miner reads, before any model sees anything: the words a person actually typed, with
// everything that makes one Friday different from the next taken out — the date, the number, the
// name. Two asks that survive as the same words are the same ask, and asking three times over
// three different weeks is what "you keep doing this by hand" means.
//
// Two asks group only when the words that survive are EXACTLY the same set, which is
// the conservative end — a habit worded loosely ends up as two groups and simply never meets the
// bar. Near-match clustering is the upgrade if real asks turn out to drift more than the dates,
// numbers and names this already strips.
//
// PURE. No database, no model, no clock: the job hands rows in and reads candidates out, so the
// recurrence bar can be argued with in a test instead of in production.

export type HumanAsk = {
  run_id: string;
  session_id: string | null;
  asked_by?: string | undefined;
  ask_text: string;
  occurred_at: Date;
};

export type RecurringAsk = {
  asked_by: string | null;
  normalized_ask: string;
  ask_key: string;
  ask_count: number;
  distinct_weeks: number;
  example_asks: string[];
  run_ids: string[];
  first_asked: Date;
  last_asked: Date;
};

const min_ask_count = 3;
const min_distinct_weeks = 3;
const covered_word_ratio = 0.6;

const empty_words = new Set(
  'a an the and or to for of in on at me my you your i it this that with from please can could would will do does did is are was be get got again just now then also have has had we us our as by up out about into over all some any so if when what how make let'.split(
    ' ',
  ),
);

const month_and_day_words = new Set(
  'january february march april may june july august september october november december jan feb mar apr jun jul aug sep sept oct nov dec monday tuesday wednesday thursday friday saturday sunday mon tue tues wed thu thur thurs fri sat sun today tomorrow yesterday week weekly morning afternoon evening tonight am pm st nd rd th'.split(
    ' ',
  ),
);

// The words an ask is grouped by. Names go first, while the capitals are still there to find them.
// A capitalised word that is not the first word is treated as a name. Real NER is the
// upgrade if "Compile The CEO List" style capitalisation shows up in practice.
export function normalize_ask(ask_text: string): string {
  const words = ask_text
    .slice(0, 300)
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
  const content = words.filter((word, index) => is_content_word(word, index));
  const unique = [...new Set(content.map((word) => word.toLowerCase()))].sort();
  return unique.join(' ');
}

function is_content_word(word: string, index: number) {
  if (index > 0 && /^\p{Lu}\p{Ll}+$/u.test(word)) return false;
  if (/\d/u.test(word)) return false;
  const lowered = word.toLowerCase();
  if (lowered.length < 2) return false;
  return !empty_words.has(lowered) && !month_and_day_words.has(lowered);
}

function ask_key_of(normalized_ask: string) {
  return createHash('sha256').update(normalized_ask).digest('hex').slice(0, 32);
}

export function iso_week_key(date: Date) {
  const midweek = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  midweek.setUTCDate(midweek.getUTCDate() + 4 - (midweek.getUTCDay() || 7));
  const year_start = Date.UTC(midweek.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((midweek.getTime() - year_start) / 86_400_000 + 1) / 7);
  return `${midweek.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

/** A habit is one person's: the same words from two people are two groups, never one. */
export function group_recurring_asks(asks: HumanAsk[]): RecurringAsk[] {
  const groups = new Map<string, { normalized_ask: string; asks: HumanAsk[] }>();
  for (const ask of asks) {
    const normalized_ask = normalize_ask(ask.ask_text);
    if (normalized_ask.split(' ').filter(Boolean).length < 2) continue;
    const group_key = JSON.stringify([ask.asked_by ?? null, normalized_ask]);
    const group = groups.get(group_key) ?? { normalized_ask, asks: [] };
    groups.set(group_key, { normalized_ask, asks: [...group.asks, ask] });
  }
  return [...groups.values()]
    .map((group) => summarize_group(group.normalized_ask, group.asks))
    .filter(
      (group) => group.ask_count >= min_ask_count && group.distinct_weeks >= min_distinct_weeks,
    )
    .sort((left, right) => right.ask_count - left.ask_count);
}

function summarize_group(normalized_ask: string, group: HumanAsk[]): RecurringAsk {
  const times = group.map((ask) => ask.occurred_at.getTime()).sort((left, right) => left - right);
  return {
    asked_by: group[0]?.asked_by ?? null,
    normalized_ask,
    ask_key: ask_key_of(normalized_ask),
    ask_count: group.length,
    distinct_weeks: new Set(group.map((ask) => iso_week_key(ask.occurred_at))).size,
    example_asks: group.slice(0, 5).map((ask) => ask.ask_text.slice(0, 300)),
    run_ids: group.map((ask) => ask.run_id),
    first_asked: new Date(times[0] ?? 0),
    last_asked: new Date(times.at(-1) ?? 0),
  };
}

export function ask_is_already_automated(normalized_ask: string, instructions: string[]) {
  const words = new Set(normalized_ask.split(' ').filter(Boolean));
  if (words.size === 0) return true;
  return instructions.some(
    (instruction) => shared_word_ratio(words, instruction) >= covered_word_ratio,
  );
}

function shared_word_ratio(words: Set<string>, instruction: string) {
  const instruction_words = new Set(normalize_ask(instruction).split(' ').filter(Boolean));
  let shared = 0;
  for (const word of words) if (instruction_words.has(word)) shared += 1;
  return shared / words.size;
}
