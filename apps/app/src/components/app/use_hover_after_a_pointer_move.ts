import { useEffect, useRef } from 'react';

/**
 * Tells a hover card whether the pointer really moved onto its row. A row that slides under a
 * resting pointer gets the enter of the browser and no move, and its card must stay shut.
 * When the pointer then moves on that row, the card opens after the same wait as any hover.
 */
export function useHoverAfterAPointerMove(open_the_card: () => void, wait_ms: number) {
  const pointer_has_moved = useRef(false);
  const an_open_was_refused = useRef(false);
  const late_open = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(late_open.current), []);
  return {
    refuses_to_open() {
      an_open_was_refused.current = !pointer_has_moved.current;
      return an_open_was_refused.current;
    },
    row_props: {
      onPointerMove() {
        if (pointer_has_moved.current) return;
        pointer_has_moved.current = true;
        if (an_open_was_refused.current) late_open.current = setTimeout(open_the_card, wait_ms);
      },
      onPointerLeave() {
        pointer_has_moved.current = false;
        an_open_was_refused.current = false;
        clearTimeout(late_open.current);
      },
    },
  };
}
