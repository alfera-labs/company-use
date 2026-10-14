import { useState } from 'react';

export function useLivingFold({ forceOpen = false }: { forceOpen?: boolean }) {
  const [is_open, set_is_open] = useState(false);
  return {
    isOpen: forceOpen || is_open,
    onToggle: () => set_is_open((current) => !current),
  };
}
