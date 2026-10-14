import { public_brand_config } from '@coworker/config/public_env';
import {
  find_tool_call_subjects,
  present_choices_node_key,
  read_present_choices,
} from '@coworker/shared';
import { Button } from '@coworker/ui/components/button';
import { BookOpen, ChevronDown, Clock, RotateCcw, Sparkles, Wrench } from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import { Fragment, memo, useState } from 'react';
import '@/components/app/chat_activity_breathe.css';
import { cn } from '@coworker/ui/lib/utils';
import {
  ActivityChevron,
  ActivityDetail,
  ActivityGlyph,
  ActivityRail,
  activity_children_class_name,
  activity_row_class_name,
} from '@/components/app/chat_activity_row';
import {
  ApprovalTraceRow,
  ChatApprovalDock,
  latest_approval_requests,
} from '@/components/app/chat_approval_dock';
import { ChatArtifactCard } from '@/components/app/chat_artifact_card';
import { ChatAssistantText, useReplyStillDue } from '@/components/app/chat_assistant_text';
import {
  ChatCascadeProvider,
  next_cascade_delay,
  useChatCascade,
} from '@/components/app/chat_cascade';
import {
  ChatChoiceDock,
  ChoiceAnsweredRow,
  ChoiceTraceRow,
} from '@/components/app/chat_choice_dock';
import { choice_trace_words, read_choice_answer } from '@/components/app/chat_choice_trace_words';
import {
  ChatConnectionDock,
  type ConnectedAppTimes,
  ConnectionTraceRow,
  connection_request_time_ms,
  is_connected_app,
  read_connection_setup_tool_output,
} from '@/components/app/chat_connection_dock';
import { assistant_text_for_display } from '@/components/app/chat_connection_setup_text';
import { ChatEarlierMessagesLoader } from '@/components/app/chat_earlier_messages_loader';
import {
  chat_assistant_bubble_class_name,
  chat_reasoning_class_name,
  chat_reasoning_streamdown_class_name,
  chat_user_message_class_name,
  chat_work_pill_class_name,
  TypedMessageText,
} from '@/components/app/chat_message';
import { is_same_chat_message } from '@/components/app/chat_message_equality';
import {
  type ChatMessageFile,
  ChatMessageFiles,
  type ChatMessageImage,
  ChatMessageImages,
} from '@/components/app/chat_message_files';
import {
  AssistantAttribution,
  DaySeparator,
  MessageClockTime,
  message_day_labels,
  StoppedAnswerMark,
} from '@/components/app/chat_message_marks';
import { mid_run_note_parts } from '@/components/app/chat_mid_run_notes';
import { useChatRunRecord } from '@/components/app/chat_run_records';
import { ChatScrollToOwnMessage } from '@/components/app/chat_scroll_to_own_message';
import { StoppedRunLine } from '@/components/app/chat_stopped_run_line';
import {
  chat_tool_part_key,
  is_chat_tool_part,
  type ProjectedChatMessage,
  type ProjectedChatMessagePart,
  type ProjectedChatToolPart,
} from '@/components/app/chat_stream_projection';
import { SystemInstructionMessage } from '@/components/app/chat_system_instruction_message';
import { type ReasoningPart, ThoughtRunToggle } from '@/components/app/chat_thought_run_toggle';
import { ChatWorkingDots } from '@/components/app/chat_working_dots';
import { EditionRunCostLine } from '@/components/app/edition_run_cost_line';
import { InternalToolPanel } from '@/components/app/internal_tool_panel';
import { lookup_internal_tool_definition } from '@/components/app/internal_tool_registry';
import {
  type InternalToolCall,
  type InternalToolDefinition,
  type InternalToolFamily,
  read_internal_tool_call_state,
  read_internal_tool_error,
  read_internal_tool_view,
} from '@/components/app/internal_tool_view';
import { is_lookup_tool_name, LookupToolPartRow } from '@/components/app/lookup_tool_part_row';
import {
  last_memory_summary,
  MemorySourcesPanel,
  read_turn_memory_sources,
} from '@/components/app/memory_tool_rows';
import {
  describe_folded_work,
  describe_live_work,
  folded_internal_parts,
  split_settled_run,
} from '@/components/app/settled_run_fold';
import { say_action_in_tense, type ToolActionTense } from '@/components/app/tool_action_words';
import {
  has_command_ended_with_exit_code,
  has_tool_call_ended,
  is_failed_tool_call,
  tool_row_outcome,
} from '@/components/app/tool_call_outcome';
import {
  is_runtime_pseudo_app,
  tool_part_display,
  tool_part_place_name,
} from '@/components/app/tool_part_app_display';
import { useLivingFold } from '@/components/app/use_living_fold';
import { WebSearchTool } from '@/components/app/web_search_tool';
import { is_running_state, read_web_search_group } from '@/components/app/web_search_tool_model';
import {
  ChatContainerContent,
  ChatContainerRoot,
  ChatContainerScrollAnchor,
} from '@/components/prompt-kit/chat-container';
import {
  Message,
  MessageAction,
  MessageActions,
  MessageContent,
} from '@/components/prompt-kit/message';
import { ScrollButton } from '@/components/prompt-kit/scroll-button';
import { Tool } from '@/components/prompt-kit/tool';
import { read_tool_detail_input } from '@/components/prompt-kit/tool_detail_payload';
import type { CatalogApp } from '@/lib/api';
import { resolve_system_tool_icon, resolve_system_tool_label } from '@/lib/system_tool_icon';
import { useStableCallback } from '@/lib/use_stable_callback';

const tool_name_version_suffix_re = /-\d+$/u;
const line_break_re = /\r?\n/u;
const web_search_node_key = 'runtime-web_search-1';

function is_web_search_part(part: ProjectedChatMessagePart): part is ProjectedChatToolPart {
  return is_chat_tool_part(part) && part.toolName === web_search_node_key;
}

function read_internal_tool_family(part: ProjectedChatToolPart) {
  if (read_part_connection_setup(part)) return null;
  return lookup_internal_tool_definition(part.toolName)?.family ?? null;
}

function read_part_connection_setup(part: ProjectedChatToolPart) {
  const structured = read_connection_setup_tool_output(part.output);
  if (structured || !part.outputText?.includes('connection_setup')) return structured;
  try {
    return read_connection_setup_tool_output(JSON.parse(part.outputText) as unknown);
  } catch {
    return null;
  }
}

type InternalToolGroup = {
  calls: InternalToolCall[];
  first_part?: ProjectedChatToolPart;
  has_running: boolean;
};

type InternalToolStretch = {
  family: InternalToolFamily;
  group: InternalToolGroup;
  parts: ProjectedChatToolPart[];
};

function read_internal_tool_groups(parts: ProjectedChatMessagePart[], is_run_active: boolean) {
  const group_by_part = new Map<ProjectedChatMessagePart, Required<InternalToolGroup>>();
  let stretch: InternalToolStretch | undefined;
  const close_stretch = () => {
    const first_part = stretch?.group.first_part;
    if (stretch && first_part) {
      const group = { ...stretch.group, first_part };
      for (const part of stretch.parts) group_by_part.set(part, group);
    }
    stretch = undefined;
  };

  for (const part of parts) {
    if (is_blank_text_part(part)) continue;
    const tool_part = is_chat_tool_part(part) ? part : undefined;
    const definition =
      tool_part && !read_part_connection_setup(tool_part)
        ? lookup_internal_tool_definition(tool_part.toolName)
        : null;
    if (stretch?.family !== definition?.family) close_stretch();
    if (!tool_part || !definition) continue;
    stretch ??= { family: definition.family, group: { calls: [], has_running: false }, parts: [] };
    add_call_to_stretch(stretch, read_internal_tool_call(tool_part, definition, is_run_active));
    stretch.parts.push(tool_part);
    if (
      !stretch.group.first_part &&
      tool_row_state(tool_part, is_run_active) !== 'awaiting_approval'
    ) {
      stretch.group.first_part = tool_part;
    }
  }
  close_stretch();
  return group_by_part;
}

