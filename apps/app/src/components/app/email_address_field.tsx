import { format_error_message } from '@coworker/shared';
import { Button } from '@coworker/ui/components/button';
import { Input } from '@coworker/ui/components/input';
import { Label } from '@coworker/ui/components/label';
import { Check, Copy, Mail, Pencil } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { copy_text } from '@/lib/copy_text';

export function EmailAddressField({
  address,
  on_rename,
  renaming,
}: {
  address: string;
  on_rename: (username: string) => void;
  renaming: boolean;
}) {
  const [editing, set_editing] = useState(false);
  const [copied, set_copied] = useState(false);
  const [username, set_username] = useState('');
  const domain = address.slice(address.indexOf('@'));

  const copy_address = async () => {
    try {
      await copy_text(address);
      set_copied(true);
      setTimeout(() => set_copied(false), 1500);
    } catch (error) {
      toast.error(format_error_message(error, 'Could not copy the address'));
    }
  };

  if (editing) {
    return (
      <form
        className="flex flex-col gap-1.5"
        onSubmit={(event) => {
          event.preventDefault();
          const next = username.trim().toLowerCase();
          if (!next || `${next}${domain}` === address) return set_editing(false);
          on_rename(next);
          set_editing(false);
        }}
      >
        <Label htmlFor="workspace-email-username">Email address</Label>
        <div className="flex items-center gap-2">
          <Input
            id="workspace-email-username"
            className="max-w-3xs font-mono"
            autoFocus
            value={username}
            placeholder={address.slice(0, address.indexOf('@'))}
            onChange={(event) => set_username(event.target.value)}
          />
          <span className="font-mono text-sm text-muted-foreground">{domain}</span>
          <Button type="submit" size="sm" disabled={renaming}>
            Save
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => set_editing(false)}>
            Cancel
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          The old address keeps receiving, so nothing already sent to it is lost.
        </p>
      </form>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      <Label>Email address</Label>
      <div className="flex items-center gap-2 rounded-xl border bg-muted/40 px-3 py-2">
        <Mail className="size-4 shrink-0 text-muted-foreground" />
        <code className="flex-1 truncate font-mono text-sm">{address}</code>
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          aria-label="Copy email address"
          onClick={() => void copy_address()}
        >
          {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
        </Button>
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          aria-label="Change email address"
          onClick={() => set_editing(true)}
        >
          <Pencil className="size-4" />
        </Button>
      </div>
    </div>
  );
}
