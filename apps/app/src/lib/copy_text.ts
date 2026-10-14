/**
 * Copies text for the person. A browser offers the clipboard API only on https and on
 * localhost, and a self-hosted install is often on plain http inside a network, so the text
 * is then copied through a selection. It throws when the browser copies nothing.
 */
export async function copy_text(text: string): Promise<void> {
  if (navigator.clipboard) return navigator.clipboard.writeText(text);
  copy_text_through_a_selection(text);
}

class ItemForTheSelectionClipboard {
  constructor(readonly parts: Record<string, Blob>) {}
}

const clipboard_through_a_selection = {
  writeText: async (text: string) => copy_text_through_a_selection(text),
  write: async (items: ItemForTheSelectionClipboard[]) =>
    copy_text_through_a_selection((await items[0]?.parts['text/plain']?.text()) ?? ''),
};

/**
 * A dependency calls `navigator.clipboard` itself: the copy button of a code block and of a
 * table in an answer do. On plain http that object does not exist and such a button does
 * nothing. Called once when the app starts, this gives a plain-http page a clipboard that
 * copies through a selection, so those buttons copy and show that they did.
 */
export function offer_a_clipboard_on_plain_http(): void {
  if (navigator.clipboard) return;
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: clipboard_through_a_selection,
  });
  Object.defineProperty(globalThis, 'ClipboardItem', {
    configurable: true,
    value: ItemForTheSelectionClipboard,
  });
}

function copy_text_through_a_selection(text: string) {
  const holder = document.createElement('span');
  holder.textContent = text;
  holder.style.cssText = 'position:fixed;top:0;left:0;opacity:0;white-space:pre;user-select:text';
  document.body.append(holder);
  const selection = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(holder);
  selection?.removeAllRanges();
  selection?.addRange(range);
  const copied = document.execCommand('copy');
  selection?.removeAllRanges();
  holder.remove();
  if (!copied)
    throw new Error('This browser did not copy the text. Select it and copy it by hand.');
}