function read_internal_tool_call(
  part: ProjectedChatToolPart,
  definition: InternalToolDefinition,
  is_run_active: boolean,
): InternalToolCall {
  const error_text = part.errorText ?? read_internal_tool_error(part.output, part.outputText);
  return {
    call_id: part.canonicalId ?? part.toolCallId,
    definition,
    state: tool_row_state(part, is_run_active),
    ...(part.input === undefined ? {} : { input: read_tool_detail_input(part.input) }),
    ...(part.output === undefined ? {} : { output: part.output }),
    ...(part.outputText === undefined ? {} : { output_text: part.outputText }),
    ...(error_text ? { error_text } : {}),
  };
}

function add_call_to_stretch(stretch: InternalToolStretch, call: InternalToolCall) {
  stretch.group.calls.push(call);
  if (read_internal_tool_call_state(call, read_internal_tool_view(call)) === 'running') {
    stretch.group.has_running = true;
  }
}

function is_blank_text_part(part: ProjectedChatMessagePart) {
  return (part.type === 'text' || part.type === 'reasoning') && !part.text.trim();
}

const transcript_scrollbar_style = {
  scrollbarGutter: 'stable both-edges',
  scrollbarWidth: 'none',
} as const;

export function ChatConversation({
  activeRunId,
  apps = [],
  assistantName = public_brand_config.product_brand_name,
  centerFooter = true,
  connectedApps,
  footer,
  hasEarlierMessages = false,
  isChoiceAnswerable = false,
  isLoadingEarlierMessages = false,
  isSubmitting,
  messages,
  onArtifactOpen,
  onChoiceAnswer,
  onLoadEarlierMessages,
  onReload,
  ownNewMessageId,
  queuedMessages,
  showFullTraces = false,
  startingMessages,
}: {
  activeRunId?: string;
  apps?: CatalogApp[];
  centerFooter?: boolean;
  assistantName?: string;
  footer?: React.ReactNode;
  connectedApps?: ConnectedAppTimes | undefined;
  hasEarlierMessages?: boolean;
  isChoiceAnswerable?: boolean;
  isLoadingEarlierMessages?: boolean;
  isSubmitting: boolean;
  messages: ProjectedChatMessage[];
  onArtifactOpen?: (file_id: string) => void;
  onChoiceAnswer?: (message_text: string) => Promise<boolean>;
  onLoadEarlierMessages?: () => void;
  onReload?: () => void;
  ownNewMessageId?: string | undefined;
  queuedMessages?: React.ReactNode;
  showFullTraces?: boolean;
  startingMessages?: React.ReactNode;
}) {
  const last_assistant_message_id = find_last_assistant_message_id(messages);
  const running_tool = running_tool_part(active_run_parts(messages, activeRunId));
  const running_tool_key = running_tool ? chat_tool_part_key(running_tool) : undefined;
  const last_message = messages.at(-1);
  const footer_can_pull_up =
    last_message !== undefined &&
    last_message.id === last_assistant_message_id &&
    !is_active_run_message(last_message, activeRunId);
  const reload_last_answer = useStableCallback(() => onReload?.());
  const reload = onReload && !isSubmitting ? reload_last_answer : undefined;
  const message_keys = chat_message_keys(messages);
  const day_labels = message_day_labels(messages);

  return (
    <ChatCascadeProvider transcript_id={messages[0]?.id ?? ''}>
      <div className="relative flex h-full min-h-0 w-full flex-1 flex-col items-center overflow-hidden">
        <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-8 bg-gradient-to-b from-background to-transparent" />
        {/* The loader anchors the scroll position itself, so the browser must not also do it.
            Chrome and Firefox anchor by default, Safari never does; off means one path for all
            three. */}
        <ChatContainerRoot className="relative h-full min-h-0 w-full flex-1 [&>div]:[overflow-anchor:none]">
          <ChatContainerContent
            className={cn(
              'flex w-full flex-col items-center pb-3',
              footer && centerFooter
                ? 'my-auto pt-10 [&>div.group]:!flex-none'
                : 'mt-auto pt-28 lg:pt-16',
            )}
            style={transcript_scrollbar_style}
          >
            {onLoadEarlierMessages ? (
              <ChatEarlierMessagesLoader
                firstMessageKey={message_keys[0] ?? ''}
                hasEarlier={hasEarlierMessages}
                isLoading={isLoadingEarlierMessages}
                onLoad={onLoadEarlierMessages}
              />
            ) : null}
            {messages.map((message, index) => (
              <Fragment key={message_keys[index]}>
                {day_labels[index] ? <DaySeparator label={day_labels[index]} /> : null}
                <ProjectedMessage
                  apps={apps}
                  assistantName={assistantName}
                  isLastAssistant={message.id === last_assistant_message_id}
                  isRunActive={is_active_run_message(message, activeRunId)}
                  message={message}
                  showFullTraces={showFullTraces}
                  showAttribution={messages[index - 1]?.role !== 'assistant'}
                  {...(connectedApps ? { connectedApps } : {})}
                  {...(running_tool_key ? { runningToolKey: running_tool_key } : {})}
                  {...(onArtifactOpen ? { onArtifactOpen } : {})}
                  {...(reload && message.id === last_assistant_message_id
                    ? { onReload: reload }
                    : {})}
                />
                <StoppedRunLine message={message} next={messages[index + 1]} onRunAgain={reload} />
              </Fragment>
            ))}
            {startingMessages}
            {footer ? (
              <div className={cn('w-full max-w-3xl px-6 pb-4', footer_can_pull_up && '-mt-10')}>
                {footer}
              </div>
            ) : null}
            <div className="w-full max-w-3xl px-6">
              <ChatWorkDock
                isSubmitting={isSubmitting}
                messages={messages}
                {...(activeRunId ? { activeRunId } : {})}
              />
            </div>
            {queuedMessages ? <div className="w-full max-w-3xl px-6">{queuedMessages}</div> : null}
            {messages.length === 0 && !isSubmitting ? <EmptyConversation /> : null}
            <ChatContainerScrollAnchor />
            <ChatScrollToOwnMessage message_id={ownNewMessageId} />
            <div className="absolute bottom-0 flex w-full max-w-3xl flex-1 items-end justify-end gap-4 px-6 pb-2">
              <ScrollButton className="absolute top-[-50px] right-[30px]" />
            </div>
          </ChatContainerContent>
        </ChatContainerRoot>
        <ChatDocks
          apps={apps}
          connectedApps={connectedApps}
          isChoiceAnswerable={isChoiceAnswerable}
          messages={messages}
          onChoiceAnswer={onChoiceAnswer}
        />
      </div>
    </ChatCascadeProvider>
  );
}

function ChatDocks({
  apps,
  connectedApps,
  isChoiceAnswerable,
  messages,
  onChoiceAnswer,
}: {
  apps: CatalogApp[];
  connectedApps: ConnectedAppTimes | undefined;
  isChoiceAnswerable: boolean;
  messages: ProjectedChatMessage[];
  onChoiceAnswer: ((message_text: string) => Promise<boolean>) | undefined;
}) {
  const choice_ask = pending_choice_ask(messages);
  return (
    <div className="flex w-full max-w-3xl shrink-0 flex-col px-6">
      <ChatConnectionDock
        apps={apps}
        messages={messages}
        {...(connectedApps ? { connectedApps } : {})}
      />
      <ChatApprovalDock apps={apps} messages={messages} />
      {choice_ask && onChoiceAnswer && latest_approval_requests(messages, apps).length === 0 ? (
        <ChatChoiceDock
          choiceKey={choice_ask.key}
          choices={choice_ask.choices}
          isAnswerable={isChoiceAnswerable}
          onAnswer={onChoiceAnswer}
        />
      ) : null}
    </div>
  );
}

function ChatWorkDock({
  activeRunId,
  isSubmitting,
  messages,
}: {
  activeRunId?: string;
  isSubmitting: boolean;
  messages: ProjectedChatMessage[];
}) {
  const parts = active_run_parts(messages, activeRunId);
  const reply_is_due = useReplyStillDue(isSubmitting, messages.at(-1)?.role);
  const is_stopping = Boolean(useChatRunRecord(activeRunId)?.cancel_requested_time);
  if (!isSubmitting && !reply_is_due) return null;
  if (pending_choice_ask(messages)) return null;
  if (is_stopping) return <ChatWorkDockLine label={{ lead: 'Stopping…' }} />;
  return <ChatWorkDockLine label={work_dock_label(parts, running_tool_parts(parts))} />;
}

