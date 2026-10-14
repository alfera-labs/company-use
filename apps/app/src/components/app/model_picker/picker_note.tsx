import { model_lock_explanations } from '@coworker/config/billing_words';
import { useState } from 'react';
import { AddModelKeyNote } from '@/components/app/model_picker/add_model_key_note';
import {
  find_row_keys_to_add,
  find_row_lock,
  type ModelPickerRow,
} from '@/components/app/model_picker/model_picker_rows';
import type { ModelCatalogEntry } from '@/lib/api';

type PickerNoteContent = {
  lock_explanation: string | null;
  keys_to_add: ModelCatalogEntry['keys_that_unlock_this_model'];
};

const no_note: PickerNoteContent = { lock_explanation: null, keys_to_add: [] };

/** What the picker says under its list about the row the person points at. */
export function usePickerNote() {
  const [note, set_note] = useState<PickerNoteContent>(no_note);
  const show_for = (rows: ModelPickerRow[], option_key: string | null | undefined) => {
    const lock = option_key ? find_row_lock(rows, option_key) : null;
    set_note({
      lock_explanation: lock ? model_lock_explanations[lock] : null,
      keys_to_add: option_key ? find_row_keys_to_add(rows, option_key) : [],
    });
  };
  return { note, show_for, clear: () => set_note(no_note) };
}

export function PickerNote({ note }: { note: PickerNoteContent }) {
  return (
    <>
      {note.lock_explanation ? (
        <p className="border-t px-3 py-2 text-xs text-muted-foreground">{note.lock_explanation}</p>
      ) : null}
      <AddModelKeyNote keys={note.keys_to_add} />
    </>
  );
}
