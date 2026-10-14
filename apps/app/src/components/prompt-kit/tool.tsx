import { cn } from '@coworker/ui/lib/utils';
import { type LucideIcon, Wrench } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useState } from 'react';
import type { ActivityGlyphTone } from '@/components/app/chat_activity_row';
import {
  ActivityChevron,
  ActivityDetail,
  ActivityGlyph,
  activity_detail_card_class_name,
  activity_row_class_name,
  activity_row_hover_scope_class_name,
} from '@/components/app/chat_activity_row';
import { read_tool_result_items } from '@/components/app/tool_result_items';
import { has_detail_value, ToolDetailBody } from '@/components/prompt-kit/tool_detail_content';
import { read_tool_detail_output } from '@/components/prompt-kit/tool_detail_payload';
import {
  type ToolRowStatus,
  tool_row_status,
  tool_row_status_words,
} from '@/components/prompt-kit/tool_row_status';

export type ToolProps = {
  display?: {
    iconUrl?: string;
    title?: string;
    subtitle?: string;
  };
  systemIcon?: LucideIcon;
  errorText?: string;
  forceExpanded?: boolean;
  input?: unknown;
  output?: unknown;
  approvalAction?: React.ReactNode;
  liveOutputLine?: string;
  onStage?: boolean;
  rowLabel?: React.ReactNode;
  state: string;
  toolName: string;
};

export function Tool({
  approvalAction,
  display,
  systemIcon,
  errorText,
  forceExpanded = false,
  input,
  liveOutputLine,
  onStage = false,
  output,
  rowLabel,
  state,
  toolName,
}: ToolProps) {
  const [is_expanded, set_is_expanded] = useState(false);
  const show_details = forceExpanded || is_expanded;
  const title = rowLabel ?? display?.title ?? format_tool_name(toolName);
  const subtitle = display?.subtitle;
  const has_input = has_detail_value(input);
  const has_output = has_detail_value(output);
  const has_details = has_input || has_output || Boolean(errorText);
  const status = tool_row_status(state, errorText);
  const reduce_motion = useReducedMotion();
  const result_count = read_tool_result_items(read_tool_detail_output(output)).length;

  return (
    <div className="min-w-0">
      <button
        className={cn(
          activity_row_hover_scope_class_name,
          activity_row_class_name,
          'w-fit max-w-full',
          onStage && status !== 'failed' && 'text-foreground',
          status === 'failed' && 'text-destructive',
          status === 'awaiting_approval' && 'text-foreground',
          has_details ? 'cursor-pointer' : 'cursor-default',
        )}
        disabled={!has_details}
        type="button"
        onClick={() => set_is_expanded(!is_expanded)}
      >
        <ActivityChevron expandable={has_details} open={show_details} />
        <ToolMark display={display} status={status} systemIcon={systemIcon} />
        <span className="min-w-0">
          <span>{title}</span>
          {subtitle ? <ActivityDetail>{subtitle}</ActivityDetail> : null}
          {status === 'failed' ? (
            <ActivityDetail tone="failed">
              {clamp_row_error_text(errorText) ?? 'failed'}
            </ActivityDetail>
          ) : null}
          {status === 'done' && result_count > 0 ? (
            <ActivityDetail>
              {result_count} {result_count === 1 ? 'result' : 'results'}
            </ActivityDetail>
          ) : null}
          {tool_row_status_words[status] ? (
            <ActivityDetail>{tool_row_status_words[status]}</ActivityDetail>
          ) : null}
        </span>
      </button>

      {onStage ? <ToolLiveOutputLine text={liveOutputLine} /> : null}
      {status === 'awaiting_approval' ? approvalAction : null}

      <AnimatePresence initial={false}>
        {show_details && has_details ? (
          <motion.div
            animate={{ height: 'auto', opacity: 1 }}
            className="overflow-hidden"
            exit={{ height: 0, opacity: 0 }}
            initial={{ height: 0, opacity: 0 }}
            key="detail"
            transition={reduce_motion ? { duration: 0 } : detail_card_transition}
          >
            <div className={cn(activity_detail_card_class_name, 'group/tool-detail')}>
              <ToolDetailBody
                toolName={toolName}
                {...(display?.iconUrl ? { iconUrl: display.iconUrl } : {})}
                {...(errorText ? { errorText } : {})}
                {...(has_input ? { input } : {})}
                {...(has_output ? { output } : {})}
              />
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

const detail_card_transition = { duration: 0.38, ease: [0.22, 1, 0.36, 1] as const };

function ToolLiveOutputLine({ text }: { text: string | undefined }) {
  const reduce_motion = useReducedMotion();

  return (
    <div className="mt-[3px] ml-[25px] h-[18px] overflow-hidden">
      {text ? (
        <motion.div
          animate={{ opacity: 1, y: 0 }}
          className="truncate font-mono text-[12px] leading-[18px] text-muted-foreground"
          initial={reduce_motion ? false : { opacity: 0, y: 2 }}
          key={text}
          transition={reduce_motion ? { duration: 0 } : { duration: 0.26 }}
        >
          {text}
        </motion.div>
      ) : null}
    </div>
  );
}

function ToolMark({
  display,
  status,
  systemIcon,
}: {
  display: ToolProps['display'];
  status: ToolRowStatus;
  systemIcon: LucideIcon | undefined;
}) {
  const tone = glyph_tone(status);
  const letter = display?.subtitle ?? display?.title;
  const breathing = status === 'running';

  if (display?.iconUrl)
    return <ActivityGlyph breathing={breathing} iconUrl={display.iconUrl} tone={tone} />;
  if (systemIcon) return <ActivityGlyph breathing={breathing} icon={systemIcon} tone={tone} />;
  if (letter) return <ActivityGlyph breathing={breathing} letter={letter} tone={tone} />;
  return <ActivityGlyph breathing={breathing} icon={Wrench} tone={tone} />;
}

function glyph_tone(status: ToolRowStatus): ActivityGlyphTone {
  if (status === 'failed') return 'failed';
  if (status === 'running') return 'running';
  return 'default';
}

const row_error_max_length = 90;

function clamp_row_error_text(error_text: string | undefined) {
  if (!error_text) return undefined;
  const first_line = error_text.split(/\r?\n/u)[0]?.trim() ?? '';
  if (first_line.length <= row_error_max_length) return first_line;
  return `${first_line.slice(0, row_error_max_length).trimEnd()}…`;
}

const fallback_action_words: [RegExp, string][] = [
  [/search|grep|glob|find/u, 'Searched'],
  [/read|open|view/u, 'Read a file'],
];

function format_tool_name(value: string) {
  const normalized = value.toLowerCase();
  const match = fallback_action_words.find(([pattern]) => pattern.test(normalized));
  return match ? match[1] : 'Ran an action';
}
