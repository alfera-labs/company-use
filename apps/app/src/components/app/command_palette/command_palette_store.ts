import { create } from 'zustand';

type CommandPaletteState = {
  is_open: boolean;
  open_command_palette: () => void;
  close_command_palette: () => void;
  set_command_palette_open: (is_open: boolean) => void;
};

export const useCommandPaletteStore = create<CommandPaletteState>((set) => ({
  is_open: false,
  open_command_palette: () => set({ is_open: true }),
  close_command_palette: () => set({ is_open: false }),
  set_command_palette_open: (is_open) => set({ is_open }),
}));
