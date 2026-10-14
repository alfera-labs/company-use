import { useSyncExternalStore } from 'react';

const reduced_motion_query = '(prefers-reduced-motion: reduce)';

function watch_the_setting(on_change: () => void) {
  const setting = window.matchMedia(reduced_motion_query);
  setting.addEventListener('change', on_change);
  return () => setting.removeEventListener('change', on_change);
}

/**
 * Whether the person asked their system for less motion. The server cannot know, so it answers
 * "no" and the browser corrects it after the page is live, without a mismatch.
 */
export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(
    watch_the_setting,
    () => window.matchMedia(reduced_motion_query).matches,
    () => false,
  );
}
