import { useEffect } from 'react';

export function scroll_to_section_and_flash(node: HTMLElement, block: ScrollLogicalPosition) {
  const wants_less_motion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  node.scrollIntoView({ behavior: wants_less_motion ? 'auto' : 'smooth', block });

  node.setAttribute('tabindex', '-1');
  node.focus({ preventScroll: true });

  if (wants_less_motion) return;
  node.classList.add('is-flashing');
  // animationend bubbles, so a child finishing its own animation would strip the class early.
  const clear_flash = (event: AnimationEvent) => {
    if (event.target !== node) return;
    node.classList.remove('is-flashing');
    node.removeEventListener('animationend', clear_flash);
  };
  node.addEventListener('animationend', clear_flash);
}

export function useScrollToHashSection() {
  useEffect(() => {
    const section = document.getElementById(window.location.hash.slice(1));
    if (section) scroll_to_section_and_flash(section, 'start');
  }, []);
}