function ChatWorkDockLine({ label }: { label: WorkDockLabel }) {
  return (
    <div aria-live="polite" className="flex items-center gap-2 py-2" role="status">
      <ChatWorkingDots />
      <span className="flex min-w-0 items-baseline gap-1 text-[14px]">
        <span className="text-muted-foreground">{label.lead}</span>
        {label.mono ? <DockMono>{label.mono}</DockMono> : null}
      </span>
    </div>
  );
}

function DockMono({ children }: { children: React.ReactNode }) {
  return <span className="font-mono text-[13.5px] text-muted-foreground">{children}</span>;
}

type WorkDockLabel = { lead: string; mono?: string };

function work_dock_label(
  parts: ProjectedChatMessagePart[],
  running_tools: ProjectedChatToolPart[],
): WorkDockLabel {
  const [only_running_tool] = running_tools;
  if (!only_running_tool) return { lead: is_thinking_tail(parts) ? 'Thinking…' : 'Working' };
  if (running_tools.length > 1) return parallel_work_dock_label(running_tools);
  return running_tool_label(only_running_tool);
}

function parallel_work_dock_label(running_tools: ProjectedChatToolPart[]): WorkDockLabel {
  const app_names = batch_app_names(running_tools);
  if (app_names.length === 1) return { lead: `Working in ${app_names[0]}` };
  if (app_names.length === 2) return { lead: `Working in ${app_names[0]} + ${app_names[1]}` };
  return { lead: `Running ${running_tools.length} actions` };
}

function batch_app_names(running_tools: ProjectedChatToolPart[]) {
  const app_names = new Set<string>();
  for (const part of running_tools) {
    const app_name = shared_tool_app_name([part]);
    if (!app_name) return [];
    app_names.add(app_name);
  }
  return [...app_names];
}

function running_tool_label(part: ProjectedChatToolPart): WorkDockLabel {
  const system_label = resolve_system_tool_label(part.toolName);
  if (system_label) return { lead: system_label };

  const app_name = shared_tool_app_name([part]);
  if (app_name) return { lead: `Working in ${app_name}` };
  return running_action_label(part);
}

const running_action_labels: Record<ToolAction, string> = {
  edited: 'Editing files',
  listed: 'Listing files',
  previewed: 'Starting a preview',
  ran: 'Running a command',
  read: 'Reading files',
  searched: 'Searching',
  sent: 'Sending a message',
};

function running_action_label(part: ProjectedChatToolPart): WorkDockLabel {
  const action = tool_action(part);
  const file_name = tool_part_file_name(part);
  if (file_name && (action === 'edited' || action === 'read')) {
    return { lead: file_action_verbs[action].running, mono: file_name };
  }
  if (action === 'ran' && is_command_tool_name(part.toolName)) {
    const command_line = tool_part_command_line(part);
    if (command_line) return { lead: 'Running', mono: command_line };
  }
  if (
    action === 'searched' &&
    part.display?.subtitle &&
    !is_runtime_pseudo_app(part.display.subtitle)
  ) {
    return { lead: `Searching ${part.display.subtitle}` };
  }
  return { lead: running_action_labels[action] };
}

function tool_part_file_name(part: ProjectedChatToolPart) {
  const input = part.input as
    | { path?: string; file_path?: string; file?: string }
    | null
    | undefined;
  const path = input?.path ?? input?.file_path ?? input?.file;
  return path?.split('/').filter(Boolean).at(-1);
}

type RowTense = 'attempted' | 'done' | 'running';

function tool_row_tense(part: ProjectedChatToolPart, state: string): RowTense | undefined {
  if (state === 'awaiting_approval') return 'attempted';
  if (state === 'denied') return 'attempted';
  if (has_command_ended_with_exit_code(part)) return 'done';
  if (part.errorText || state === 'failed' || state === 'error') return undefined;
  if (state === 'attempted') return 'attempted';
  if (completed_tool_states.has(state)) return 'done';
  return 'running';
}

const file_action_verbs: Record<'edited' | 'read', Record<RowTense, string>> = {
  edited: { attempted: 'Tried to write', done: 'Wrote', running: 'Writing' },
  read: { attempted: 'Tried to read', done: 'Read', running: 'Reading' },
};

const command_row_labels: Record<RowTense, string> = {
  attempted: 'Tried to run a command',
  done: 'Ran a command',
  running: 'Running a command',
};

const command_row_verbs: Record<RowTense, string> = {
  attempted: 'Tried to run',
  done: 'Ran',
  running: 'Running',
};

function tool_row_label(
  part: ProjectedChatToolPart,
  tense: RowTense,
  action_title: string | undefined,
): React.ReactNode | undefined {
  const action = tool_action(part);
  const is_running = tense === 'running';
  if (action === 'edited' || action === 'read') {
    const file_name = tool_part_file_name(part);
    if (file_name) {
      return (
        <>
          {file_action_verbs[action][tense]}{' '}
          <ToolRowPath running={is_running}>{file_name}</ToolRowPath>
        </>
      );
    }
  }
  if (is_command_tool_name(part.toolName)) {
    const command_line = tool_part_command_line(part);
    if (!command_line) return command_row_labels[tense];
    return (
      <>
        {command_row_verbs[tense]} <ToolRowPath running={is_running}>{command_line}</ToolRowPath>
      </>
    );
  }
  if (action_title) {
    return name_what_it_is_about(
      part,
      say_action_in_tense(action_title, row_tense_words[tense]),
      is_running,
    );
  }
  if (tense === 'running') return title_case(running_action_phrase(action, 1));
  return title_case(tool_action_phrase(action, 1, tense));
}

const row_tense_words: Record<RowTense, ToolActionTense> = {
  attempted: 'about_to',
  running: 'running',
  done: 'done',
};

function name_what_it_is_about(part: ProjectedChatToolPart, said: string, running: boolean) {
  const [subject] = find_tool_call_subjects(part.input);
  if (!subject) return said;
  return (
    <>
      {said} <ToolRowPath running={running}>{subject.display_name}</ToolRowPath>
    </>
  );
}

function ToolRowPath({
  children,
  running = false,
}: {
  children: React.ReactNode;
  running?: boolean;
}) {
  return (
    <span className={cn('font-mono text-[13px]', running && 'text-brand-ink')}>{children}</span>
  );
}

function is_command_tool_name(tool_name: string) {
  const normalized = tool_name.replace(tool_name_version_suffix_re, '').toLowerCase();
  return normalized.endsWith('run_command') || normalized.endsWith('exec_command');
}

function tool_part_command_line(part: ProjectedChatToolPart) {
  const command = (part.input as { command?: string } | null | undefined)?.command;
  return command?.split(line_break_re)[0]?.trim();
}

function active_run_parts(messages: ProjectedChatMessage[], active_run_id: string | undefined) {
  if (!active_run_id) return [];
  return messages.flatMap((message) => (message.run_id === active_run_id ? message.parts : []));
}

function running_tool_parts(parts: ProjectedChatMessagePart[]) {
  return parts.filter(is_unresolved_running_tool_part);
}

function running_tool_part(parts: ProjectedChatMessagePart[]) {
  return running_tool_parts(parts).at(-1);
}

function is_unresolved_running_tool_part(
  part: ProjectedChatMessagePart,
): part is ProjectedChatToolPart {
  return is_chat_tool_part(part) && is_unresolved_tool_part(part);
}

function is_thinking_tail(parts: ProjectedChatMessagePart[]) {
  const last_part = parts.at(-1);
  return last_part?.type === 'reasoning' && last_part.state === 'streaming';
}

function is_active_run_message(message: ProjectedChatMessage, active_run_id: string | undefined) {
  return Boolean(active_run_id) && message.run_id === active_run_id;
}

function pending_choice_ask(messages: ProjectedChatMessage[]) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const part = [...(messages[index]?.parts ?? [])].reverse().find(is_choice_ask_part);
    if (!part) continue;
    if (settled_tool_states.has(part.state)) return null;
    const choices = read_present_choices(part.input);
    return choices ? { key: chat_tool_part_key(part), choices } : null;
  }
  return null;
}

