const words_that_stay_uppercase = new Set(['ai', 'ml', 'llm', 'hq', 'xai', 'ibm']);

export function format_provider_display_name(input: {
  catalog_name: string | undefined;
  model_provider: string;
}) {
  if (input.catalog_name) return strip_trailing_domain(input.catalog_name);

  return title_case_provider_id(input.model_provider);
}

function strip_trailing_domain(catalog_name: string) {
  return catalog_name.replace(/\s*\([^)]*\.[a-z]{2,}\)\s*$/iu, '').trim() || catalog_name;
}

function title_case_provider_id(model_provider: string) {
  return (
    model_provider
      .split(/[-_\s]+/u)
      .filter(Boolean)
      .map(capitalize_word)
      .join(' ') || model_provider
  );
}

function capitalize_word(word: string) {
  if (words_that_stay_uppercase.has(word.toLowerCase())) return word.toUpperCase();
  return word.charAt(0).toUpperCase() + word.slice(1);
}
