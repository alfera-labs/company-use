import { useEffect, useState } from 'react';

const token_storage_key = 'alfera_setup_token';
const recovery_code_storage_key = 'alfera_setup_recovery_code';

/**
 * Runs in the page head, before the app's own code and before any page-view tracking: it moves
 * `#token=` out of the address into this tab's storage, so no script ever sees the token in the
 * address and it is in no screenshot or history entry.
 */
export const take_setup_token_out_of_the_address_script = `(function(){var m=/[#&]token=([^&]+)/.exec(location.hash);if(!m)return;try{sessionStorage.setItem('${token_storage_key}',decodeURIComponent(m[1]))}catch(e){}history.replaceState(null,'',location.pathname)})();`;

function take_token_from_address(): string | null {
  const token = new URLSearchParams(window.location.hash.slice(1)).get('token');
  if (!token) return null;
  window.history.replaceState(null, '', window.location.pathname);
  return token;
}

export type SetupTokenState = { looked: false } | { looked: true; token: string | null };

export function useSetupToken(): SetupTokenState {
  const [state, set_state] = useState<SetupTokenState>({ looked: false });
  useEffect(() => {
    const read_token = () => {
      const from_address = take_token_from_address();
      if (from_address) window.sessionStorage.setItem(token_storage_key, from_address);
      set_state({
        looked: true,
        token: from_address ?? window.sessionStorage.getItem(token_storage_key),
      });
    };
    read_token();
    window.addEventListener('hashchange', read_token);
    return () => window.removeEventListener('hashchange', read_token);
  }, []);
  return state;
}

export function keep_recovery_code_until_saved(recovery_code: string): void {
  window.sessionStorage.setItem(recovery_code_storage_key, recovery_code);
}

export function read_unsaved_recovery_code(): string | null {
  return window.sessionStorage.getItem(recovery_code_storage_key);
}

export function forget_setup(): void {
  window.sessionStorage.removeItem(token_storage_key);
  window.sessionStorage.removeItem(recovery_code_storage_key);
}
