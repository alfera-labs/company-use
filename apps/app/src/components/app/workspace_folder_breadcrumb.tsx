import { cn } from '@coworker/ui/lib/utils';

export function WorkspaceFolderBreadcrumb({
  folderPath,
  onNavigate,
}: {
  folderPath: string;
  onNavigate: (folder_path: string) => void;
}) {
  const segments = folderPath.split('/');
  return (
    <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-hidden text-xs text-muted-foreground">
      {segments.map((segment, index) => {
        const target = segments.slice(0, index + 1).join('/');
        const last = index === segments.length - 1;
        return (
          <span className="flex min-w-0 items-center gap-0.5" key={target}>
            {index > 0 ? <span className="shrink-0 text-muted-foreground">/</span> : null}
            <button
              className={cn(
                'truncate rounded px-1 py-0.5 hover:bg-hover hover:text-foreground',
                last && 'text-foreground',
              )}
              type="button"
              onClick={() => onNavigate(target)}
            >
              {segment}
            </button>
          </span>
        );
      })}
    </div>
  );
}
