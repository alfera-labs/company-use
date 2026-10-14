export const chat_attachment_limits = {
  max_attachment_count: 20,
  max_attachment_bytes: 25 * 1024 * 1024,
} as const;

export function find_attachment_rejection_message(
  file: { name: string; size: number },
  already_attached_count: number,
): string | null {
  if (already_attached_count >= chat_attachment_limits.max_attachment_count) {
    return `You can attach up to ${chat_attachment_limits.max_attachment_count} files to one message.`;
  }
  if (file.size > chat_attachment_limits.max_attachment_bytes) {
    return `${file.name} is ${format_byte_size(file.size)}. The limit is ${format_byte_size(chat_attachment_limits.max_attachment_bytes)} per file.`;
  }
  if (file.size === 0) return `${file.name} is empty.`;
  return null;
}

export function format_byte_size(byte_size: number) {
  if (byte_size < 1024) return `${byte_size} B`;
  const kibibytes = byte_size / 1024;
  if (kibibytes < 1024) return `${Math.round(kibibytes)} KB`;
  const mebibytes = kibibytes / 1024;
  return `${mebibytes >= 10 ? Math.round(mebibytes) : mebibytes.toFixed(1)} MB`;
}
