import { buttonVariants } from '@coworker/ui/components/button';
import { Link } from '@tanstack/react-router';
import type { ModelCatalogEntry } from '@/lib/api';

type KeyThatUnlocksAModel = ModelCatalogEntry['keys_that_unlock_this_model'][number];

export function add_a_key_label(key: KeyThatUnlocksAModel) {
  const article = /^(?:[AEIOU]|x[A-Z])/u.test(key.display_name) ? 'an' : 'a';
  return `Add ${article} ${key.display_name} key`;
}

function AddKeyLink({ provider_slot, label }: { provider_slot: string; label: string }) {
  return (
    <Link
      className={buttonVariants({ size: 'sm', variant: 'outline' })}
      to="/settings/{-$section}"
      params={{ section: 'models' }}
      search={{ add_key: provider_slot }}
      reloadDocument
    >
      {label}
    </Link>
  );
}

/** Under the picker: the keys that unlock the model the person is looking at. */
export function AddModelKeyNote({ keys }: { keys: KeyThatUnlocksAModel[] }) {
  const [own_key, one_key_for_every_model] = keys;
  if (!own_key) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 border-t px-3 py-2">
      <AddKeyLink provider_slot={own_key.provider_slot} label={add_a_key_label(own_key)} />
      {one_key_for_every_model ? (
        <AddKeyLink
          provider_slot={one_key_for_every_model.provider_slot}
          label={`or add one ${one_key_for_every_model.display_name} key for all models`}
        />
      ) : null}
    </div>
  );
}
