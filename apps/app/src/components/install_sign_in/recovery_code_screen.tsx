import { Check, Copy, Download } from 'lucide-react';
import { useState } from 'react';
import { AuthQuestion } from '@/components/auth/auth_panel';
import { InstallButton } from '@/components/install_sign_in/install_form_parts';
import { copy_text } from '@/lib/copy_text';

const secondary_button_classes =
  'flex h-11 flex-1 cursor-pointer items-center justify-center gap-2 rounded-full border border-[#e2ded9] bg-white text-[15px] font-medium transition-[border-color,transform] duration-150 hover:border-[#d6d0c9] active:scale-[0.96]';

function download_recovery_code(recovery_code: string) {
  const text = `Alfera recovery code for ${window.location.host}\n\n${recovery_code}\n\nOn the sign-in page, choose "Forgot your password?" and type this code.\n`;
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
  link.download = 'alfera-recovery-code.txt';
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(link.href), 60_000);
}

function CodeActions({ recovery_code }: { recovery_code: string }) {
  const [copied, set_copied] = useState<boolean | null>(null);
  async function copy() {
    const wrote = await copy_text(recovery_code).then(
      () => true,
      () => false,
    );
    set_copied(wrote);
  }
  return (
    <div className="mt-3 flex flex-wrap gap-3">
      <button type="button" className={secondary_button_classes} onClick={() => void copy()}>
        {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
        {copied ? 'Copied' : 'Copy'}
      </button>
      <button
        type="button"
        className={secondary_button_classes}
        onClick={() => download_recovery_code(recovery_code)}
      >
        <Download className="size-4" />
        Download
      </button>
      {copied === false ? (
        <p role="alert" className="mt-2 basis-full text-center text-[13.5px] text-[#d03500]">
          Copy did not work. Select the code and copy it.
        </p>
      ) : null}
    </div>
  );
}

export function RecoveryCodeScreen({
  title,
  subtitle,
  recovery_code,
  on_done,
}: {
  title: string;
  subtitle: string;
  recovery_code: string;
  on_done: () => void;
}) {
  const [saved, set_saved] = useState(false);
  return (
    <AuthQuestion title={title} subtitle={subtitle}>
      <output
        aria-label="Your recovery code"
        className="block select-all rounded-3xl border border-[#e2ded9] bg-white px-6 py-5 text-center font-mono text-[19px] tracking-[0.06em] break-all"
      >
        {recovery_code}
      </output>
      <CodeActions recovery_code={recovery_code} />
      <label className="mt-6 flex cursor-pointer items-center gap-3 px-1 text-[15px]">
        <input
          type="checkbox"
          className="size-5 accent-[#131110]"
          checked={saved}
          onChange={(event) => set_saved(event.target.checked)}
        />
        I saved my recovery code
      </label>
      <InstallButton busy={false} busy_label="" disabled={!saved} on_click={on_done}>
        Open Alfera
      </InstallButton>
    </AuthQuestion>
  );
}
