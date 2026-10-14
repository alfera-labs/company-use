export function write_text_as_if_typing(input: {
  full_text: string;
  write: (text: string) => void;
  duration_ms?: number;
}): () => void {
  const { full_text, write } = input;
  const duration_ms = input.duration_ms ?? 600;

  const reduce_motion =
    typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduce_motion || typeof window === 'undefined') {
    write(full_text);
    return () => {};
  }

  let frame = 0;
  const started_at = performance.now();
  const step = (now: number) => {
    const progress = Math.min((now - started_at) / duration_ms, 1);
    const eased = 1 - (1 - progress) ** 2;
    write(full_text.slice(0, Math.ceil(full_text.length * eased)));
    if (progress < 1) frame = window.requestAnimationFrame(step);
  };
  frame = window.requestAnimationFrame(step);

  return () => window.cancelAnimationFrame(frame);
}
