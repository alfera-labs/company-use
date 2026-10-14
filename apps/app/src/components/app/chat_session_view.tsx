import { public_env } from '@coworker/config/public_env';
import { cn } from '@coworker/ui/lib/utils';
import { useEffect, useMemo, useRef, useState } from 'react';
import { not_answerable_yet_words } from '@/components/app/chat_choice_dock';
import { ChatComposerDock } from '@/components/app/chat_composer_dock';
import { chat_conversation_footer } from '@/components/app/chat_conversation_footer';
import { ChatConversationWithRuns } from '@/components/app/chat_conversation_with_runs';
import { chat_draft_key } from '@/components/app/chat_draft_storage';
import { ChatHeader } from '@/components/app/chat_header';
import { useChatOptimisticMessageStore } from '@/components/app/chat_optimistic_message_store';
import { ChatPaywallDialogs } from '@/components/app/chat_paywall_dialogs';
import { queued_message_areas } from '@/components/app/chat_queued_message_areas';
import { selected_chat_session_id } from '@/components/app/chat_selected_session_id';
import { ChatSessionComposer } from '@/components/app/chat_session_composer';
import {
  ChatOnboardingHome,
  ChatSessionGrid,
  ChatSessionLoadingSkeleton,
  ChatSessionSidePanels,
} from '@/components/app/chat_session_layout';
import {
  is_chat_run_active,
  resumed_run_watch_ms,
  should_keep_chat_submitting,
  should_show_chat_session_loading,
} from '@/components/app/chat_session_state';
import { chat_title } from '@/components/app/chat_title';
import { useChatUiStore } from '@/components/app/chat_ui_store';
import { useCatalogApps } from '@/components/app/use_catalog_apps';
import { useChatAttachments } from '@/components/app/use_chat_attachments';
import { useChatBrowserPreview } from '@/components/app/use_chat_browser_preview';
import { useChatListSaysWorking } from '@/components/app/use_chat_list_says_working';
import { useChatLiveSocket } from '@/components/app/use_chat_live_socket';
import { useChatOnboardingView } from '@/components/app/use_chat_onboarding_view';
import { useChatOpenChoices } from '@/components/app/use_chat_open_choices';
import { type ChatWallCode, useChatPaywall } from '@/components/app/use_chat_paywall';
import { useMarkChatRead } from '@/components/app/use_chat_read_state';
import { useChatRouteHandoff } from '@/components/app/use_chat_route_handoff';
import { useChatRunStream } from '@/components/app/use_chat_run_stream';
import { useChatSendActions } from '@/components/app/use_chat_send_actions';
import {
  useChatSendMessage,
  useForgetOptimisticMessage,
} from '@/components/app/use_chat_send_message';
import {
  useChatMessagesQuery,
  useChatRunsQuery,
  useChatToolCallsQuery,
} from '@/components/app/use_chat_session_queries';
import { useChatSidePanels } from '@/components/app/use_chat_side_panels';
import { useChatTranscript } from '@/components/app/use_chat_transcript';
import { useConnectedChatApps } from '@/components/app/use_connected_chat_apps';
import {
  useEarlierMessagesCursor,
  useLoadEarlierMessages,
} from '@/components/app/use_earlier_chat_messages';
import { useProjectedChatMessages } from '@/components/app/use_projected_chat_messages';
import { useQueuedChatMessages } from '@/components/app/use_queued_chat_messages';
import { useRefreshChatListWhenRunEnds } from '@/components/app/use_refresh_chat_list_when_run_ends';
import { useStopChatRun } from '@/components/app/use_stop_chat_run';
import { OpenWorkspaceFileProvider } from '@/components/prompt-kit/markdown_file_links';
import type { Session } from '@/lib/api';
import { useBrowserTabTitle } from '@/lib/use_browser_tab_title';

