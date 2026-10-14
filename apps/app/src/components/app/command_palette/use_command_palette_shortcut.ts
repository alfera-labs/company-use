import { useEffect } from 'react';
import { useCommandPaletteStore } from '@/components/app/command_palette/command_palette_store';

export function useCommandPaletteShortcut() {
  const open_command_palette = useCommandPaletteStore((state) => state.open_command_palette);
  const close_command_palette = useCommandPaletteStore((state) => state.close_command_palette);

  useEffect(() => {
    function toggle_palette_on_shortcut(event: KeyboardEvent) {
      if (event.key.toLowerCase() !== 'k') return;
      if (!event.metaKey && !event.ctrlKey) return;
      // Browsers bind Ctrl+K to the address bar; the palette is the more useful answer inside
      // the app, so it takes the key.
      event.preventDefault();
      if (useCommandPaletteStore.getState().is_open) close_command_palette();
      else open_command_palette();
    }

    window.addEventListener('keydown', toggle_palette_on_shortcut);
    return () => window.removeEventListener('keydown', toggle_palette_on_shortcut);
  }, [open_command_palette, close_command_palette]);
}
