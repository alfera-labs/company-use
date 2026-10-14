export function matches_every_word(searchable_text: string, query: string) {
  const words = split_into_words(query);
  if (words.length === 0) return true;

  const haystack = searchable_text.toLowerCase();
  return words.every((word) => haystack.includes(word));
}

function split_into_words(query: string) {
  return query.trim().toLowerCase().split(/\s+/u).filter(Boolean);
}
