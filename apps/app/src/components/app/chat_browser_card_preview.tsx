import { Globe, LockKeyhole, MousePointer2 } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import type { BrowserLiveStream } from '@/components/app/browser_live_view/use_browser_live_stream';

export function BrowserCardPreview({
  stream,
  status,
  hostname,
  reduce_motion,
}: {
  stream: BrowserLiveStream;
  status: string;
  hostname: string;
  reduce_motion: boolean;
}) {
  const show_cursor =
    stream.first_frame_ready &&
    stream.status === 'live' &&
    stream.cursor &&
    (status === 'Working' || status === 'Ready');
  const AddressIcon = stream.url.startsWith('https://') ? LockKeyhole : Globe;
  const device_ratio = stream.device_size.width / stream.device_size.height;
  const width = Math.min(1, device_ratio / (16 / 9));
  const height = Math.min(1, 16 / 9 / device_ratio);
  const cursor_x = stream.cursor
    ? ((1 - width) / 2 + (stream.cursor.x / stream.device_size.width) * width) * 100
    : 0;
  const cursor_y = stream.cursor
    ? ((1 - height) / 2 + (stream.cursor.y / stream.device_size.height) * height) * 100
    : 0;

  return (
    <div className="grid aspect-[16/10] place-items-center overflow-hidden rounded-xl border border-border/40 bg-gradient-to-br from-sky-100/80 via-slate-100 to-amber-100/70 p-4 dark:from-sky-950/50 dark:via-slate-900 dark:to-amber-950/30 sm:p-5">
      <motion.div
        className="w-full overflow-hidden rounded-2xl border border-border/60 bg-background shadow-md"
        initial={reduce_motion ? false : { opacity: 0, y: 5, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: reduce_motion ? 0 : 0.3, ease: [0.22, 1, 0.36, 1] }}
      >
        <div className="relative flex h-7 items-center justify-center border-b border-border/50 bg-muted/40 px-9">
          <div aria-hidden="true" className="absolute left-2.5 flex gap-1">
            <span className="size-1 rounded-full bg-foreground/15" />
            <span className="size-1 rounded-full bg-foreground/15" />
            <span className="size-1 rounded-full bg-foreground/15" />
          </div>
          <span className="flex max-w-full items-center gap-1 rounded bg-background/80 px-2 py-0.5 text-[9px] text-muted-foreground">
            <AddressIcon aria-hidden="true" className="size-2" />
            <span className="truncate">{hostname || 'Browser'}</span>
          </span>
        </div>
        <div className="relative aspect-video overflow-hidden bg-background">
          <canvas
            aria-label="Live browser page preview"
            className="block h-full w-full object-contain transition-opacity duration-300 motion-reduce:transition-none"
            style={{ opacity: stream.first_frame_ready ? 1 : 0 }}
            ref={stream.bind_canvas}
            role="img"
          />
          <AnimatePresence initial={false}>
            {!stream.first_frame_ready ? (
              <motion.div
                key="loading"
                initial={false}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: reduce_motion ? 0 : 0.2 }}
                className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-background px-4 text-center text-xs text-muted-foreground"
              >
                <div aria-hidden="true" className="flex w-2/3 flex-col gap-2">
                  <span className="h-2 w-3/4 rounded bg-muted" />
                  <span className="h-2 w-full rounded bg-muted" />
                  <span className="h-2 w-1/2 rounded bg-muted" />
                </div>
                {stream.status === 'closed' ? 'Open the browser to reconnect.' : null}
              </motion.div>
            ) : null}
          </AnimatePresence>
          {show_cursor ? (
            <motion.div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0"
              animate={{ x: `${cursor_x}%`, y: `${cursor_y}%` }}
              initial={false}
              transition={{ duration: reduce_motion ? 0 : 0.16, ease: [0.22, 1, 0.36, 1] }}
            >
              <motion.div
                className="relative w-fit"
                animate={{ scale: stream.cursor?.pressed ? 0.85 : 1 }}
                transition={{ duration: reduce_motion ? 0 : 0.12 }}
              >
                <MousePointer2
                  className="size-5 fill-sky-600 text-white drop-shadow-sm"
                  strokeWidth={1.5}
                />
                <AnimatePresence>
                  {stream.cursor?.pressed && !reduce_motion ? (
                    <motion.span
                      key="click"
                      className="absolute -left-2 -top-2 size-6 rounded-full border-2 border-sky-500/70"
                      initial={{ opacity: 0.8, scale: 0.4 }}
                      animate={{ opacity: 0, scale: 1.4 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.3 }}
                    />
                  ) : null}
                </AnimatePresence>
              </motion.div>
            </motion.div>
          ) : null}
          {stream.first_frame_ready && stream.status === 'closed' ? (
            <div className="absolute inset-x-2 bottom-2 rounded-xl border border-border/50 bg-background/95 px-2 py-1 text-center text-[10px] text-muted-foreground">
              Preview disconnected · Open browser to reconnect
            </div>
          ) : null}
        </div>
      </motion.div>
    </div>
  );
}