const settled_tool_states = new Set([
  'completed',
  'failed',
  'denied',
  'blocked',
  'cancelled',
  'timed_out',
]);

function is_choice_ask_part(part: ProjectedChatMessagePart): part is ProjectedChatToolPart {
  return is_chat_tool_part(part) && part.toolName === present_choices_node_key;
}

type ProjectedMessageProps = {
  apps: CatalogApp[];
  assistantName: string;
  connectedApps?: ConnectedAppTimes | undefined;
  isLastAssistant: boolean;
  isRunActive: boolean;
  message: ProjectedChatMessage;
  onArtifactOpen?: (file_id: string) => void;
  onReload?: () => void;
  showAttribution: boolean;
  runningToolKey?: string;
  showFullTraces: boolean;
};

const ProjectedMessage = memo(function ProjectedMessage({
  apps,
  assistantName,
  connectedApps,
  isLastAssistant,
  isRunActive,
  message,
  onArtifactOpen,
  onReload,
  runningToolKey,
  showAttribution,
  showFullTraces,
}: ProjectedMessageProps) {
  if (message.role === 'user') {
    return <UserProjectedMessage message={message} />;
  }

  return (
    <AssistantProjectedMessage
      apps={apps}
      assistantName={assistantName}
      isLast={isLastAssistant}
      isRunActive={isRunActive}
      message={message}
      showAttribution={showAttribution}
      showFullTraces={showFullTraces}
      {...(connectedApps ? { connectedApps } : {})}
      {...(runningToolKey ? { runningToolKey } : {})}
      {...(onArtifactOpen ? { onArtifactOpen } : {})}
      {...(onReload ? { onReload } : {})}
    />
  );
}, is_same_projected_message_props);

function is_same_projected_message_props(
  previous: ProjectedMessageProps,
  next: ProjectedMessageProps,
) {
  return (
    previous.isLastAssistant === next.isLastAssistant &&
    previous.isRunActive === next.isRunActive &&
    previous.apps === next.apps &&
    previous.assistantName === next.assistantName &&
    previous.connectedApps === next.connectedApps &&
    previous.onArtifactOpen === next.onArtifactOpen &&
    previous.onReload === next.onReload &&
    (previous.runningToolKey === next.runningToolKey || !next.isRunActive) &&
    previous.showFullTraces === next.showFullTraces &&
    previous.showAttribution === next.showAttribution &&
    is_same_chat_message(previous.message, next.message)
  );
}

function UserProjectedMessage({ message }: { message: ProjectedChatMessage }) {
  if (message.authored_by_system) {
    return (
      <SystemInstructionMessage message={message} part_keys={message_part_keys(message.parts)} />
    );
  }
  const part_keys = message_part_keys(message.parts);

  return (
    <Message className="group/message group flex w-full max-w-3xl flex-col items-end !gap-0.5 px-6 pt-1.5 pb-4">
      <UserMessageAttribution message={message} />
      <ChatMessageImages images={projected_message_images(message.parts, part_keys)} />
      <ChatMessageFiles files={projected_message_files(message.parts, part_keys)} />
      <div className="flex w-full items-center justify-end gap-3">
        <MessageClockTime {...(message.sent_time ? { sentTime: message.sent_time } : {})} />
        <div className="flex min-w-0 max-w-[78%] flex-col items-end gap-0.5">
          {message.parts.map((part, index) =>
            part.type === 'text' ? <UserTextPart key={part_keys[index]} part={part} /> : null,
          )}
        </div>
      </div>
    </Message>
  );
}

function projected_message_images(
  parts: readonly ProjectedChatMessagePart[],
  part_keys: readonly string[],
): ChatMessageImage[] {
  return parts.flatMap((part, index) =>
    part.type === 'image'
      ? [
          {
            key: part_keys[index] ?? `image:${index}`,
            data_url: part.dataUrl,
            ...(part.name ? { name: part.name } : {}),
          },
        ]
      : [],
  );
}

function projected_message_files(
  parts: readonly ProjectedChatMessagePart[],
  part_keys: readonly string[],
): ChatMessageFile[] {
  return parts.flatMap((part, index) =>
    part.type === 'file'
      ? [
          {
            key: part_keys[index] ?? `file:${index}`,
            ...(part.fileId ? { file_id: part.fileId } : {}),
            ...(part.name ? { name: part.name } : {}),
            ...(part.mimeType ? { mime_type: part.mimeType } : {}),
            ...(part.isInlineText ? { is_inline_text: true } : {}),
          },
        ]
      : [],
  );
}

function UserMessageAttribution({ message }: { message: ProjectedChatMessage }) {
  if (!message.sender) return null;
  return (
    <div className="flex max-w-[78%] min-w-0 items-baseline justify-end gap-1.5 pr-1 text-[13px] leading-5">
      <span className="truncate font-medium text-foreground">{message.sender.display_name}</span>
    </div>
  );
}

