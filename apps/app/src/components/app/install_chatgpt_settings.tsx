import { Button } from '@coworker/ui/components/button';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';
import { useChatgptPasteBack } from '@/components/install_sign_in/use_chatgpt_paste_back';
import {
  finish_install_chatgpt_sign_in,
  install_ai_keys_query_key,
  start_install_chatgpt_sign_in,
} from '@/lib/api/install_ai_keys';
import { query_keys } from '@/lib/api/query_keys';

function PasteAddress({ busy, on_finish }: { busy: boolean; on_finish: (url: string) => void }) {
  const [callback_url, set_callback_url] = useState('');
  return (
    <form
      method="post"
      className="mt-2 flex h-12 items-center gap-2 rounded-xl bg-muted ps-3.5 pe-1 focus-within:ring-1 focus-within:ring-border"
      onSubmit={(event) => {
        event.preventDefault();
        if (callback_url.trim()) on_finish(callback_url.trim());
      }}
    >
      <input
        value={callback_url}
        spellCheck={false}
        autoComplete="off"
        placeholder="http://127.0.0.1:1455/auth/callback?code=…"
        aria-label="Address of the ChatGPT tab"
        onChange={(event) => set_callback_url(event.target.value)}
        className="min-w-0 flex-1 bg-transparent font-mono text-sm outline-none placeholder:text-muted-foreground"
      />
      <Button type="submit" size="sm" variant="outline" disabled={!callback_url.trim() || busy}>
        {busy ? 'Connecting…' : 'Finish'}
      </Button>
    </form>
  );
}

function WaitingForAddress({ sign_in }: { sign_in: ReturnType<typeof useChatgptPasteBack> }) {
  return (
    <>
      <p className="text-sm">
        Approve Alfera in the ChatGPT tab. That tab then shows a page that does not load. Copy its
        whole address and paste it here.
      </p>
      {sign_in.needs_a_new_attempt ? (
        <Button
          className="mt-2"
          size="sm"
          variant="outline"
          disabled={sign_in.busy}
          onClick={sign_in.start_new_attempt}
        >
          Start again in ChatGPT
        </Button>
      ) : (
        <PasteAddress busy={sign_in.busy} on_finish={(url) => void sign_in.finish(url)} />
      )}
      <div className="mt-2 flex gap-2">
        <Button size="sm" variant="ghost" onClick={sign_in.open_chatgpt}>
          Open the ChatGPT tab again
        </Button>
        <Button size="sm" variant="ghost" onClick={sign_in.cancel}>
          Cancel
        </Button>
      </div>
    </>
  );
}

export function InstallChatgptSettings({
  on_done,
  on_back,
}: {
  on_done: () => void;
  on_back: () => void;
}) {
  const query_client = useQueryClient();
  const sign_in = useChatgptPasteBack(
    { start: start_install_chatgpt_sign_in, finish: finish_install_chatgpt_sign_in },
    async () => {
      await query_client.invalidateQueries({ queryKey: install_ai_keys_query_key });
      await query_client.invalidateQueries({ queryKey: query_keys.models() });
      toast.success('ChatGPT plan connected');
      sign_in.cancel();
      on_done();
    },
  );
  return (
    <div className="mt-3">
      {sign_in.waiting_for_address ? (
        <WaitingForAddress sign_in={sign_in} />
      ) : (
        <div className="flex flex-col gap-2">
          <p className="text-sm">
            Alfera opens ChatGPT in a new tab. Sign in there and approve Alfera. Your plan pays for
            what Alfera uses.
          </p>
          <div className="flex gap-2">
            <Button size="sm" disabled={sign_in.busy} onClick={sign_in.open_chatgpt}>
              {sign_in.busy ? 'Opening ChatGPT…' : 'Open ChatGPT'}
            </Button>
            <Button size="sm" variant="ghost" onClick={on_back}>
              Back
            </Button>
          </div>
        </div>
      )}
      {sign_in.error ? (
        <p role="alert" className="mt-2 text-destructive text-xs">
          {sign_in.error}
        </p>
      ) : null}
    </div>
  );
}
