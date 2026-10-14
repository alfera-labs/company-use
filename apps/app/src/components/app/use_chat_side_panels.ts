import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useState } from 'react';
import { useChatLiveStreamStore } from '@/components/app/chat_live_stream_store';
import type { ChatThreadProjectionItem } from '@/components/app/chat_stream_projection';
import { useChatUiStore } from '@/components/app/chat_ui_store';
import { get_current_workspace } from '@/lib/api';
import { query_keys } from '@/lib/api/query_keys';

function useFilesPanel() {
  const files_panel_open = useChatUiStore((state) => state.files_panel_open);
  const workspace_for_files = useQuery({
    queryKey: query_keys.workspace(),
    queryFn: get_current_workspace,
  });
  const [files_panel_mounted, set_files_panel_mounted] = useState(files_panel_open);
  useEffect(() => {
    if (files_panel_open) set_files_panel_mounted(true);
  }, [files_panel_open]);
  const set_files_panel_open = useChatUiStore((state) => state.set_files_panel_open);
  const files_panel_width = useChatUiStore((state) => state.files_panel_width);
  const open_workspace_file_in_panel = useChatUiStore(
    (state) => state.open_workspace_file_in_panel,
  );
  return {
    files_panel_open,
    shows_files_panel: files_panel_open || files_panel_mounted,
    files_workspace_id: workspace_for_files.data?.workspace_id,
    set_files_panel_open,
    files_panel_width,
    open_workspace_file_in_panel,
  };
}

function useArtifactPanel(
  session_id: string | undefined,
  artifact_items: ChatThreadProjectionItem[],
  set_files_panel_open: (open: boolean) => void,
) {
  const selected_artifact_id = useChatLiveStreamStore((state) =>
    session_id ? state.selected_artifact_id_by_session[session_id] : undefined,
  );
  const select_artifact = useChatLiveStreamStore((state) => state.select_artifact);
  const clear_selected_artifact = useChatLiveStreamStore((state) => state.clear_selected_artifact);
  const selected_artifact_item = selected_artifact_id
    ? artifact_items.find(
        (item) => item.file_id === selected_artifact_id || item.item_id === selected_artifact_id,
      )
    : undefined;
  useEffect(() => {
    if (selected_artifact_id) set_files_panel_open(false);
  }, [selected_artifact_id, set_files_panel_open]);
  const open_artifact = useCallback(
    (file_id: string) => {
      if (session_id) select_artifact(session_id, file_id);
    },
    [select_artifact, session_id],
  );
  return { selected_artifact_id, selected_artifact_item, open_artifact, clear_selected_artifact };
}

/** Keeps the state of the two side panels of a chat: the workspace files and the open artifact. */
export function useChatSidePanels(
  session_id: string | undefined,
  artifact_items: ChatThreadProjectionItem[],
) {
  const files = useFilesPanel();
  const artifact = useArtifactPanel(session_id, artifact_items, files.set_files_panel_open);
  return { ...files, ...artifact };
}
