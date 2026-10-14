import { Button } from '@coworker/ui/components/button';
import { Input } from '@coworker/ui/components/input';
import { Check, Copy } from 'lucide-react';
import { useState } from 'react';
import { sign_in_link_address } from '@/components/app/team_mode_words';
import type { TeamAddress } from '@/lib/api/team_mode';
import { copy_text } from '@/lib/copy_text';

export type ShownSignInLink = { person_name: string; token: string; lasts: string };

/**
 * The one time a sign-in link is on screen. Only its hash is stored, so it cannot be shown
 * again. Copy works on plain http too: see `copy_text`.
 */
export function TeamModeLinkBox({
  link,
  open_at,
  on_done,
}: {
  link: ShownSignInLink;
  open_at: TeamAddress;
  on_done: () => void;
}) {
  const [copied, set_copied] = useState(false);
  const address = sign_in_link_address(open_at, link.token);

  const copy_link = async () => {
    await copy_text(address);
    set_copied(true);
  };

  return (
    <div className="flex flex-col gap-3 rounded-2xl border bg-sunken p-3">
      <p className="text-sm">
        <span className="font-medium">Sign-in link for {link.person_name}.</span> Send it to them
        yourself. It works once, for {link.lasts}, and it is not shown again.
        {link.lasts === '1 hour' ? ' Using it ends their other sessions.' : ''}
      </p>
      <div className="flex gap-2">
        <Input
          readOnly
          aria-label={`Sign-in link for ${link.person_name}`}
          className="font-mono text-xs"
          value={address}
          onFocus={(event) => event.target.select()}
        />
        <Button type="button" size="sm" variant="outline" onClick={() => void copy_link()}>
          {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
          {copied ? 'Copied' : 'Copy'}
        </Button>
        <Button type="button" size="sm" onClick={on_done}>
          Done
        </Button>
      </div>
    </div>
  );
}
