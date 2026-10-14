export const brand_mark_view_box = '0 2.95 171.867 150.383';
export const brand_mark_path =
  'M42.967,153.333l-42.967,0l39.557,-69.224l42.842,0.218l-39.432,69.005Zm21.216,-112.32l21.751,-38.063l85.933,150.383l-42.967,0l-42.967,-75.192l-0.063,0.111l-21.687,-37.239Z';

export function BrandMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox={brand_mark_view_box}
      role="img"
      aria-label="Alfera"
      className={className}
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d={brand_mark_path} />
    </svg>
  );
}
