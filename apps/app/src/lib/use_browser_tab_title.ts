import { useEffect } from 'react';
import { page_title } from '@/lib/page_title';

/** Shows the name of what is on screen in the browser tab, in place of the name of the page. */
export function useBrowserTabTitle(name: string) {
  useEffect(() => {
    document.title = page_title(name);
  }, [name]);
}
