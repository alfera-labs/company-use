import {
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@coworker/ui/components/alert-dialog';
import { Button } from '@coworker/ui/components/button';
import { Check, Copy } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import type { MintedApiKey } from '@/lib/api/types';
import { copy_text } from '@/lib/copy_text';

export function MintedApiKeySecret({
  minted,
  on_done,
}: {
  minted: MintedApiKey;
  on_done: () => void;
}) {
  const [copied, set_copied] = useState(false);

  const copy_secret = async () => {
    try {
      await copy_text(minted.secret);
      set_copied(true);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not copy the key');
    }
  };

  return (
    <div>
      <AlertDialogHeader>
        <AlertDialogTitle>{minted.api_key.key_name} is ready</AlertDialogTitle>
        <AlertDialogDescription>
          Copy it now. You won&apos;t see it again: after you close this, only the start of it,{' '}
          <code className="text-xs">{minted.api_key.key_prefix}…</code>, stays on the list.
        </AlertDialogDescription>
      </AlertDialogHeader>

      <div className="mt-5 rounded-2xl border bg-sunken p-3">
        <p className="max-h-32 overflow-y-auto pr-2 font-mono text-sm leading-6 break-words text-foreground [overflow-wrap:anywhere]">
          {minted.secret}
        </p>
        <div className="mt-3 flex justify-end">
          <Button size="sm" variant="outline" onClick={() => void copy_secret()}>
            {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
            {copied ? 'Copied' : 'Copy key'}
          </Button>
        </div>
      </div>

      <AlertDialogFooter>
        <Button size="sm" onClick={on_done}>
          Done
        </Button>
      </AlertDialogFooter>
    </div>
  );
}