function AssistantProjectedMessage({
  apps,
  assistantName,
  connectedApps,
  isLast,
  isRunActive,
  message,
  onArtifactOpen,
  onReload,
  runningToolKey,
  showAttribution,
  showFullTraces,
}: {
  apps: CatalogApp[];
  assistantName: string;
  connectedApps?: ConnectedAppTimes | undefined;
  isLast: boolean;
  isRunActive: boolean;
  message: ProjectedChatMessage;
  onArtifactOpen?: (file_id: string) => void;
  onReload?: () => void;
  runningToolKey?: string;
  showAttribution: boolean;
  showFullTraces: boolean;
}) {
  const connection_setup_urls = connection_setup_urls_from_parts(message.parts);
  const part_runs = assistant_part_runs(message.parts);
  const web_search_calls = message.parts.filter(is_web_search_part).map((part) => ({
    part,
    state: tool_row_state(part, isRunActive),
  }));
  const first_web_search = web_search_calls[0]?.part;
  const web_search_view = read_web_search_group(
    web_search_calls.map(({ part, state }) => ({
      call_id: part.canonicalId ?? part.toolCallId,
      state,
      ...(part.input === undefined ? {} : { input: part.input }),
      ...(part.output === undefined ? {} : { output: part.output }),
      ...(part.outputText === undefined ? {} : { outputText: part.outputText }),
      ...(part.errorText === undefined ? {} : { errorText: part.errorText }),
    })),
  );
  const web_search_is_visible = web_search_view.calls.some(
    (call) => call.state === 'awaiting_approval' || (!call.issue && is_running_state(call.state)),
  );
  const internal_tool_groups = read_internal_tool_groups(message.parts, isRunActive);
  const run_keys = unique_row_keys(part_runs.map(assistant_part_run_key));
  const key_by_run = new Map(
    part_runs.map((run, index) => [run, run_keys[index] ?? String(index)]),
  );
  const [show_folded_work, set_show_folded_work] = useState(false);
  if (part_runs.length === 0) return null;

  const mid_run_notes = mid_run_note_parts(message.parts);
  const settled = split_settled_run(part_runs, {
    fold_part: (part) => {
      if (!is_chat_tool_part(part)) return mid_run_notes.has(part);
      if (is_web_search_part(part)) return !web_search_is_visible;
      const group = internal_tool_groups.get(part);
      if (!group || tool_row_state(part, isRunActive) === 'awaiting_approval') return false;
      return !group.has_running;
    },
  });
  const folded_count = settled.folded.length;

  const brain_sources = read_turn_memory_sources(message.parts);
  const has_folded_work = folded_count > 0 || brain_sources.length > 0;

  const holding_app_name = isRunActive
    ? pending_connection_app_name(message.parts, connectedApps)
    : undefined;

  const folded_label = describe_folded_work(
    settled.folded,
    last_memory_summary(folded_internal_parts(settled.folded)),
    brain_sources.length,
  );

  return (
    <Message className="group/message group flex w-full max-w-3xl flex-1 items-start !gap-0 px-6 pb-3">
      <div className="flex min-w-full items-center gap-3">
        <div
          className={cn('relative flex min-w-0 flex-1 flex-col', isLast && !isRunActive && 'pb-4')}
        >
          {showAttribution ? (
            <AssistantAttribution name={assistantName} sentTime={message.sent_time} />
          ) : null}
          <div className="flex min-w-full flex-col gap-2">
            {has_folded_work ? (
              <ChatTimelineItem>
                <SettledWorkFold
                  isOpen={showFullTraces || show_folded_work}
                  label={isRunActive ? describe_live_work(settled.folded) : folded_label}
                  onToggle={() => set_show_folded_work(!show_folded_work)}
                />
              </ChatTimelineItem>
            ) : null}
            {has_folded_work ? (
              <WorkFoldContent isOpen={showFullTraces || show_folded_work}>
                <WorkRuns
                  apps={apps}
                  connectionSetupUrls={connection_setup_urls}
                  isRunActive={isRunActive}
                  internalToolGroups={internal_tool_groups}
                  runs={settled.folded}
                  showFullTraces={showFullTraces}
                  webSearchCalls={web_search_calls}
                  {...(onArtifactOpen ? { onArtifactOpen } : {})}
                  {...(runningToolKey ? { runningToolKey } : {})}
                />
                {brain_sources.length > 0 ? (
                  <MemorySourcesPanel apps={apps} sources={brain_sources} />
                ) : null}
                <EditionRunCostLine runId={message.run_id} />
              </WorkFoldContent>
            ) : null}
            {settled.shown.map((run) => {
              if (run.type === 'part' && is_web_search_part(run.part)) {
                if (run.part !== first_web_search) return null;
                return (
                  <ChatTimelineItem key={key_by_run.get(run)}>
                    <WebSearchTool calls={web_search_calls} showFullTraces={showFullTraces} />
                  </ChatTimelineItem>
                );
              }
              if (run.type === 'part' && is_chat_tool_part(run.part)) {
                const group = internal_tool_groups.get(run.part);
                if (group && tool_row_state(run.part, isRunActive) !== 'awaiting_approval') {
                  if (run.part !== group.first_part) return null;
                  return (
                    <ChatTimelineItem key={key_by_run.get(run)}>
                      <InternalToolPanel
                        calls={group.calls}
                        showFullTraces={showFullTraces}
                        {...(onArtifactOpen ? { onArtifactOpen } : {})}
                      />
                    </ChatTimelineItem>
                  );
                }
              }
              return (
                <ChatTimelineItem key={key_by_run.get(run)} surface={assistant_run_surface(run)}>
                  {run.type === 'internal' ? (
                    <InternalPartRun
                      apps={apps}
                      holdingAppName={holding_app_name}
                      isRunActive={isRunActive}
                      parts={run.parts}
                      showFullTraces={showFullTraces}
                      {...(runningToolKey ? { runningToolKey } : {})}
                    />
                  ) : run.type === 'thought' ? (
                    <ThoughtRun parts={run.parts} showFullTraces={showFullTraces} />
                  ) : (
                    <AssistantPart
                      apps={apps}
                      connectionSetupUrls={connection_setup_urls}
                      isRunActive={isRunActive}
                      part={run.part}
                      showFullTraces={showFullTraces}
                      {...(connectedApps ? { connectedApps } : {})}
                      {...(runningToolKey ? { runningToolKey } : {})}
                      {...(onArtifactOpen ? { onArtifactOpen } : {})}
                    />
                  )}
                </ChatTimelineItem>
              );
            })}
            {has_folded_work || isRunActive ? null : (
              <EditionRunCostLine revealsOnHover runId={message.run_id} />
            )}
            {isRunActive ? null : <StoppedAnswerMark run_id={message.run_id} />}
          </div>
          {isLast && onReload && !isRunActive ? (
            <MessageActions className="mt-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
              <MessageAction tooltip="Regenerate">
                <Button
                  aria-label="Regenerate response"
                  size="icon-xs"
                  type="button"
                  variant="ghost"
                  onClick={onReload}
                >
                  <RotateCcw className="size-3" />
                </Button>
              </MessageAction>
            </MessageActions>
          ) : null}
        </div>
      </div>
    </Message>
  );
}

const bare_surface_part_types = new Set(['artifact', 'file', 'image']);

function assistant_run_surface(run: AssistantPartRun): TimelineSurface {
  if (run.type !== 'part') return 'pill';
  if (run.part.type === 'text') return 'bubble';
  if (is_chat_tool_part(run.part) && run.part.toolName === web_search_node_key) return 'none';
  if (
    is_chat_tool_part(run.part) &&
    read_internal_tool_family(run.part) &&
    !decided_tool_states.has(run.part.state)
  ) {
    return 'none';
  }
  return bare_surface_part_types.has(run.part.type) ? 'none' : 'pill';
}

const timeline_reveal_transition = {
  duration: 0.34,
  ease: [0.22, 1, 0.36, 1] as const,
};

type TimelineSurface = 'bubble' | 'none' | 'pill';

const timeline_surface_class_names: Record<TimelineSurface, string> = {
  bubble: chat_assistant_bubble_class_name,
  none: '',
  pill: chat_work_pill_class_name,
};

function ChatTimelineItem({
  children,
  surface = 'none',
}: {
  children: React.ReactNode;
  surface?: TimelineSurface;
}) {
  const reduce_motion = useReducedMotion();
  const { cascadeBatchRef, hasPainted } = useChatCascade();
  const cascades = hasPainted && !reduce_motion;
  const [cascade_delay] = useState(() => (cascades ? next_cascade_delay(cascadeBatchRef) : 0));

  return (
    <motion.div
      className={cn('min-w-0', timeline_surface_class_names[surface])}
      initial={cascades ? { opacity: 0, y: 4 } : false}
      animate={{ opacity: 1, y: 0 }}
      transition={
        cascades ? { ...timeline_reveal_transition, delay: cascade_delay } : { duration: 0 }
      }
    >
      {surface === 'pill' ? <ActivityRail value={false}>{children}</ActivityRail> : children}
    </motion.div>
  );
}

function AssistantPart({
  apps,
  connectedApps,
  connectionSetupUrls = [],
  isRunActive,
  onArtifactOpen,
  part,
  runningToolKey,
  showFullTraces = false,
}: {
  apps: CatalogApp[];
  connectedApps?: ConnectedAppTimes | undefined;
  connectionSetupUrls?: string[];
  isRunActive: boolean;
  onArtifactOpen?: (file_id: string) => void;
  part: ProjectedChatMessagePart;
  runningToolKey?: string;
  showFullTraces?: boolean;
}) {
  if (part.type === 'text') {
    const text = assistant_text_for_display(part.text, connectionSetupUrls);
    if (!text.trim()) return null;
    return <ChatAssistantText is_streaming={isRunActive} text={text} />;
  }

  if (part.type === 'reasoning') return null;
  if (part.type === 'image') {
    return <ChatMessageImages images={projected_message_images([part], [part.name ?? 'image'])} />;
  }
  if (part.type === 'file') {
    return <ChatMessageFiles files={projected_message_files([part], [part.fileId ?? 'file'])} />;
  }
  if (part.type === 'artifact') {
    return <ChatArtifactCard part={part} {...(onArtifactOpen ? { onOpen: onArtifactOpen } : {})} />;
  }
  if (part.type === 'source') return <SourceRow part={part} />;
  if (is_chat_tool_part(part)) {
    if (is_lookup_tool_name(part.toolName)) {
      return <LookupToolPartRow apps={apps} isRunActive={isRunActive} part={part} />;
    }

    const choices = is_choice_ask_part(part) ? read_present_choices(part.input) : null;
    if (choices) {
      const first_question = choices.questions[0]?.question ?? '';
      const answer = read_choice_answer(part.output);
      if (answer) return <ChoiceAnsweredRow question={first_question} reply={answer} />;
      return <ChoiceTraceRow words={choice_trace_words(part, settled_tool_states)} />;
    }

    const connection_setup = read_part_connection_setup(part);
    if (connection_setup) {
      const is_connected = connectedApps
        ? is_connected_app(connection_setup.app, connectedApps, connection_request_time_ms(part))
        : false;
      return (
        <ConnectionTraceRow app={connection_setup.app} apps={apps} isConnected={is_connected} />
      );
    }

    const display = tool_part_display(part, apps);
    const system_icon = resolve_system_tool_icon(part.toolName);
    const row_state = tool_row_state(part, isRunActive);
    if (decided_tool_states.has(row_state)) {
      const place_name = tool_part_place_name(part, apps);
      return (
        <ApprovalTraceRow
          actionName={approval_action_name(part, display)}
          state={row_state}
          {...(display?.subtitle ? { appName: display.subtitle } : {})}
          {...(display?.iconUrl ? { iconUrl: display.iconUrl } : {})}
          {...(place_name ? { placeName: place_name } : {})}
        />
      );
    }
    const row_tense = tool_row_tense(part, row_state);
    const row_label = tool_row_label(part, row_tense ?? 'attempted', display?.title);
    const is_on_stage = chat_tool_part_key(part) === runningToolKey;
    const live_output_line = is_on_stage ? last_output_line(part.outputText) : undefined;

    return (
      <Tool
        forceExpanded={showFullTraces}
        toolName={part.toolName}
        {...tool_row_outcome(part, row_state)}
        {...(display ? { display } : {})}
        {...(system_icon ? { systemIcon: system_icon } : {})}
        {...(part.input === undefined ? {} : { input: part.input })}
        {...(row_label !== undefined ? { rowLabel: row_label } : {})}
        {...(is_on_stage ? { onStage: true } : {})}
        {...(live_output_line ? { liveOutputLine: live_output_line } : {})}
      />
    );
  }

  return null;
}

