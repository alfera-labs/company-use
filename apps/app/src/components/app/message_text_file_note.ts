const message_text_file_note =
  /\n?The message above is also saved as a file at [^\n]+? \(\d+ bytes\)\. When it holds data to move — rows, records, a list — read it from there with a script; do not retype it by hand\./gu;

/**
 * After a long message the runtime tells the model that the message is also a file. That line
 * is a part of the stored message, for the model, and chats made before it was kept out of the
 * message text hold it there too. The chat shows what the person typed, so it leaves it out.
 */
export function remove_message_text_file_note(text: string): string {
  return text.replace(message_text_file_note, '');
}
