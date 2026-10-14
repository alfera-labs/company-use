import { Skeleton } from '@coworker/ui/components/skeleton';
import { useQuery } from '@tanstack/react-query';
import { EmptyNotice, WorkspaceFilesList } from '@/components/app/workspace_files_list';
import { list_workspace_files } from '@/lib/api';
import { query_keys } from '@/lib/api/query_keys';

export function WorkspaceFilesGrid({
  folderPath,
  onOpenFile,
  onOpenFolder,
  workspace_id,
}: {
  folderPath: string;
  onOpenFile: (file_path: string) => void;
  onOpenFolder: (folder_path: string) => void;
  workspace_id: string;
}) {
  const listing_query = useQuery({
    queryFn: () => list_workspace_files(folderPath),
    queryKey: query_keys.workspace_files(workspace_id, folderPath),
    refetchInterval: (query) => (query.state.data?.volume_ready === false ? 3000 : false),
  });
  return (
    <WorkspaceFilesGridView
      listing={listing_query.data}
      is_loading={listing_query.isLoading}
      is_error={listing_query.isError}
      folderPath={folderPath}
      onOpenFile={onOpenFile}
      onOpenFolder={onOpenFolder}
    />
  );
}

export function WorkspaceFilesGridView({
  listing,
  is_loading = false,
  is_error = false,
  folderPath,
  onOpenFile,
  onOpenFolder,
}: {
  listing: Awaited<ReturnType<typeof list_workspace_files>> | undefined;
  is_loading?: boolean;
  is_error?: boolean;
  folderPath: string;
  onOpenFile: (path: string) => void;
  onOpenFolder: (path: string) => void;
}) {
  if (is_loading) return <GridSkeleton />;
  if (is_error) {
    return (
      <div className="p-4">
        <div className="rounded-2xl border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
          Files are not reachable right now. Try again in a moment.
        </div>
      </div>
    );
  }
  if (!listing) return null;
  if (!listing.volume_ready) {
    return <EmptyNotice>Files appear here as Alfera works.</EmptyNotice>;
  }
  if (listing.folders.length === 0 && listing.files.length === 0) {
    return <EmptyNotice>This folder is empty.</EmptyNotice>;
  }
  return (
    <WorkspaceFilesList
      listing={listing}
      folderPath={folderPath}
      onOpenFile={onOpenFile}
      onOpenFolder={onOpenFolder}
    />
  );
}

function GridSkeleton() {
  return (
    <div className="space-y-0.5 px-4 py-3">
      <Skeleton className="h-10 w-full" />
      <Skeleton className="h-10 w-full" />
      <Skeleton className="h-10 w-full" />
    </div>
  );
}