function pending_connection_app_name(
  parts: ProjectedChatMessagePart[],
  connected_apps: ConnectedAppTimes | undefined,
) {
  if (!connected_apps) return undefined;
  for (const part of parts) {
    if (!is_chat_tool_part(part)) continue;
    const setup = read_connection_setup_tool_output(part.output);
    if (setup && !is_connected_app(setup.app, connected_apps, connection_request_time_ms(part))) {
      return setup.app.app_display_name;
    }
  }
  return undefined;
}

function last_output_line(output_text: string | undefined) {
  const line = (output_text ?? '')
    .split(line_break_re)
    .map((value) => value.trim())
    .filter(Boolean)
    .at(-1);
  if (!line) return undefined;
  return line.length > 160 ? `${line.slice(0, 160)}…` : line;
}

function InternalPartRun({
  apps,
  holdingAppName,
  isRunActive,
  parts,
  runningToolKey,
  showFullTraces,
}: {
  apps: CatalogApp[];
  holdingAppName?: string | undefined;
  isRunActive: boolean;
  parts: ProjectedChatMessagePart[];
  runningToolKey?: string;
  showFullTraces: boolean;
}) {
  const connection_setup_urls = connection_setup_urls_from_parts(parts);
  const status = internal_run_status(parts, isRunActive);
  const part_keys = message_part_keys(parts);
  const fold = useLivingFold({ forceOpen: showFullTraces });
  const reduce_motion = useReducedMotion();
  const is_holding = Boolean(holdingAppName) && status.tense === 'running';

  return (
    <details className="group/internal min-w-0" open>
      <InternalRunSummary apps={apps} fold={fold} parts={parts} status={status} />
      <motion.div
        animate={{ height: fold.isOpen ? 'auto' : 0, opacity: fold.isOpen ? 1 : 0 }}
        className="overflow-hidden"
        initial={false}
        transition={reduce_motion ? { duration: 0 } : fold_transition}
      >
        <ActivityRail value={true}>
          <div className={activity_children_class_name}>
            {parts.map((part, index) => (
              <ChatTimelineItem key={part_keys[index]}>
                <AssistantPart
                  apps={apps}
                  connectionSetupUrls={connection_setup_urls}
                  isRunActive={isRunActive}
                  part={part}
                  showFullTraces={showFullTraces}
                  {...(runningToolKey ? { runningToolKey } : {})}
                />
              </ChatTimelineItem>
            ))}
            {is_holding && holdingAppName ? <GroupHoldingRow appName={holdingAppName} /> : null}
          </div>
        </ActivityRail>
      </motion.div>
    </details>
  );
}

const fold_transition = {
  height: { duration: 0.44, ease: [0.22, 1, 0.36, 1] as const },
  opacity: { duration: 0.3, ease: [0.22, 1, 0.36, 1] as const },
};

function GroupHoldingRow({ appName }: { appName: string }) {
  return (
    <div className={cn(activity_row_class_name, 'w-fit max-w-full')}>
      <ActivityChevron expandable={false} open={false} />
      <ActivityGlyph icon={Clock} />
      <span className="min-w-0 text-muted-foreground">
        Holding here until {appName} is connected.
      </span>
    </div>
  );
}

function InternalRunSummary({
  apps,
  fold,
  parts,
  status,
}: {
  apps: CatalogApp[];
  fold: ReturnType<typeof useLivingFold>;
  parts: ProjectedChatMessagePart[];
  status: ReturnType<typeof internal_run_status>;
}) {
  return (
    // biome-ignore lint/a11y/useSemanticElements: <summary> is the disclosure widget <details> requires; swapping in <button> would break the native semantics this replaces only the toggle behavior of.
    <summary
      aria-expanded={fold.isOpen}
      className={cn(
        activity_row_class_name,
        'w-fit cursor-pointer list-none transition-colors marker:hidden hover:text-foreground [&::-webkit-details-marker]:hidden',
      )}
      role="button"
      onClick={(event) => {
        event.preventDefault();
        fold.onToggle();
      }}
    >
      <ActivityChevron alwaysVisible expandable open={fold.isOpen} />
      <InternalRunMark apps={apps} isRunning={status.tense === 'running'} parts={parts} />
      <span className="min-w-0">
        {internal_run_label(parts, status.tense)}
        {status.failed_count > 0 ? (
          <ActivityDetail tone="failed">{status.failed_count} failed</ActivityDetail>
        ) : null}
      </span>
    </summary>
  );
}

function UserTextPart({ part }: { part: Extract<ProjectedChatMessagePart, { type: 'text' }> }) {
  return (
    <div className={chat_user_message_class_name}>
      <TypedMessageText text={part.text} />
    </div>
  );
}

function SettledWorkFold({
  isOpen,
  label,
  onToggle,
}: {
  isOpen: boolean;
  label: string;
  onToggle: () => void;
}) {
  return (
    <button
      aria-expanded={isOpen}
      className={cn(
        'flex w-fit max-w-full cursor-pointer items-center gap-1.5 py-1 text-left text-[14px]',
        'text-muted-foreground transition-colors hover:text-foreground',
      )}
      type="button"
      onClick={onToggle}
    >
      <span className="min-w-0">{label}</span>
      <ChevronDown
        aria-hidden="true"
        className={cn('size-4 shrink-0 transition-transform duration-300', isOpen && 'rotate-180')}
      />
    </button>
  );
}

function WorkRuns({
  apps,
  connectionSetupUrls,
  internalToolGroups,
  isRunActive,
  onArtifactOpen,
  runningToolKey,
  runs,
  showFullTraces,
  webSearchCalls,
}: {
  apps: CatalogApp[];
  connectionSetupUrls: string[];
  internalToolGroups: ReturnType<typeof read_internal_tool_groups>;
  isRunActive: boolean;
  onArtifactOpen?: (file_id: string) => void;
  runningToolKey?: string;
  runs: AssistantPartRun[];
  showFullTraces: boolean;
  webSearchCalls: Array<{ part: ProjectedChatToolPart; state: string }>;
}) {
  const run_keys = unique_row_keys(runs.map(assistant_part_run_key));
  return (
    <div className="flex min-w-0 flex-col gap-1.5 pl-0.5">
      {runs.map((run, run_index) => {
        if (run.type === 'thought') {
          const part_keys = message_part_keys(run.parts);
          return run.parts.map((part, part_index) => (
            <ReasoningStep key={part_keys[part_index]} part={part} />
          ));
        }
        const parts = run.type === 'internal' ? run.parts : [run.part];
        const part_keys = message_part_keys(parts);
        return parts.map((part, part_index) => {
          const key = part_keys[part_index] ?? run_keys[run_index];
          if (is_web_search_part(part)) {
            if (part !== webSearchCalls[0]?.part) return null;
            return (
              <div className="min-w-0" key={key}>
                <WebSearchTool calls={webSearchCalls} showFullTraces={showFullTraces} />
              </div>
            );
          }
          if (is_chat_tool_part(part)) {
            const group = internalToolGroups.get(part);
            if (group) {
              if (part !== group.first_part) return null;
              return (
                <div className="min-w-0" key={key}>
                  <InternalToolPanel
                    calls={group.calls}
                    showFullTraces={showFullTraces}
                    {...(onArtifactOpen ? { onArtifactOpen } : {})}
                  />
                </div>
              );
            }
          }
          return (
            <div className="min-w-0" key={key}>
              {part.type === 'text' ? (
                <ReasoningStep part={{ ...part, type: 'reasoning', state: 'complete' }} />
              ) : (
                <AssistantPart
                  apps={apps}
                  connectionSetupUrls={connectionSetupUrls}
                  isRunActive={isRunActive}
                  part={part}
                  showFullTraces={showFullTraces}
                  {...(runningToolKey ? { runningToolKey } : {})}
                />
              )}
            </div>
          );
        });
      })}
    </div>
  );
}

