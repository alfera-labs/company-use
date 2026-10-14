import { AlertCircle, Loader2 } from 'lucide-react';

export function OfficePreviewLoading({ label }: { label: string }) {
  return (
    <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
      <Loader2 aria-hidden="true" className="size-4 animate-spin" />
      {label}
    </div>
  );
}

export function OfficePreviewError({ message }: { message: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
      <AlertCircle aria-hidden="true" className="size-5 text-destructive" />
      <p className="max-w-sm text-sm text-destructive">{message}</p>
    </div>
  );
}
