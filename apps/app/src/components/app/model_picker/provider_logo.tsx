import { model_provider_logo_base_url } from '@coworker/config/hosted_defaults';
import { cn } from '@coworker/ui/lib/utils';
import { useState } from 'react';

export function ProviderLogo({
  className,
  model_provider,
  provider_display_name,
}: {
  className?: string;
  model_provider: string;
  provider_display_name: string;
}) {
  const [logo_failed_to_load, set_logo_failed_to_load] = useState(false);
  const shared_class_name = cn('grid size-5 shrink-0 place-items-center rounded-[5px]', className);

  if (logo_failed_to_load || !model_provider_logo_base_url) {
    return (
      <span
        aria-hidden="true"
        className={cn(
          shared_class_name,
          'bg-muted text-[10px] font-semibold text-muted-foreground',
        )}
      >
        {provider_display_name.slice(0, 1).toUpperCase()}
      </span>
    );
  }

  return (
    <img
      alt=""
      className={cn(shared_class_name, 'object-contain dark:invert-[0.9]')}
      loading="lazy"
      src={`${model_provider_logo_base_url}/${model_provider}.svg`}
      onError={() => set_logo_failed_to_load(true)}
    />
  );
}