function WorkFoldContent({ children, isOpen }: { children: React.ReactNode; isOpen: boolean }) {
  const reduce_motion = useReducedMotion();
  return (
    <motion.div
      aria-hidden={!isOpen}
      animate={{ height: isOpen ? 'auto' : 0, opacity: isOpen ? 1 : 0 }}
      className="overflow-hidden"
      inert={!isOpen}
      initial={false}
      transition={reduce_motion ? { duration: 0 } : fold_transition}
    >
      {children}
    </motion.div>
  );
}

function ThoughtRun({
  parts,
  showFullTraces,
}: {
  parts: ReasoningPart[];
  showFullTraces: boolean;
}) {
  const is_streaming = parts.some((part) => part.state === 'streaming');
  const part_keys = message_part_keys(parts);
  const [pinned_open, set_pinned_open] = useState<boolean | null>(null);
  const is_open = showFullTraces || (pinned_open ?? false);
  const reduce_motion = useReducedMotion();

  return (
    <div className="group/thought min-w-0">
      <ThoughtRunToggle
        isOpen={is_open}
        isStreaming={is_streaming}
        parts={parts}
        onToggle={() => set_pinned_open(!is_open)}
      />
      <motion.div
        animate={{ height: is_open ? 'auto' : 0, opacity: is_open ? 1 : 0 }}
        className="overflow-hidden"
        initial={false}
        transition={reduce_motion ? { duration: 0 } : fold_transition}
      >
        <div className={activity_children_class_name}>
          {parts.map((part, index) => (
            <ReasoningStep key={part_keys[index]} part={part} />
          ))}
        </div>
      </motion.div>
    </div>
  );
}

function ReasoningStep({ part }: { part: ReasoningPart }) {
  return (
    <MessageContent
      className={chat_reasoning_class_name}
      markdown
      streamdownClassName={chat_reasoning_streamdown_class_name}
    >
      {part.text}
    </MessageContent>
  );
}

function SourceRow({ part }: { part: SourcePart }) {
  const is_memory_recall = part.sourceId === workspace_memory_recall_source_id;
  const Icon = is_memory_recall ? Sparkles : BookOpen;
  const label = is_memory_recall ? 'Read workspace memory' : (part.title ?? 'Read a source');

  return (
    <div className={cn(activity_row_class_name, 'w-fit max-w-full')}>
      <ActivityChevron expandable={false} open={false} />
      <ActivityGlyph icon={Icon} />
      <span className="min-w-0">
        {label}
        {part.citationText ? <ActivityDetail>{part.citationText}</ActivityDetail> : null}
      </span>
    </div>
  );
}

type SourcePart = Extract<ProjectedChatMessagePart, { type: 'source' }>;

const workspace_memory_recall_source_id = 'workspace_memory_recall';

function InternalRunMark({
  apps,
  isRunning,
  parts,
}: {
  apps: CatalogApp[];
  isRunning: boolean;
  parts: ProjectedChatMessagePart[];
}) {
  const first_tool_part = parts.find(is_chat_tool_part);
  if (!first_tool_part) return null;

  const display = tool_part_display(first_tool_part, apps);
  const system_icon = resolve_system_tool_icon(first_tool_part.toolName);
  const letter = display?.subtitle ?? display?.title;

  if (display?.iconUrl) return <ActivityGlyph breathing={isRunning} iconUrl={display.iconUrl} />;
  if (system_icon) return <ActivityGlyph breathing={isRunning} icon={system_icon} />;
  if (letter) return <ActivityGlyph breathing={isRunning} letter={letter} />;
  return <ActivityGlyph breathing={isRunning} icon={Wrench} />;
}

function connection_setup_urls_from_parts(parts: ProjectedChatMessagePart[]) {
  return parts.flatMap((part) => {
    if (!is_chat_tool_part(part)) return [];
    const url = read_connection_setup_tool_output(part.output)?.start_url;
    return url ? [url] : [];
  });
}

type AssistantPartRun =
  | { type: 'part'; part: ProjectedChatMessagePart; startIndex: number }
  | { type: 'internal'; parts: ProjectedChatMessagePart[]; startIndex: number }
  | { type: 'thought'; parts: ReasoningPart[]; startIndex: number };

function assistant_part_runs(parts: ProjectedChatMessagePart[]): AssistantPartRun[] {
  const runs: AssistantPartRun[] = [];
  let internal_parts: ProjectedChatMessagePart[] = [];
  let internal_start_index = 0;
  let reasoning_parts: ReasoningPart[] = [];
  let reasoning_start_index = 0;

  const push_internal_run = () => {
    if (internal_parts.length === 0) return;
    runs.push({ type: 'internal', parts: internal_parts, startIndex: internal_start_index });
    internal_parts = [];
  };

  const push_thought_run = () => {
    if (reasoning_parts.length === 0) return;
    runs.push({ type: 'thought', parts: reasoning_parts, startIndex: reasoning_start_index });
    reasoning_parts = [];
  };

  for (const [part_index, part] of parts.entries()) {
    if (part.type === 'reasoning' && part.text.trim()) {
      push_internal_run();
      if (reasoning_parts.length === 0) reasoning_start_index = part_index;
      reasoning_parts.push(part);
      continue;
    }

    push_thought_run();

    if (is_collapsible_internal_part(part)) {
      if (internal_parts.length === 0) internal_start_index = part_index;
      internal_parts.push(part);
      continue;
    }

    push_internal_run();
    runs.push({ type: 'part', part, startIndex: part_index });
  }

  push_thought_run();
  push_internal_run();
  return runs;
}

export function assistant_part_run_key(run: AssistantPartRun) {
  if (run.type === 'part') {
    if (run.part.type === 'text') return `part:text:${run.startIndex}`;
    return `part:${message_part_identity(run.part)}`;
  }
  const first_part = run.parts[0];
  if (run.type === 'internal' && first_part && is_chat_tool_part(first_part)) {
    return `internal:${chat_tool_part_key(first_part)}`;
  }
  return `${run.type}:${run.startIndex}`;
}

function is_collapsible_internal_part(part: ProjectedChatMessagePart) {
  if (!is_chat_tool_part(part)) return false;
  if (part.toolName === present_choices_node_key) return false;
  if (part.toolName === web_search_node_key) return false;
  if (read_internal_tool_family(part) && !decided_tool_states.has(part.state)) return false;
  return !is_connection_setup_tool_name(part.toolName);
}

function is_connection_setup_tool_name(tool_name: string) {
  return tool_name.includes('create_connection');
}

