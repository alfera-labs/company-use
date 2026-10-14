import { RadioGroup, RadioGroupItem } from '@coworker/ui/components/radio-group';
import { cn } from '@coworker/ui/lib/utils';
import { ChevronDown } from 'lucide-react';
import { useState } from 'react';
import {
  type AiProvider,
  ai_providers,
  find_ai_provider,
} from '@/components/install_sign_in/ai_providers';

export type ChoiceLook = 'sign_in_page' | 'app';

const looks = {
  sign_in_page: {
    card: 'bg-white text-[#131110]',
    resting: 'border-[#e2ded9] hover:border-[#d6d0c9]',
    line: 'text-[#7a736c]',
    badge: 'bg-[#fff1ea] text-[#b33a00]',
    radio: 'border-[#cfc9c2] bg-white',
  },
  app: {
    card: 'bg-raised text-foreground',
    resting: 'border-border hover:border-strong',
    line: 'text-muted-foreground',
    badge: 'bg-brand-wash text-brand-ink',
    radio: '',
  },
} as const satisfies Record<ChoiceLook, Record<string, string>>;

function ProviderCard({
  provider,
  selected,
  look,
}: {
  provider: AiProvider;
  selected: boolean;
  look: ChoiceLook;
}) {
  const id = `ai-provider-${provider.provider_slot}`;
  return (
    <label
      htmlFor={id}
      className={cn(
        'flex cursor-pointer items-center gap-3 rounded-2xl border px-4 py-3 transition-colors duration-150',
        looks[look].card,
        selected ? 'border-primary' : looks[look].resting,
      )}
    >
      <RadioGroupItem id={id} value={provider.provider_slot} className={looks[look].radio} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="flex items-center gap-2 font-medium text-[15px]">
          {provider.name}
          {provider.is_recommended ? (
            <span
              className={cn('rounded-full px-2 py-0.5 font-medium text-[12px]', looks[look].badge)}
            >
              Recommended
            </span>
          ) : null}
        </span>
        <span className={cn('text-[14px]', looks[look].line)}>{provider.line}</span>
      </span>
    </label>
  );
}

/** One choice: how this install connects to AI. The rarer providers wait behind More. */
export function AiProviderChoiceList({
  value,
  on_change,
  look,
}: {
  value: string;
  on_change: (provider_slot: string) => void;
  look: ChoiceLook;
}) {
  const [shows_more, set_shows_more] = useState(Boolean(find_ai_provider(value)?.shown_under_more));
  const shown = ai_providers.filter((provider) => shows_more || !provider.shown_under_more);
  return (
    <div className="flex flex-col gap-2">
      <RadioGroup
        aria-label="How Alfera connects to AI"
        value={value}
        onValueChange={(next) => on_change(String(next))}
        className="gap-2"
      >
        {shown.map((provider) => (
          <ProviderCard
            key={provider.provider_slot}
            provider={provider}
            selected={provider.provider_slot === value}
            look={look}
          />
        ))}
      </RadioGroup>
      {shows_more ? null : (
        <button
          type="button"
          className="flex items-center gap-1 self-start px-1 text-[14px] text-muted-foreground hover:text-foreground"
          onClick={() => set_shows_more(true)}
        >
          More
          <ChevronDown className="size-4" />
        </button>
      )}
    </div>
  );
}
