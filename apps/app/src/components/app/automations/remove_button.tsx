import { X } from 'lucide-react';

export function RemoveButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      aria-label={label}
      className="text-muted-foreground hover:text-foreground"
      type="button"
      onClick={onClick}
    >
      <X aria-hidden="true" className="size-4" />
    </button>
  );
}