function internal_run_label(parts: ProjectedChatMessagePart[], tense: InternalRunTense) {
  const app_name = shared_tool_app_name(parts);
  const counts = tool_action_counts(parts);
  const tools = parts.filter(is_chat_tool_part);
  const has_external_tool = tools.some(
    (part) => part.display?.subtitle && !is_runtime_pseudo_app(part.display.subtitle),
  );
  if (!app_name && has_external_tool) {
    const verb = { running: 'Running', done: 'Completed', attempted: 'Tried' }[tense];
    return `${verb} ${tools.length} ${tools.length === 1 ? 'action' : 'actions'}`;
  }

  if (tense === 'running') {
    if (app_name) return `Working in ${app_name}`;
    if (counts.size === 0) return 'Working';
    const [action, count] = dominant_tool_action(counts);
    return title_case(running_action_phrase(action, count));
  }

  if (counts.size === 0) return tense === 'attempted' ? 'Tried' : 'Worked';
  if (app_name) return tense === 'attempted' ? `Tried ${app_name}` : `Worked in ${app_name}`;
  const [action, count] = dominant_tool_action(counts);
  return title_case(tool_action_phrase(action, count, tense));
}

function dominant_tool_action(counts: Map<ToolAction, number>): [ToolAction, number] {
  const entries = [...counts];
  return entries.reduce(
    (leader, entry) => (entry[1] > leader[1] ? entry : leader),
    entries[0] as [ToolAction, number],
  );
}

function running_action_phrase(action: ToolAction, count: number) {
  if (action === 'searched') return 'searching';
  if (action === 'sent') return count === 1 ? 'sending a message' : `sending ${count} messages`;
  if (action === 'previewed')
    return count === 1 ? 'starting a preview' : `starting ${count} previews`;
  if (action === 'ran') return count === 1 ? 'running a command' : `running ${count} commands`;
  if (action === 'listed')
    return count === 1 ? 'listing a directory' : `listing ${count} directories`;
  const gerund = action === 'edited' ? 'editing' : 'reading';
  return count === 1 ? `${gerund} a file` : `${gerund} ${count} files`;
}

function tool_action_counts(parts: ProjectedChatMessagePart[]) {
  const counts = new Map<ToolAction, number>();
  for (const part of parts) {
    if (!is_chat_tool_part(part)) continue;
    const action = tool_action(part);
    counts.set(action, (counts.get(action) ?? 0) + 1);
  }
  return counts;
}

const completed_tool_states = new Set(['complete', 'completed', 'done', 'success', 'succeeded']);

type InternalRunTense = 'attempted' | 'done' | 'running';

function internal_run_status(parts: ProjectedChatMessagePart[], is_run_active: boolean) {
  let failed_count = 0;
  let has_unresolved = false;
  for (const part of parts) {
    if (!is_chat_tool_part(part)) continue;
    const has_ended =
      completed_tool_states.has(part.state) || has_command_ended_with_exit_code(part);
    if (is_failed_tool_call(part)) failed_count += 1;
    else if (!has_ended) has_unresolved = true;
  }
  return { failed_count, tense: internal_run_tense(has_unresolved, is_run_active) };
}

function internal_run_tense(has_unresolved: boolean, is_run_active: boolean): InternalRunTense {
  if (!has_unresolved) return 'done';
  return is_run_active ? 'running' : 'attempted';
}

function approval_action_name(
  part: ProjectedChatToolPart,
  display: ReturnType<typeof tool_part_display>,
) {
  const title = display?.title?.trim();
  if (title) return title;
  return title_case(running_action_phrase(tool_action(part), 1));
}

const decided_tool_states = new Set(['awaiting_approval', 'denied']);

function tool_row_state(part: ProjectedChatToolPart, is_run_active: boolean) {
  if (decided_tool_states.has(part.state)) return part.state;
  if (is_run_active || !is_unresolved_tool_part(part)) return part.state;
  return 'attempted';
}

function is_unresolved_tool_part(part: ProjectedChatToolPart) {
  return !decided_tool_states.has(part.state) && !has_tool_call_ended(part);
}

type ToolAction = 'edited' | 'listed' | 'previewed' | 'ran' | 'read' | 'searched' | 'sent';

function tool_action(part: Extract<ProjectedChatMessagePart, { toolName: string }>): ToolAction {
  const label = `${part.toolName} ${part.display?.title ?? ''}`.toLowerCase();
  if (has_any_tool_token(label, ['search', 'grep', 'glob', 'find'])) return 'searched';
  if (has_any_tool_token(label, ['respond', 'send message', 'send_message'])) return 'sent';
  if (has_any_tool_token(label, ['preview', 'serve', 'server', 'dev server'])) return 'previewed';
  if (has_any_tool_token(label, ['write', 'edit', 'patch', 'update', 'create', 'delete', 'remove']))
    return 'edited';
  if (has_any_tool_token(label, ['read', 'open', 'view'])) return 'read';
  if (has_any_tool_token(label, ['list', 'ls', 'tree'])) return 'listed';
  return 'ran';
}

function shared_tool_app_name(parts: ProjectedChatMessagePart[]) {
  const app_names = new Set<string>();
  for (const part of parts) {
    if (!is_chat_tool_part(part) || !part.display?.appName || !part.display.subtitle) continue;
    if (is_runtime_pseudo_app(part.display.subtitle)) continue;
    app_names.add(part.display.subtitle);
  }
  return app_names.size === 1 ? [...app_names][0] : null;
}

function has_any_tool_token(value: string, tokens: string[]) {
  return tokens.some((token) => value.includes(token));
}

function tool_action_phrase(action: ToolAction, count: number, tense: InternalRunTense) {
  if (tense === 'attempted') return attempted_action_phrase(action, count);
  if (action === 'searched') return 'searched';
  if (action === 'sent') return count === 1 ? 'sent a message' : `sent ${count} messages`;
  if (action === 'previewed')
    return count === 1 ? 'started a preview' : `started ${count} previews`;
  if (action === 'ran') return count === 1 ? 'completed an action' : `completed ${count} actions`;
  if (action === 'listed')
    return count === 1 ? 'listed a directory' : `listed ${count} directories`;
  return count === 1 ? `${action} a file` : `${action} ${count} files`;
}

function attempted_action_phrase(action: ToolAction, count: number) {
  if (action === 'searched') return 'tried to search';
  if (action === 'sent')
    return count === 1 ? 'tried to send a message' : `tried to send ${count} messages`;
  if (action === 'previewed')
    return count === 1 ? 'tried to start a preview' : `tried to start ${count} previews`;
  if (action === 'ran') return count === 1 ? 'tried an action' : `tried ${count} actions`;
  if (action === 'listed')
    return count === 1 ? 'tried to list a directory' : `tried to list ${count} directories`;
  const verb = action === 'edited' ? 'edit' : 'read';
  return count === 1 ? `tried to ${verb} a file` : `tried to ${verb} ${count} files`;
}

function title_case(value: string) {
  return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}

function message_part_keys(parts: readonly ProjectedChatMessagePart[]) {
  return unique_row_keys(parts.map(streaming_safe_part_identity));
}

function streaming_safe_part_identity(part: ProjectedChatMessagePart) {
  return part.type === 'text' || part.type === 'reasoning'
    ? part.type
    : message_part_identity(part);
}

function unique_row_keys(identities: string[]) {
  const counts = new Map<string, number>();
  return identities.map((identity) => {
    const count = counts.get(identity) ?? 0;
    counts.set(identity, count + 1);
    return count === 0 ? identity : `${identity}#${count}`;
  });
}

function chat_message_keys(messages: ProjectedChatMessage[]) {
  return unique_row_keys(
    messages.map((message) =>
      message.role === 'assistant' && message.run_id ? `run:${message.run_id}` : message.id,
    ),
  );
}

export function message_part_identity(part: ProjectedChatMessagePart) {
  if (part.type === 'text' || part.type === 'reasoning') return `${part.type}:${part.text}`;
  if (part.type === 'artifact') return `artifact:${part.artifactId}`;
  if (part.type === 'source') return `source:${part.sourceId}`;
  if (part.type === 'image') return `image:${part.name ?? ''}`;
  if (part.type === 'file') return `file:${part.fileId ?? part.name ?? ''}`;
  const setup = read_connection_setup_tool_output(part.output);
  if (setup) return `connection_setup:${setup.start_url}`;
  return `${part.type}:${chat_tool_part_key(part)}`;
}

function EmptyConversation() {
  return <div className="h-full w-full" />;
}

function find_last_assistant_message_id(messages: ProjectedChatMessage[]) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === 'assistant') return message.id;
  }
  return undefined;
}
