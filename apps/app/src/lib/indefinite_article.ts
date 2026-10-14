const starts_with_a_consonant_sound = /^(uni|use|usa|usu|uti|ute|ubi|uk\b|eu|one\b|once)/iu;
const starts_with_a_silent_h = /^(hour|honest|honor|honour|heir)/iu;
const letters_said_with_a_vowel_sound = /^[AEFHILMNORSX]/u;
const numbers_said_with_a_vowel_sound = /^(8|11|18)/u;

/**
 * "a" or "an" for the word that follows, by its first sound: "an Alfera API account",
 * "an HTTP API", "a HubSpot account", "a user". A word in capitals is read letter by letter.
 */
export function indefinite_article_for(next_words: string): 'a' | 'an' {
  const first_word = next_words.trim().split(/\s+/u)[0] ?? '';
  if (/^\d/u.test(first_word)) return numbers_said_with_a_vowel_sound.test(first_word) ? 'an' : 'a';
  const is_spelled_out = /^[A-Z]+$/u.test(first_word);
  if (is_spelled_out) return letters_said_with_a_vowel_sound.test(first_word) ? 'an' : 'a';
  if (starts_with_a_silent_h.test(first_word)) return 'an';
  if (starts_with_a_consonant_sound.test(first_word)) return 'a';
  return /^[aeiou]/iu.test(first_word) ? 'an' : 'a';
}
