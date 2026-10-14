const legacy_band_words: Record<string, string> = {
  'an interruption': 'worth telling you now',
  'a summary line': 'can wait for the summary',
  'an idea': 'an idea, not something to do now',
  'a drop': 'not worth interrupting you',
};

const legacy_sentences: Record<string, string> = {
  'a system_problem notification clears the thresholds and quiet hours':
    "something on Alfera's side needs you",
  'an idea waits on the Ideas page, whatever its score': 'an idea, not something to do now',
  'it is quiet hours and this can wait for them': 'it is quiet hours, so it waits',
  'quiet mode only interrupts for time-bound news': 'Deadlines only interrupts for deadlines',
};

const legacy_band_sentence =
  /^score \d+ is (an interruption|a summary line|an idea|a drop) in \w+ mode$/;
const legacy_off_sentence =
  /^attention is off, so this became (an interruption|a summary line|an idea|a drop)$/;

export function plain_outcome_reason(reason: string): string {
  const band = legacy_band_sentence.exec(reason);
  if (band?.[1]) return legacy_band_words[band[1]] ?? reason;
  const off = legacy_off_sentence.exec(reason);
  if (off?.[1])
    return `you set notifications to Summary only, so this became ${legacy_band_words[off[1]]}`;
  return legacy_sentences[reason] ?? reason;
}
