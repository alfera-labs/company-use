import { type ReactNode, type RefObject, useLayoutEffect, useRef } from 'react';

const travel_ms = 200;
const transcript_appears_ms = 120;
const remembered_place_lasts_ms = 1500;

let new_chat_composer_place: { top: number; time_ms: number } | undefined;

/**
 * Remembers where the composer of the new-chat page is on the screen, so the composer of the
 * chat can start its travel from there. Call it right before that page goes away.
 */
export function remember_new_chat_composer_place(composer: Element | null | undefined) {
  const text_box = composer?.querySelector('textarea');
  if (!text_box) return;
  new_chat_composer_place = { top: text_box.getBoundingClientRect().top, time_ms: Date.now() };
}

function take_new_chat_composer_top() {
  const place = new_chat_composer_place;
  new_chat_composer_place = undefined;
  if (!place || Date.now() - place.time_ms > remembered_place_lasts_ms) return undefined;
  return place.top;
}

/**
 * Remembers the place of the composer inside the element when the element leaves the page. An
 * element that left before the browser drew it once is not a place the person saw, so the place
 * remembered before it stays.
 */
export function useRememberComposerPlaceOnLeave(composer_ref: RefObject<Element | null>) {
  useLayoutEffect(() => {
    const composer = composer_ref.current;
    let was_drawn = false;
    const first_frame = requestAnimationFrame(() => {
      was_drawn = true;
    });
    return () => {
      cancelAnimationFrame(first_frame);
      if (was_drawn) remember_new_chat_composer_place(composer);
    };
  }, [composer_ref]);
}

function travel_from_new_chat_page(dock: HTMLElement) {
  const from_top = take_new_chat_composer_top();
  const to_top = dock.querySelector('textarea')?.getBoundingClientRect().top;
  if (from_top === undefined || to_top === undefined || !dock.animate) return;
  dock.animate([{ transform: `translateY(${from_top - to_top}px)` }, { transform: 'none' }], {
    duration: travel_ms,
    easing: 'linear',
  });
  const whole_ms = travel_ms + transcript_appears_ms;
  dock.previousElementSibling?.animate(
    [{ opacity: 0 }, { opacity: 0, offset: travel_ms / whole_ms }, { opacity: 1 }],
    { duration: whole_ms, easing: 'linear' },
  );
}

/**
 * The composer at the bottom of a chat. It arrives from its place on the new-chat page in one
 * even move that the browser draws by itself, so work on the page cannot make it stutter. The
 * transcript above stays unseen until the composer has left its area: the composer never covers
 * the message, a picture or "Working".
 */
export function ChatComposerDock({ children }: { children: ReactNode }) {
  const dock_ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (dock_ref.current) travel_from_new_chat_page(dock_ref.current);
  }, []);
  return (
    <div className="relative inset-x-0 bottom-0 z-sticky mx-auto w-full max-w-3xl" ref={dock_ref}>
      {children}
    </div>
  );
}
