import { Loader2 } from 'lucide-react';
import { memo, useEffect, useLayoutEffect, useRef } from 'react';
import { useStickToBottomContext } from 'use-stick-to-bottom';

const prefetch_margin = '800px 0px 0px 0px';

export const ChatEarlierMessagesLoader = memo(function ChatEarlierMessagesLoader({
  firstMessageKey,
  hasEarlier,
  isLoading,
  onLoad,
}: {
  firstMessageKey: string;
  hasEarlier: boolean;
  isLoading: boolean;
  onLoad: () => void;
}) {
  const { escapedFromLock, scrollRef, stopScroll } = useStickToBottomContext();
  const sentinel_ref = useRef<HTMLDivElement | null>(null);
  const anchor_ref = useRef<{ element: Element; top: number } | null>(null);

  useEffect(() => {
    const sentinel = sentinel_ref.current;
    const root = scrollRef.current;
    if (!sentinel || !root) return;
    const can_scroll = root.scrollHeight > root.clientHeight + 1;
    if (can_scroll && !escapedFromLock) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting || !hasEarlier || isLoading) return;
        const first_row = sentinel.nextElementSibling;
        anchor_ref.current = first_row
          ? { element: first_row, top: first_row.getBoundingClientRect().top }
          : null;
        // The reader is near the top, so the container must not glide back to the bottom when
        // the page lands. Its own scroll handler can miss that when a resize lands in the same
        // tick, so say it outright.
        stopScroll();
        onLoad();
      },
      { root, rootMargin: prefetch_margin },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [escapedFromLock, hasEarlier, isLoading, onLoad, scrollRef, stopScroll]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: firstMessageKey is the cue, not a value read here. A new first row means a page landed.
  useLayoutEffect(() => {
    const anchor = anchor_ref.current;
    const root = scrollRef.current;
    if (!anchor || !root || isLoading) return;
    if (anchor.element.isConnected) {
      root.scrollTop += anchor.element.getBoundingClientRect().top - anchor.top;
    }
    anchor_ref.current = null;
  }, [firstMessageKey, isLoading, scrollRef]);

  return (
    <div aria-hidden={!isLoading} className="relative h-px w-full shrink-0" ref={sentinel_ref}>
      {isLoading ? (
        <div
          className="absolute inset-x-0 top-2 flex justify-center gap-2 text-[13px] text-muted-foreground"
          role="status"
        >
          <Loader2 aria-hidden="true" className="size-3.5 animate-spin self-center" />
          Loading earlier messages
        </div>
      ) : null}
    </div>
  );
});
