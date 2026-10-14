import { Kbd } from '@coworker/ui/components/kbd';
import { Tooltip, TooltipContent, TooltipTrigger } from '@coworker/ui/components/tooltip';
import { Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useCommandPaletteStore } from '@/components/app/command_palette/command_palette_store';

export function CommandPaletteTrigger() {
  const open_command_palette = useCommandPaletteStore((state) => state.open_command_palette);

  return <CommandPaletteTriggerView on_open={open_command_palette} />;
}

export function CommandPaletteTriggerView({
  on_open,
  disabled = false,
}: {
  on_open: () => void;
  disabled?: boolean;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            aria-label="Search"
            disabled={disabled}
            className="grid size-8 place-items-center rounded-2xl text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
            onClick={on_open}
            type="button"
          />
        }
      >
        <Search aria-hidden="true" className="size-4" />
      </TooltipTrigger>
      <TooltipContent side="right" className="flex items-center gap-2">
        Search <SearchShortcutHint />
      </TooltipContent>
    </Tooltip>
  );
}

// Rendered only after mount: the label depends on the platform, and a server render that guessed
// would either hydrate-mismatch or show every Windows user the wrong key.
function SearchShortcutHint() {
  const [shortcut_label, set_shortcut_label] = useState<string | null>(null);

  useEffect(() => {
    set_shortcut_label(is_apple_platform() ? '⌘K' : 'Ctrl K');
  }, []);

  if (shortcut_label === null) return null;

  return <Kbd>{shortcut_label}</Kbd>;
}

function is_apple_platform() {
  return /mac|iphone|ipad|ipod/i.test(navigator.platform || navigator.userAgent);
}
