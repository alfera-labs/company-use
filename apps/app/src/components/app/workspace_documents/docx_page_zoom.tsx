import { type PropsWithChildren, useLayoutEffect, useRef, useState } from 'react';

export type DocxZoomChoice = 'fit' | number;

const zoom_percent_choices = [75, 100, 125, 150];
const page_side_gap_px = 12;

/**
 * The zoom at which a page of this width is fully in view in an area of this width, with a
 * small gap on each side. It never makes the page larger than its real size.
 */
export function zoom_that_fits_page(area_width_px: number, page_width_px: number) {
  if (area_width_px <= 0 || page_width_px <= 0) return 1;
  return Math.min(1, Math.max(0.1, (area_width_px - 2 * page_side_gap_px) / page_width_px));
}

/**
 * The scroll area of a document. With the "fit" choice the page is as wide as the area and
 * stays so when the area changes width. With a percent choice the person scrolls sideways.
 */
export function DocxPageArea({
  page_width_px,
  zoom_choice,
  children,
}: PropsWithChildren<{ page_width_px: number; zoom_choice: DocxZoomChoice }>) {
  const area_ref = useRef<HTMLDivElement>(null);
  const [area_width_px, set_area_width_px] = useState(0);
  useLayoutEffect(() => {
    const area = area_ref.current;
    if (!area) return;
    set_area_width_px(area.clientWidth);
    const observer = new ResizeObserver(([entry]) => {
      if (entry) set_area_width_px(entry.contentRect.width);
    });
    observer.observe(area);
    return () => observer.disconnect();
  }, []);
  const zoom =
    zoom_choice === 'fit' ? zoom_that_fits_page(area_width_px, page_width_px) : zoom_choice;
  return (
    <div ref={area_ref} className="min-h-0 flex-1 overflow-auto py-5">
      <div className="mx-auto w-fit origin-top" style={{ zoom }}>
        {children}
      </div>
    </div>
  );
}

export function DocxZoomSelect({
  zoom_choice,
  onChange,
}: {
  zoom_choice: DocxZoomChoice;
  onChange: (zoom_choice: DocxZoomChoice) => void;
}) {
  return (
    <select
      aria-label="Zoom"
      className="h-6 rounded-xl border border-border bg-background px-1 text-xs tabular-nums"
      value={zoom_choice}
      onChange={(event) =>
        onChange(event.target.value === 'fit' ? 'fit' : Number(event.target.value))
      }
    >
      <option value="fit">Fit</option>
      {zoom_percent_choices.map((percent) => (
        <option key={percent} value={percent / 100}>
          {percent}%
        </option>
      ))}
    </select>
  );
}
