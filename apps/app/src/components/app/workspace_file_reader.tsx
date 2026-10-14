import { Button } from '@coworker/ui/components/button';
import { LoaderCircle, Pencil, RefreshCw } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { WorkspaceTextEditor } from '@/components/app/workspace_documents/text_editor';
import { useFileEditor } from '@/components/app/workspace_documents/use_file_editor';
import {
  WorkspaceBinaryFileView,
  WorkspaceFileDocument,
} from '@/components/app/workspace_file_document';
import { FileDownloadIconLink } from '@/components/app/workspace_file_download_link';
import { workspace_file_extension } from '@/components/app/workspace_file_visuals';
import { client_only_lazy } from '@/components/client_only_lazy';

const OfficePreview = client_only_lazy(
  async () => ({
    default: (await import('@/components/app/workspace_documents/office_preview')).OfficePreview,
  }),
  <p className="p-6 text-sm text-muted-foreground">Opening document…</p>,
);

export function WorkspaceFileReader({
  filePath,
  workspace_id,
  active = true,
  onBrowseFiles,
}: {
  filePath: string;
  workspace_id: string;
  active?: boolean;
  onBrowseFiles?: () => void;
}) {
  const extension = workspace_file_extension(filePath);
  const office = ['docx', 'xlsx', 'pptx', 'xls'].includes(extension);
  const state = useFileEditor(workspace_id, filePath, office);
  const save_ref = useRef(state.save);
  save_ref.current = state.save;
  useEffect(() => {
    if (!active) return;
    const save_shortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        void save_ref.current();
      }
    };
    window.addEventListener('keydown', save_shortcut);
    return () => window.removeEventListener('keydown', save_shortcut);
  }, [active]);
  const { content, draft, saving } = state;
  if (state.content_query.isLoading)
    return (
      <div role="status" className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
        <LoaderCircle className="size-4 animate-spin" />
        Opening file…
      </div>
    );
  if (!content)
    return (
      <div className="p-6">
        <p role="alert" className="mb-3 text-sm text-destructive">
          {state.content_query.error?.message ?? 'This file could not be opened.'}
        </p>
        <Button size="sm" variant="outline" onClick={() => void state.content_query.refetch()}>
          Try again
        </Button>
        {onBrowseFiles ? (
          <Button size="sm" variant="ghost" onClick={onBrowseFiles}>
            Browse files
          </Button>
        ) : null}
      </div>
    );
  const may_edit =
    content.may_edit &&
    (content.content_kind === 'text' ||
      (extension === 'docx' &&
        content.byte_size <= 25 * 1024 * 1024 &&
        Boolean(state.bytes_query.data)));
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {state.discard_dialog}
      <div className="flex flex-wrap items-center gap-1.5 border-b border-border px-3 py-2">
        <span className="mr-auto min-w-0 truncate text-xs text-muted-foreground">
          {draft?.dirty ? 'Unsaved changes' : draft ? 'Editing' : null}
        </span>
        <FileDownloadIconLink file_path={filePath} />
        {draft ? (
          <>
            <Button size="sm" variant="ghost" disabled={saving} onClick={state.cancel}>
              Cancel
            </Button>
            <Button size="sm" disabled={saving || !draft.dirty} onClick={() => void state.save()}>
              {saving ? <LoaderCircle className="size-4 animate-spin" /> : null}
              {saving ? 'Saving…' : 'Save'}
            </Button>
          </>
        ) : (
          <>
            <Button
              aria-label="Reload file"
              title="Reload file"
              size="icon-sm"
              variant="ghost"
              onClick={() => void state.reload()}
            >
              <RefreshCw className="size-4" />
            </Button>
            {may_edit ? (
              <Button size="sm" variant="ghost" onClick={state.start_editing}>
                <Pencil className="size-3.5" />
                Edit
              </Button>
            ) : null}
          </>
        )}
      </div>
      {state.save_error ? (
        <div role="alert" className="border-b border-border px-4 py-3 text-sm text-destructive">
          <p>{state.save_error}</p>
          {draft?.dirty ? (
            <div className="mt-2 flex gap-2">
              <Button size="sm" variant="outline" onClick={() => void state.download_draft()}>
                Download draft
              </Button>
              {state.conflict ? (
                <Button size="sm" variant="ghost" onClick={() => void state.reload()}>
                  Load latest
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
      <div className="flex min-h-0 flex-1 flex-col" inert={saving}>
        {office && content.byte_size <= 25 * 1024 * 1024 ? (
          state.bytes_query.isError ? (
            <div role="alert" className="p-6 text-sm text-destructive">
              {state.bytes_query.error.message}
              <Button
                className="mt-3"
                size="sm"
                variant="outline"
                onClick={() => void state.bytes_query.refetch()}
              >
                Try again
              </Button>
            </div>
          ) : state.bytes_query.data ? (
            <OfficePreview
              key={state.editor_generation}
              editor_generation={state.editor_generation}
              bytes={state.bytes_query.data.bytes}
              file_name={filePath.split('/').pop() ?? filePath}
              editable={Boolean(draft)}
              draft_key={state.draft_key}
              onDirtyChange={state.change_docx}
              onRegisterSave={state.register_save}
            />
          ) : (
            <p role="status" className="p-6 text-sm text-muted-foreground">
              Loading document…
            </p>
          )
        ) : draft?.text !== null && draft?.text !== undefined ? (
          <WorkspaceTextEditor
            text={draft.text}
            markdown={extension === 'md' || extension === 'markdown'}
            onChange={state.change_text}
          />
        ) : content.content_kind === 'text' && content.content_text !== null ? (
          <div className="min-h-0 flex-1 overflow-auto px-6 py-6">
            <WorkspaceFileDocument content_text={content.content_text} file_path={filePath} />
          </div>
        ) : (
          <WorkspaceBinaryFileView
            contentKind={content.content_kind}
            filePath={filePath}
            byteSize={content.byte_size}
          />
        )}
      </div>
    </div>
  );
}
