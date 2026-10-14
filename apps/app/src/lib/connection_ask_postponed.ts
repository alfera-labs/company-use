const connection_ask_postponed_prefix = 'connection_ask_postponed:';

export function read_connection_ask_postponed(connection_id: string) {
  if (typeof window === 'undefined') return false;

  try {
    return window.localStorage.getItem(connection_ask_postponed_prefix + connection_id) !== null;
  } catch (error) {
    console.error(`Could not read the postponed connection ask for ${connection_id}.`, error);
    return false;
  }
}

export function write_connection_ask_postponed(connection_id: string, postponed: boolean) {
  if (typeof window === 'undefined') return;

  const storage_key = connection_ask_postponed_prefix + connection_id;
  try {
    if (postponed) window.localStorage.setItem(storage_key, 'yes');
    else window.localStorage.removeItem(storage_key);
  } catch (error) {
    console.error(`Could not save the postponed connection ask for ${connection_id}.`, error);
  }
}
