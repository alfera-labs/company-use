import { Button } from '@coworker/ui/components/button';
import { ChevronLeft, ChevronRight } from 'lucide-react';

/** The control under a slide: the number of the slide in view, and the way to the one before and after. */
export function PowerpointSlideSwitch({
  slide_index,
  slide_count,
  onPrevious,
  onNext,
}: {
  slide_index: number;
  slide_count: number;
  onPrevious: () => void;
  onNext: () => void;
}) {
  return (
    <div className="flex h-10 shrink-0 items-center justify-center gap-2 border-t border-border bg-background px-3 text-xs text-muted-foreground">
      <Button
        aria-label="Previous slide"
        size="icon-sm"
        variant="ghost"
        disabled={slide_index <= 0}
        onClick={onPrevious}
      >
        <ChevronLeft />
      </Button>
      <span className="tabular-nums">
        Slide {Math.min(slide_index + 1, slide_count)} of {slide_count}
      </span>
      <Button
        aria-label="Next slide"
        size="icon-sm"
        variant="ghost"
        disabled={slide_index >= slide_count - 1}
        onClick={onNext}
      >
        <ChevronRight />
      </Button>
    </div>
  );
}
