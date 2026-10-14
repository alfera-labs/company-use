import { format_error_message } from '@coworker/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useRef, useState } from 'react';
import { useDiscardChanges } from '@/components/app/workspace_documents/discard_changes';
import { file_draft_key, use_file_drafts } from '@/components/app/workspace_documents/file_drafts';
import {
  open_workspace_file,
  open_workspace_file_bytes,
  save_workspace_file,
  save_workspace_file_bytes,
} from '@/lib/api';
import { ApiError } from '@/lib/api/client';
import { query_keys } from '@/lib/api/query_keys';

export function useFileEditor(workspace_id: string, file_path: string, office: boolean) {
  const { confirm_discard, discard_dialog } = useDiscardChanges();
  const query_client = useQueryClient();
  const draft_key = file_draft_key(workspace_id, file_path);
  const draft = use_file_drafts((state) => state.drafts[draft_key]);
  const set_draft = use_file_drafts((state) => state.set_draft);
  const [saving, set_saving] = useState(false);
  const [save_error, set_save_error] = useState<string | null>(null);
  const [conflict, set_conflict] = useState(false);
  const editor_generation = use_file_drafts((state) => state.generations[draft_key] ?? 0);
  const reset_editor = use_file_drafts((state) => state.reset_editor);
  const saving_ref = useRef(false);
  const export_docx = useRef<(() => Promise<Uint8Array>) | null>(null);
  const content_query = useQuery({
    queryKey: query_keys.workspace_file(file_path),
    queryFn: () => open_workspace_file(file_path),
    refetchOnWindowFocus: !draft,
  });
  const content = content_query.data;
  const bytes_query = useQuery({
    queryKey: query_keys.workspace_file_bytes(workspace_id, file_path),
    queryFn: ({ signal }) => open_workspace_file_bytes(file_path, signal),
    enabled: office && Boolean(content && content.byte_size <= 25 * 1024 * 1024),
    refetchOnWindowFocus: !draft,
  });
  const start_editing = () => {
    if (!content) return;
    set_save_error(null);
    set_draft(draft_key, {
      original_text: content.content_text,
      text: content.content_text,
      content_version: office ? (bytes_query.data?.content_version ?? '') : content.content_version,
      dirty: false,
    });
  };
  const change_text = (text: string) => {
    if (!draft || draft.saving) return;
    set_draft(draft_key, { ...draft, text, dirty: text !== draft.original_text });
  };
  const change_docx = useCallback(
    (dirty: boolean) => {
      const current = use_file_drafts.getState().drafts[draft_key];
      if (current && current.dirty !== dirty) set_draft(draft_key, { ...current, dirty });
    },
    [draft_key, set_draft],
  );
  const register_save = useCallback((save: (() => Promise<Uint8Array>) | null) => {
    export_docx.current = save;
  }, []);
  const cancel = async () => {
    if (
      saving ||
      draft?.saving ||
      (draft?.dirty && !(await confirm_discard('Discard your unsaved changes to this file?')))
    )
      return;
    set_draft(draft_key, null);
    set_save_error(null);
    set_conflict(false);
    reset_editor(draft_key);
  };
  const save = async () => {
    if (!draft?.dirty || draft.saving || saving_ref.current) return;
    saving_ref.current = true;
    set_draft(draft_key, { ...draft, saving: true });
    set_saving(true);
    set_save_error(null);
    set_conflict(false);
    try {
      if (draft.text !== null) {
        if (new TextEncoder().encode(draft.text).byteLength > 1024 * 1024)
          throw new Error('Text files can contain up to 1 MiB. Your changes remain here.');
        const result = await save_workspace_file({
          file_path,
          content_text: draft.text,
          expected_version: draft.content_version,
        });
        query_client.setQueryData(query_keys.workspace_file(file_path), {
          ...content,
          content_text: draft.text,
          content_version: result.content_version,
        });
      } else {
        if (!export_docx.current)
          throw new Error('The Word editor is still opening. Try again shortly.');
        const bytes = await export_docx.current();
        if (bytes.byteLength > 25 * 1024 * 1024)
          throw new Error(
            'Word files can contain up to 25 MiB when saving. Your changes remain here.',
          );
        const result = await save_workspace_file_bytes({
          file_path,
          bytes,
          expected_version: draft.content_version,
        });
        query_client.setQueryData(query_keys.workspace_file_bytes(workspace_id, file_path), {
          bytes: new Uint8Array(bytes).buffer,
          content_version: result.content_version,
        });
      }
      set_draft(draft_key, null);
      reset_editor(draft_key);
      await query_client.invalidateQueries({ queryKey: query_keys.workspace_files(workspace_id) });
      await query_client.invalidateQueries({ queryKey: query_keys.workspace_file(file_path) });
    } catch (error) {
      const changed = error instanceof ApiError && error.status === 409;
      set_conflict(changed);
      set_save_error(
        changed
          ? 'Someone changed this file. Your changes remain here. Download your draft before loading the latest file.'
          : format_error_message(error, 'The file could not be saved. Your changes remain here.'),
      );
    } finally {
      saving_ref.current = false;
      const current = use_file_drafts.getState().drafts[draft_key];
      if (current) set_draft(draft_key, { ...current, saving: false });
      set_saving(false);
    }
  };
  const download_draft = async () => {
    try {
      const bytes =
        draft?.text !== null && draft?.text !== undefined
          ? new TextEncoder().encode(draft.text)
          : await export_docx.current?.();
      if (!bytes) return;
      const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)]));
      const link = document.createElement('a');
      link.href = url;
      link.download = file_path.split('/').pop() ?? 'draft';
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      set_save_error(format_error_message(error, 'The draft could not be downloaded.'));
    }
  };
  const reload = async () => {
    if (
      draft?.saving ||
      (draft?.dirty && !(await confirm_discard('Discard this draft and load the latest file?')))
    )
      return;
    set_draft(draft_key, null);
    set_conflict(false);
    set_save_error(null);
    await Promise.all([content_query.refetch(), ...(office ? [bytes_query.refetch()] : [])]);
    reset_editor(draft_key);
  };
  return {
    content_query,
    bytes_query,
    content,
    draft,
    draft_key,
    saving: saving || Boolean(draft?.saving),
    discard_dialog,
    save_error,
    conflict,
    editor_generation,
    start_editing,
    change_text,
    change_docx,
    register_save,
    cancel,
    save,
    reload,
    download_draft,
  };
}
