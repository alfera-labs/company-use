import { known_action_verbs } from '@/components/app/tool_action_verbs';

export type ToolActionTense = 'about_to' | 'running' | 'done';

const irregular_past_participles: Record<string, string> = {
  send: 'sent',
  buy: 'bought',
  pay: 'paid',
  make: 'made',
  write: 'written',
  find: 'found',
  get: 'got',
  set: 'set',
  put: 'put',
  run: 'run',
  cut: 'cut',
  read: 'read',
};

const vowels = new Set(['a', 'e', 'i', 'o', 'u']);
const doubling_word_length = 4;

export function present_participle(verb: string) {
  const word = verb.toLowerCase();
  if (word.endsWith('ie')) return `${word.slice(0, -2)}ying`;
  if (word.endsWith('e') && !word.endsWith('ee')) return `${word.slice(0, -1)}ing`;
  if (doubles_its_last_letter(word)) return `${word}${word.slice(-1)}ing`;
  return `${word}ing`;
}

export function past_participle(verb: string) {
  const word = verb.toLowerCase();
  const irregular = irregular_past_participles[word];
  if (irregular) return irregular;
  if (word.endsWith('e')) return `${word}d`;
  if (word.endsWith('y') && !vowels.has(word.slice(-2, -1))) return `${word.slice(0, -1)}ied`;
  if (doubles_its_last_letter(word)) return `${word}${word.slice(-1)}ed`;
  return `${word}ed`;
}

function doubles_its_last_letter(word: string) {
  if (word.length > doubling_word_length || word.length < 3) return false;
  const [third, second, last] = [word.at(-3) ?? '', word.at(-2) ?? '', word.at(-1) ?? ''];
  if (vowels.has(last) || 'wxy'.includes(last)) return false;
  return !vowels.has(third) && vowels.has(second);
}

const verbs_by_present_participle = new Map(
  [...known_action_verbs].map((verb) => [present_participle(verb), verb]),
);

function read_action_words(action_name: string) {
  const words = action_name.trim().split(/\s+/u).filter(Boolean);
  const [first_word = '', ...rest] = words;
  const verb = verbs_by_present_participle.get(first_word.toLowerCase()) ?? first_word;
  return { verb, rest: rest.join(' ') };
}

export function say_action_in_tense(action_name: string, tense: ToolActionTense) {
  const { verb, rest } = read_action_words(action_name);
  if (!known_action_verbs.has(verb.toLowerCase())) return action_name;
  const said = {
    about_to: `Tried to ${verb.toLowerCase()}`,
    running: capitalize(present_participle(verb)),
    done: capitalize(past_participle(verb)),
  }[tense];
  return rest ? `${said} ${rest}` : said;
}

function capitalize(word: string) {
  return word.charAt(0).toUpperCase() + word.slice(1);
}
