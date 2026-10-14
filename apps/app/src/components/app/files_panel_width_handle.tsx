import {
  useChatUiStore,
  width_that_leaves_room_for_the_chat,
} from '@/components/app/chat_ui_store';

/**
 * The left edge of the Files panel, dragged to set its width. The width stops where the chat
 * beside the panel would get narrower than its minimum.
 */
export function FilesPanelWidthHandle() {
  const set_files_panel_width = useChatUiStore((state) => state.set_files_panel_width);
  const start_width_drag = (down: React.PointerEvent<HTMLDivElement>) => {
    down.preventDefault();
    down.currentTarget.setPointerCapture(down.pointerId);
    const room_for_chat_and_panel = down.currentTarget.parentElement?.parentElement?.clientWidth;
    const resize = (move: PointerEvent) =>
      set_files_panel_width(
        width_that_leaves_room_for_the_chat(
          window.innerWidth - move.clientX,
          room_for_chat_and_panel,
        ),
      );
    const stop = () => {
      window.removeEventListener('pointermove', resize);
      window.removeEventListener('pointerup', stop);
    };
    window.addEventListener('pointermove', resize);
    window.addEventListener('pointerup', stop);
  };
  return (
    <div
      aria-hidden
      className="absolute inset-y-0 -left-1 z-10 hidden w-2 cursor-col-resize hover:bg-primary/20 active:bg-primary/30 xl:block"
      onPointerDown={start_width_drag}
    />
  );
}
