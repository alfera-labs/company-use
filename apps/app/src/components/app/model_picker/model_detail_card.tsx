import { cn } from '@coworker/ui/lib/utils';
import { Check, Minus } from 'lucide-react';
import { useCallback, useRef, useState } from 'react';
import {
  describe_context_window,
  model_capabilities,
} from '@/components/app/model_picker/model_display';
import { ProviderLogo } from '@/components/app/model_picker/provider_logo';
import type { ModelCatalogEntry } from '@/lib/api';

export const model_detail_card_width_in_pixels = 240;

const side_class_names = {
  start: 'end-full me-2',
  end: 'start-full ms-2',
} as const;

export type ModelDetailCardSide = keyof typeof side_class_names;

/**
 * The side of the open menu that has room for the card, or null when neither has: a card
 * drawn past the edge of the window is cut and makes the page scroll sideways.
 */
export function read_side_with_room_for_card(
  menu: Pick<DOMRect, 'left' | 'right'>,
  window_width: number,
): ModelDetailCardSide | null {
  const room_needed = model_detail_card_width_in_pixels + 16;
  if (menu.left >= room_needed) return 'start';
  if (window_width - menu.right >= room_needed) return 'end';
  return null;
}

/**
 * The side for the card, and the ref that goes on the open menu. The menu is put in its place
 * after it mounts, so its place is read one frame later, and the side is unknown until then.
 */
export function useSideWithRoomForCard() {
  const [side, set_side] = useState<ModelDetailCardSide | null>(null);
  const measuring_frame = useRef(0);
  const measure_menu = useCallback((menu: HTMLElement | null) => {
    cancelAnimationFrame(measuring_frame.current);
    if (!menu) return set_side(null);
    measuring_frame.current = requestAnimationFrame(() =>
      set_side(read_side_with_room_for_card(menu.getBoundingClientRect(), window.innerWidth)),
    );
  }, []);
  return [side, measure_menu] as const;
}

/** Draws nothing until the side is known, so the card never shows on one side and then jumps. */
export function ModelDetailCard({
  model,
  side,
}: {
  model: ModelCatalogEntry | null;
  side: ModelDetailCardSide | null;
}) {
  if (!model || !side) return null;

  return (
    <div
      className={cn(
        'pointer-events-none absolute top-0 hidden w-60 rounded-3xl border bg-popover p-4 shadow-lg lg:block',
        side_class_names[side],
      )}
    >
      <div className="flex min-w-0 items-center gap-2">
        <ProviderLogo
          model_provider={model.model_provider}
          provider_display_name={model.model_provider_display_name}
        />
        <p className="truncate text-sm font-medium">{model.model_display_name}</p>
      </div>
      {model.description ? (
        <p className="mt-1.5 line-clamp-3 text-xs leading-relaxed text-muted-foreground">
          {model.description}
        </p>
      ) : null}

      <dl className="mt-4 grid gap-2 text-xs">
        {model.speed_out_of_five === null ? null : (
          <ModelMeter filled_out_of_five={model.speed_out_of_five} label="Speed" />
        )}
        {model.intelligence_out_of_five === null ? null : (
          <ModelMeter filled_out_of_five={model.intelligence_out_of_five} label="Intelligence" />
        )}
        <SpecRow label="Provider" value={model.model_provider_display_name} />
        <SpecRow label="Context" value={describe_context_window(model.context_window)} />
      </dl>

      <ul className="mt-4 grid gap-2 border-t pt-3 text-xs">
        {model_capabilities.map((capability) => (
          <CapabilityRow
            isSupported={capability.is_supported(model)}
            key={capability.label}
            label={capability.label}
          />
        ))}
      </ul>
    </div>
  );
}

function SpecRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-end">{value}</dd>
    </div>
  );
}

function CapabilityRow({ label, isSupported }: { label: string; isSupported: boolean }) {
  return (
    <li className="flex items-center justify-between gap-3">
      <span className={isSupported ? '' : 'text-muted-foreground'}>{label}</span>
      {isSupported ? (
        <Check aria-label="supported" className="size-3.5 shrink-0" />
      ) : (
        <Minus aria-label="not supported" className="size-3.5 shrink-0 text-muted-foreground" />
      )}
    </li>
  );
}

const meter_segments = [1, 2, 3, 4, 5];

function ModelMeter({ label, filled_out_of_five }: { label: string; filled_out_of_five: number }) {
  return (
    <div className="flex min-w-0 items-center justify-between gap-2">
      <dt className="truncate text-muted-foreground">{label}</dt>
      <dd
        aria-label={`${label}: ${filled_out_of_five} out of 5`}
        className="flex shrink-0 items-center gap-[3px]"
        role="img"
      >
        {meter_segments.map((segment) => (
          <span
            aria-hidden="true"
            className={cn(
              'h-[3px] w-3 rounded-full',
              segment <= filled_out_of_five ? 'bg-foreground' : 'bg-border',
            )}
            key={segment}
          />
        ))}
      </dd>
    </div>
  );
}
