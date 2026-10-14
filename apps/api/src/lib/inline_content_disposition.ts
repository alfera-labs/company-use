export function inline_content_disposition(file_name: string) {
  const fallback = file_name.replace(/[^\x20-\x7e]|["\\]/gu, '_');
  const encoded = encodeURIComponent(file_name).replace(
    /[!'()*]/gu,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `inline; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}
