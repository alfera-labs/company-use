import { Skeleton } from '@coworker/ui/components/skeleton';
import { cn } from '@coworker/ui/lib/utils';
import { type ComponentProps, type CSSProperties, type ReactNode, useRef } from 'react';
import { ChatArtifactPanel } from '@/components/app/chat_artifact_panel';
import { useRememberComposerPlaceOnLeave } from '@/components/app/chat_composer_dock';
import type { ChatThreadProjectionItem } from '@/components/app/chat_stream_projection';
import { HomeGreeting } from '@/components/app/home_greeting';
import { HomeTaskGallery } from '@/components/app/home_task_gallery';
import { WorkspaceFilesPanel } from '@/components/app/workspace_files_panel';
import type { CatalogApp, SandboxUrlPreview } from '@/lib/api';

type BrowserTask = NonNullable<ComponentProps<typeof WorkspaceFilesPanel>['browser_task']>;

/**
 * Lays out the chat beside the files panel or the artifact panel, when one is open. The chat
 * keeps `chat_min_width_beside_files_panel` (400 px): a files panel dragged wider, or a width
 * stored on a larger screen, takes only what is left.
 */
export function ChatSessionGrid(props: {
  files_panel_open: boolean;
  files_panel_width: number;
  shows_artifact_panel: boolean;
  children: ReactNode;
}) {
  const { files_panel_open } = props;
  return (
    <section
      className={cn(
        'relative grid min-h-0 flex-1 overflow-hidden max-xl:grid-cols-1',
        files_panel_open
          ? 'grid-cols-[minmax(400px,1fr)_minmax(0,var(--files-panel-width))]'
          : props.shows_artifact_panel
            ? 'grid-cols-[minmax(0,1fr)_minmax(520px,50vw)]'
            : 'grid-cols-1',
      )}
      style={
        files_panel_open
          ? ({ '--files-panel-width': `${props.files_panel_width}px` } as CSSProperties)
          : undefined
      }
    >
      {props.children}
    </section>
  );
}

/** Shows the workspace files panel, or else the artifact the person opened. */
export function ChatSessionSidePanels(props: {
  session_id: string | undefined;
  files_panel_open: boolean;
  shows_files_panel: boolean;
  files_workspace_id: string | undefined;
  sandbox_previews: SandboxUrlPreview[];
  browser_task: BrowserTask;
  close_files_panel: () => void;
  selected_artifact_id: string | undefined;
  selected_artifact_item: ChatThreadProjectionItem | undefined;
  close_artifact: (session_id: string) => void;
}) {
  const { session_id, files_panel_open, files_workspace_id, selected_artifact_id } = props;
  const { selected_artifact_item } = props;
  return (
    <>
      {props.shows_files_panel && files_workspace_id ? (
        <WorkspaceFilesPanel
          key={files_workspace_id}
          workspace_id={files_workspace_id}
          is_open={files_panel_open}
          session_id={session_id}
          sandboxPreviews={props.sandbox_previews}
          browser_task={props.browser_task}
          onClose={props.close_files_panel}
        />
      ) : null}
      {!files_panel_open && selected_artifact_id && session_id ? (
        <ChatArtifactPanel
          artifactId={selected_artifact_id}
          {...(selected_artifact_item ? { liveArtifact: selected_artifact_item } : {})}
          onClose={() => props.close_artifact(session_id)}
        />
      ) : null}
    </>
  );
}

/** Greets the person in a new chat, with the composer and the task gallery below. */
export function ChatOnboardingHome(props: {
  apps: CatalogApp[];
  composer: ReactNode;
  on_select_template: (prompt: string) => void;
}) {
  const composer_ref = useRef<HTMLDivElement>(null);
  useRememberComposerPlaceOnLeave(composer_ref);
  return (
    <div className="mx-auto w-full max-w-3xl px-4 pt-10 pb-16 md:pt-14">
      <HomeGreeting />
      <div className="mt-6" ref={composer_ref}>
        {props.composer}
      </div>
      <div className="mt-10">
        <HomeTaskGallery apps={props.apps} onSelectTemplate={props.on_select_template} />
      </div>
    </div>
  );
}

/** Shows placeholder bubbles while the messages of a chat load. */
export function ChatSessionLoadingSkeleton() {
  return (
    <div
      aria-label="Loading chat"
      aria-live="polite"
      className="flex h-full min-h-0 w-full flex-1 flex-col items-center overflow-hidden"
      role="status"
    >
      <div className="flex w-full max-w-3xl flex-col gap-3 px-6 pt-28 pb-3 lg:pt-16">
        <Skeleton className="h-16 w-2/3 rounded-2xl" />
        <Skeleton className="ml-auto h-16 w-1/2 rounded-2xl" />
        <Skeleton className="h-20 w-3/4 rounded-2xl" />
      </div>
    </div>
  );
}