export function ChatSessionView({
  onSessionReady,
  selectedSessionId,
  selectedSession,
}: {
  onSessionReady: (session_id: string) => void;
  selectedSessionId?: string;
  selectedSession?: Session;
}) {
  const session_id = selected_chat_session_id({
    ...(selectedSession ? { selectedSession } : {}),
    ...(selectedSessionId ? { selectedSessionId } : {}),
  });
  useMarkChatRead(selectedSession);
  useBrowserTabTitle(session_id && !selectedSession ? 'Chats' : chat_title(selectedSession));
  const { earlier_messages_cursor, set_earlier_messages_cursor } =
    useEarlierMessagesCursor(session_id);
  const stream_abort_ref = useRef<AbortController | null>(null);
  const stream_session_id_ref = useRef<string | undefined>(undefined);
  const { attachments, set_attachments, append_files, remove_attachment } =
    useChatAttachments(session_id);
  const [project_id, set_project_id] = useState<string | null>(null);
  const optimistic_user_messages = useChatOptimisticMessageStore(
    (state) => state.optimistic_user_messages,
  );
  const draft_key = chat_draft_key(session_id);
  const show_full_traces = useChatUiStore(
    (state) => public_env.NEXT_PUBLIC_ENVIRONMENT !== 'production' && state.show_full_traces,
  );
  const [resumed_run_watch_deadline_ms, set_resumed_run_watch_deadline_ms] = useState(0);
  const [wall_code, set_wall_code] = useState<ChatWallCode | null>(null);
  const chat_send = useChatSendMessage({
    session_id,
    draft_key,
    on_session_ready: onSessionReady,
    set_attachments,
    set_wall_code,
    watch_for_resumed_run: () =>
      set_resumed_run_watch_deadline_ms(Date.now() + resumed_run_watch_ms),
    read_send_moment_state: () => ({
      messages: messages_query.data ?? [],
      latest_run_id: latest_run?.run_id,
      refresh_queued_messages: queued_chat_messages.refresh,
    }),
  });
  const { send_message, run_id_before_send_ref, client_message_id_for_draft } = chat_send;
  const unconfirmed_messages = useMemo(
    () =>
      optimistic_user_messages.filter((message) =>
        session_id ? message.session_id === session_id : false,
      ),
    [optimistic_user_messages, session_id],
  );
  const [is_live_socket_open, set_is_live_socket_open] = useState(false);
  const forget_optimistic_message = useForgetOptimisticMessage(session_id);
  const queued_chat_messages = useQueuedChatMessages({
    session_id,
    is_live_socket_open,
    unconfirmed_messages,
    forget_own_copy: (client_message_id) => forget_optimistic_message(client_message_id),
  });
  const runs_query = useChatRunsQuery({
    session_id,
    resumed_run_watch_deadline_ms,
    has_waiting_messages: queued_chat_messages.has_waiting_messages,
    is_live_socket_open,
  });
  const latest_run = runs_query.data?.[0];
  const latest_run_id = latest_run?.run_id;
  useRefreshChatListWhenRunEnds(latest_run);
  const is_runtime_active = is_chat_run_active(latest_run?.run_status);
  const is_starting = send_message.isPending || queued_chat_messages.has_message_waiting_to_start;
  useChatListSaysWorking({ session: selectedSession, newest_run: latest_run, is_starting });
  const open_choices = useChatOpenChoices({ session_id, is_runtime_active, is_live_socket_open });
  const should_poll_runtime = is_runtime_active && !send_message.isPending;
  const live_socket = useChatLiveSocket({
    session_id,
    wants_live:
      is_runtime_active || queued_chat_messages.has_waiting_messages || send_message.isPending,
    newest_run_id: latest_run_id,
  });
  useEffect(() => set_is_live_socket_open(live_socket.is_open), [live_socket.is_open]);
  const paywall = useChatPaywall({
    session_id,
    wall_code,
    set_wall_code,
    is_runtime_active,
    is_send_pending: send_message.isPending,
  });
  const { effective_wall_code, set_paywall_open } = paywall;
  const messages_query = useChatMessagesQuery({
    session_id,
    polls:
      (should_poll_runtime || queued_chat_messages.has_waiting_messages) && !is_live_socket_open,
    set_earlier_messages_cursor,
  });
  const earlier_messages = useLoadEarlierMessages({
    session_id,
    earlier_messages_cursor,
    set_earlier_messages_cursor,
  });
  const tool_calls_query = useChatToolCallsQuery(
    session_id,
    is_runtime_active && !is_live_socket_open,
  );
  const catalog_apps_query = useCatalogApps();
  const catalog_apps = useMemo(() => catalog_apps_query.data ?? [], [catalog_apps_query.data]);
  const connected_apps = useConnectedChatApps(set_resumed_run_watch_deadline_ms);
  const { session_messages, queued_messages, visible_messages } = useChatTranscript({
    session_id,
    saved_messages: messages_query.data,
    unconfirmed_messages,
    queued: queued_chat_messages,
  });
  useChatRunStream({
    session_id,
    latest_run_id,
    is_send_pending: send_message.isPending,
    should_poll_runtime,
    is_live_socket_healthy: live_socket.is_healthy,
  });
  const { visible_tool_calls, artifact_items, chat_messages } = useProjectedChatMessages({
    session_id,
    latest_run_id,
    saved_tool_calls: tool_calls_query.data,
    session_messages,
    selected_session: selectedSession,
    runs: runs_query.data,
  });
  const browser = useChatBrowserPreview({
    session_id,
    latest_run_id,
    run_id_before_send: run_id_before_send_ref.current,
    is_runtime_active,
    is_send_pending: send_message.isPending,
    visible_tool_calls,
  });
  const panels = useChatSidePanels(session_id, artifact_items);
  const show_onboarding = !session_id && chat_messages.length === 0;
  const onboarding = useChatOnboardingView({
    session_id,
    selected_session: selectedSession,
    visible_messages,
    chat_messages,
  });
  const is_chat_submitting = should_keep_chat_submitting({
    isMutationPending: send_message.isPending || chat_send.run_again.is_pending,
    isMessageWaitingToStart: queued_chat_messages.has_message_waiting_to_start,
    latestRunStartedThisSend: latest_run_id !== run_id_before_send_ref.current,
    latestRunStatus: latest_run?.run_status,
    selectedSessionStatus: selectedSession?.session_status,
  });
  const stop_current_run = useStopChatRun({
    session_id,
    run: latest_run,
    is_submitting: is_chat_submitting,
    stream_abort_ref,
    stream_session_id_ref,
  });
  const show_session_loading = should_show_chat_session_loading({
    isMessagesLoading: messages_query.isLoading,
    isMutationPending: send_message.isPending,
    messageCount: chat_messages.length,
    sessionId: session_id,
  });
  useChatRouteHandoff({
    session_id,
    draft_key,
    paywall,
    send_message,
    set_attachments,
    set_project_id,
  });
  const { send_chat_message, send_from_composer, run_last_message_again } = useChatSendActions({
    session_id,
    draft_key,
    project_id,
    attachments,
    effective_wall_code,
    set_paywall_open,
    send_message,
    run_again: chat_send.run_again.run,
    client_message_id_for_draft,
    choice_panel_open: open_choices.choice_panel_open,
    answer_choice_panel: open_choices.answer_choice_panel,
  });
  const send_prompt = (prompt: string) =>
    void send_chat_message({ message_text: prompt, attachments: [] });

  const render_composer = (placeholder: string, is_new_chat_form = false) => (
    <ChatSessionComposer
      apps={catalog_apps}
      attachments={attachments}
      expanded={is_new_chat_form}
      isStreaming={is_chat_submitting}
      placeholder={placeholder}
      sessionId={session_id}
      waitsForHistory={Boolean(session_id) && messages_query.isPending}
      {...(is_new_chat_form ? { project_id, onProjectChange: set_project_id } : {})}
      onAttachmentRemove={remove_attachment}
      onFilesAdded={(files) => void append_files(files)}
      onSend={() => void send_from_composer()}
      onStop={() => void stop_current_run().then(queued_chat_messages.refresh)}
    />
  );

  return (
    <OpenWorkspaceFileProvider value={panels.open_workspace_file_in_panel}>
      <ChatPaywallDialogs paywall={paywall} session_id={session_id} />
      <ChatSessionGrid
        files_panel_open={panels.files_panel_open}
        files_panel_width={panels.files_panel_width}
        shows_artifact_panel={Boolean(panels.selected_artifact_id && session_id)}
      >
        <main className="flex min-h-0 flex-col">
          <ChatHeader
            has_address={Boolean(session_id)}
            {...(selectedSession ? { selectedSession } : {})}
          />
          <div
            className={cn(
              'min-h-0 flex-1',
              show_onboarding ? '@container/main flex flex-col overflow-y-auto' : 'flex flex-col',
            )}
          >
            {show_onboarding ? (
              <ChatOnboardingHome
                apps={catalog_apps}
                composer={render_composer('Describe a task, or pick one below…', true)}
                on_select_template={send_prompt}
              />
            ) : (
              <>
                {show_session_loading ? (
                  <ChatSessionLoadingSkeleton />
                ) : (
                  <ChatConversationWithRuns
                    runs={runs_query.data}
                    apps={catalog_apps}
                    centerFooter={onboarding.shows_onboarding_starters}
                    {...(connected_apps ? { connectedApps: connected_apps } : {})}
                    footer={chat_conversation_footer({
                      session_id,
                      shows_onboarding_starters: onboarding.shows_onboarding_starters,
                      onboarding_starter_findings: onboarding.onboarding_starter_findings,
                      is_onboarding_intro_settled: onboarding.is_onboarding_intro_settled,
                      select_starter: send_prompt,
                      browser_preview: browser.browser_preview,
                      latest_run,
                    })}
                    hasEarlierMessages={earlier_messages_cursor !== null}
                    isChoiceAnswerable={Boolean(open_choices.choice_job_id)}
                    isLoadingEarlierMessages={earlier_messages.is_loading}
                    isSubmitting={is_chat_submitting || onboarding.is_onboarding_intro_playing}
                    key="conversation"
                    messages={onboarding.revealed_chat_messages}
                    showFullTraces={show_full_traces}
                    ownNewMessageId={unconfirmed_messages.at(-1)?.run_message_id}
                    onArtifactOpen={panels.open_artifact}
                    onChoiceAnswer={open_choices.answer_choice_panel}
                    onLoadEarlierMessages={earlier_messages.load_earlier_messages_on_scroll}
                    {...queued_message_areas(queued_chat_messages, queued_messages)}
                    onReload={run_last_message_again}
                  />
                )}
                <ChatComposerDock>
                  {render_composer(
                    open_choices.choice_panel_open
                      ? open_choices.can_answer_choice_panel
                        ? 'Select an option or reply directly…'
                        : not_answerable_yet_words
                      : 'Send another message…',
                  )}
                </ChatComposerDock>
              </>
            )}
          </div>
        </main>
        <ChatSessionSidePanels
          session_id={session_id}
          files_panel_open={panels.files_panel_open}
          shows_files_panel={panels.shows_files_panel}
          files_workspace_id={panels.files_workspace_id}
          sandbox_previews={browser.sandbox_previews}
          browser_task={{
            run_id: browser.waiting_for_new_run
              ? `pending:${session_id ?? 'session'}`
              : (latest_run_id ?? session_id ?? 'pending'),
            is_active: is_chat_submitting,
            stop: stop_current_run,
          }}
          close_files_panel={() => panels.set_files_panel_open(false)}
          selected_artifact_id={panels.selected_artifact_id}
          selected_artifact_item={panels.selected_artifact_item}
          close_artifact={panels.clear_selected_artifact}
        />
      </ChatSessionGrid>
    </OpenWorkspaceFileProvider>
  );
}
