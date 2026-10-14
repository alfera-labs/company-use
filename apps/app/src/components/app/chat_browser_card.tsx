import { Button } from '@coworker/ui/components/button';
import {
  ArrowUpRight,
  Check,
  Circle,
  Globe,
  Loader2,
  Square,
  TriangleAlert,
  WifiOff,
} from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import {
  type BrowserLiveStream,
  useBrowserLiveStream,
} from '@/components/app/browser_live_view/use_browser_live_stream';
import { BrowserCardPreview } from '@/components/app/chat_browser_card_preview';
import { is_chat_run_active } from '@/components/app/chat_session_state';
import { useChatUiStore } from '@/components/app/chat_ui_store';
import type { Run, SandboxUrlPreview } from '@/lib/api';

const status_styles = {
  Starting: { icon: Loader2, class_name: 'bg-muted text-muted-foreground' },
  Working: { icon: Loader2, class_name: 'bg-amber-500/10 text-amber-700 dark:text-amber-300' },
  Done: { icon: Check, class_name: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' },
  Stopped: { icon: Square, class_name: 'bg-muted text-muted-foreground' },
  Waiting: { icon: Circle, class_name: 'bg-amber-500/10 text-amber-700 dark:text-amber-300' },
  Blocked: {
    icon: TriangleAlert,
    class_name: 'bg-amber-500/10 text-amber-700 dark:text-amber-300',
  },
  'Timed out': { icon: TriangleAlert, class_name: 'bg-destructive/10 text-destructive' },
  Failed: { icon: TriangleAlert, class_name: 'bg-destructive/10 text-destructive' },
  Disconnected: { icon: WifiOff, class_name: 'bg-muted text-muted-foreground' },
  Ready: { icon: Circle, class_name: 'bg-muted text-muted-foreground' },
};

type BrowserCardStatus = keyof typeof status_styles;

export function ChatBrowserCard({
  preview,
  run_status,
}: {
  preview: SandboxUrlPreview;
  run_status?: Run['run_status'];
}) {
  const stream = useBrowserLiveStream(preview);
  return <ChatBrowserCardView stream={stream} {...(run_status ? { run_status } : {})} />;
}

export function ChatBrowserCardView({
  stream,
  run_status,
}: {
  stream: BrowserLiveStream;
  run_status?: Run['run_status'];
}) {
  const reduce_motion = useReducedMotion();
  const set_files_panel_mode = useChatUiStore((state) => state.set_files_panel_mode);
  const set_files_panel_open = useChatUiStore((state) => state.set_files_panel_open);
  const status = browser_card_status(stream, run_status);
  const hostname = URL.canParse(stream.url) ? new URL(stream.url).hostname : '';
  const caption = browser_card_caption(stream, status);
  const transition = { duration: reduce_motion ? 0 : 0.25, ease: [0.22, 1, 0.36, 1] as const };

  return (
    <motion.section
      aria-label="Browser preview"
      initial={reduce_motion ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={transition}
      className="w-full max-w-[500px] rounded-2xl border border-border/60 bg-raised p-3 shadow-sm sm:p-4"
    >
      <BrowserCardHeader
        status={status}
        caption={caption}
        hostname={hostname}
        reduce_motion={!!reduce_motion}
      />
      <BrowserCardPreview
        stream={stream}
        status={status}
        hostname={hostname}
        reduce_motion={!!reduce_motion}
      />
      <Button
        className="mt-3 h-10 w-full gap-2 rounded-xl border border-border/50 bg-background/80 transition-colors duration-200 motion-reduce:transition-none"
        onClick={() => {
          set_files_panel_mode('browser');
          set_files_panel_open(true);
        }}
        variant="secondary"
      >
        Open browser <ArrowUpRight aria-hidden="true" className="size-3.5 text-muted-foreground" />
      </Button>
    </motion.section>
  );
}

function BrowserCardHeader({
  status,
  caption,
  hostname,
  reduce_motion,
}: {
  status: BrowserCardStatus;
  caption: string;
  hostname: string;
  reduce_motion: boolean;
}) {
  const style = status_styles[status];
  const StatusIcon = style.icon;
  return (
    <div className="mb-3 flex min-w-0 items-start gap-3">
      <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-sky-500/10 text-sky-700 dark:text-sky-300">
        <Globe aria-hidden="true" className="size-5" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex min-h-5 items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-foreground">Browser</h3>
          <motion.span
            key={status}
            initial={reduce_motion ? false : { opacity: 0.5, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: reduce_motion ? 0 : 0.2 }}
            role="status"
            className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium ${style.class_name}`}
          >
            <StatusIcon aria-hidden="true" className="size-3" />
            {status}
          </motion.span>
        </div>
        <div className="relative mt-1 h-5 overflow-hidden" aria-live="polite" aria-atomic="true">
          <motion.p
            key={caption}
            initial={{ opacity: 0, y: reduce_motion ? 0 : 5 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: reduce_motion ? 0 : -3 }}
            transition={{ duration: reduce_motion ? 0 : 0.2 }}
            className="truncate text-sm text-foreground/90"
            title={caption}
          >
            {caption}
          </motion.p>
        </div>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">
          {status}
          {hostname ? ` · ${hostname}` : ''}
        </p>
      </div>
    </div>
  );
}

function browser_card_status(
  stream: BrowserLiveStream,
  run_status: Run['run_status'] | undefined,
): BrowserCardStatus {
  if (run_status === 'completed') return 'Done';
  if (run_status === 'cancelled') return 'Stopped';
  if (run_status === 'failed') return 'Failed';
  if (run_status === 'blocked') return 'Blocked';
  if (run_status === 'timed_out') return 'Timed out';
  if (stream.status === 'closed') return 'Disconnected';
  if (!stream.first_frame_ready) return 'Starting';
  if (run_status === 'waiting') return 'Waiting';
  if (is_chat_run_active(run_status)) return 'Working';
  return 'Ready';
}

function browser_card_caption(stream: BrowserLiveStream, status: BrowserCardStatus) {
  if (status === 'Done') return 'Browser task complete';
  if (status === 'Stopped') return 'Browser task stopped';
  if (status === 'Failed') return 'The browser task failed';
  if (status === 'Blocked') return 'The browser task needs attention';
  if (status === 'Timed out') return 'The browser task timed out';
  if (status === 'Waiting') return 'Waiting to continue…';
  if (status === 'Disconnected') return 'Browser disconnected';
  if (stream.caption) return stream.caption;
  if (status === 'Starting') return 'Connecting to the browser…';
  if (stream.is_loading) return 'Loading page…';
  return status === 'Working' ? 'Working in the browser…' : 'Live browser';
}
