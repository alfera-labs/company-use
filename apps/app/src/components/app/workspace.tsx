import { public_brand_config } from '@coworker/config/public_env';
import { format_error_message, require_model_use_case_policy } from '@coworker/shared';
import { Badge } from '@coworker/ui/components/badge';
import { Button, buttonVariants } from '@coworker/ui/components/button';
import { Card, CardContent, CardHeader, CardTitle } from '@coworker/ui/components/card';
import { Input } from '@coworker/ui/components/input';
import { ScrollArea } from '@coworker/ui/components/scroll-area';
import { Separator } from '@coworker/ui/components/separator';
import { Skeleton } from '@coworker/ui/components/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@coworker/ui/components/tabs';
import { Textarea } from '@coworker/ui/components/textarea';
import { cn } from '@coworker/ui/lib/utils';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import {
  Bot,
  CircleAlert,
  Clock3,
  Copy,
  ExternalLink,
  FileJson,
  FileText,
  Link2,
  MessageSquare,
  Paperclip,
  PencilLine,
  Plug,
  Plus,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
  SquareTerminal,
  Unplug,
  Wrench,
  X,
} from 'lucide-react';
import { type ClipboardEvent, type DragEvent, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { NewSessionForm } from '@/components/app/new_session_form';
import { useCatalogApps } from '@/components/app/use_catalog_apps';
import {
  type AgentEnabledNode,
  type AgentRunStreamEvent,
  type CatalogApp,
  type CatalogNode,
  type Connection,
  type ConnectionSetupResult,
  type ConnectionSetupState,
  create_connection,
  create_session,
  inspect_run,
  list_agent_enabled_nodes,
  list_agents,
  list_catalog_nodes,
  list_connections,
  list_run_tool_calls,
  list_session_messages,
  list_session_runs,
  list_sessions,
  open_artifact_content,
  type Run,
  type RunInspection,
  type RunMessage,
  reconnect_connection,
  relative_time,
  revoke_connection,
  type SessionMessagePart,
  type SessionMessagePayload,
  stream_session_message,
  type ToolCall,
  update_agent_enabled_nodes,
} from '@/lib/api';
import { query_keys } from '@/lib/api/query_keys';
import { copy_text } from '@/lib/copy_text';

const product_brand_name = public_brand_config.product_brand_name;
const agent_run_reasoning_level = require_model_use_case_policy('agent_run').reasoning_level;
const reasoning_level_options = [
  { reasoning_level: 'off', label: 'No reasoning' },
  { reasoning_level: 'minimal', label: 'Minimal reasoning' },
  { reasoning_level: 'low', label: 'Low reasoning' },
  { reasoning_level: 'medium', label: 'Medium reasoning' },
  { reasoning_level: 'high', label: 'High reasoning' },
  { reasoning_level: 'xhigh', label: 'Max reasoning' },
] as const;

type RunInspectionSnapshot = RunInspection['model_context_snapshots'][number];
type RunInspectionEvent = RunInspection['events'][number];
type RunInspectionToolCall = RunInspection['tool_calls'][number];

type ToolSummaryInput = {
  path?: string | number | boolean;
  pattern?: string | number | boolean;
  command?: string | number | boolean;
  args?: string[];
  port?: number;
  content?: string | number | boolean;
  new_text?: string | number | boolean;
  old_text?: string | number | boolean;
};

type ToolResultDisplay = {
  content_text?: string;
  error_message?: string;
  content_json?: unknown;
};
type RunInspectionMessage = RunInspection['messages'][number];
type RunInspectionArtifact = RunInspection['files'][number];
type ReasoningLevel = NonNullable<SessionMessagePayload['reasoning_level']>;
type ConnectionSetupNotice = {
  tone: 'success' | 'warning' | 'error';
  title: string;
  description: string;
  action_url?: string;
};

type PendingAttachment = {
  id: string;
  name: string;
  mime_type: string;
  byte_size: number;
  part: SessionMessagePart;
};

export function DashboardApp({
  basePath = '',
  initialSessionId,
}: {
  basePath?: string;
  initialSessionId?: string;
}) {
  const navigate = useNavigate();
  const query_client = useQueryClient();
  const [selected_session_id, set_selected_session_id] = useState<string | undefined>(
    initialSessionId,
  );

  const sessions_query = useQuery({
    queryKey: query_keys.sessions(),
    queryFn: list_sessions,
  });
  const agents_query = useQuery({
    queryKey: query_keys.agents(),
    queryFn: list_agents,
  });

  const selected_session = useMemo(() => {
    return sessions_query.data?.find((session) => session.session_id === selected_session_id);
  }, [sessions_query.data, selected_session_id]);

  useEffect(() => {
    if (!selected_session_id && sessions_query.data?.[0]) {
      set_selected_session_id(sessions_query.data[0].session_id);
    }
  }, [sessions_query.data, selected_session_id]);

  const create_session_mutation = useMutation({
    mutationFn: () => create_session({}),
    onSuccess: async (session) => {
      await query_client.invalidateQueries({ queryKey: query_keys.sessions() });
      set_selected_session_id(session.session_id);
      navigate({ href: `${basePath}/sessions/${session.session_id}` });
    },
  });

  function select_session(session_id: string) {
    set_selected_session_id(session_id);
    navigate({ href: `${basePath}/sessions/${session_id}` });
  }

  return (
    <main className="grid min-h-screen grid-cols-[300px_minmax(0,1fr)] bg-background text-foreground max-lg:grid-cols-1">
      <aside className="flex min-h-screen flex-col border-r bg-sidebar p-4 max-lg:h-80 max-lg:min-h-0 max-lg:border-r-0 max-lg:border-b">
        <div className="flex items-center gap-3 px-1 py-2">
          <div className="grid size-9 place-items-center rounded-2xl bg-sidebar-primary text-sm font-semibold text-sidebar-primary-foreground">
            {product_brand_name.slice(0, 1)}
          </div>
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold">{product_brand_name}</div>
            <div className="truncate text-xs text-muted-foreground">AI workspace</div>
          </div>
        </div>

        <Button
          className="mt-4 w-full justify-start"
          type="button"
          onClick={() => create_session_mutation.mutate()}
        >
          <Plus />
          New session
        </Button>

        <ScrollArea className="mt-4 min-h-0 flex-1 pr-2">
          <div className="flex flex-col gap-1">
            {sessions_query.isLoading ? <SessionSkeleton /> : null}
            {sessions_query.data?.map((session) => (
              <button
                className={cn(
                  'grid min-h-14 w-full grid-cols-[18px_minmax(0,1fr)] items-start gap-2 rounded-2xl px-3 py-2 text-left text-sm transition-colors hover:bg-sidebar-accent',
                  session.session_id === selected_session_id && 'bg-sidebar-accent',
                )}
                key={session.session_id}
                type="button"
                onClick={() => select_session(session.session_id)}
              >
                <MessageSquare className="mt-0.5 size-4 text-muted-foreground" />
                <span className="min-w-0">
                  <span className="block truncate font-medium">
                    {session.session_title ?? 'Untitled session'}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {relative_time(session.last_message_time ?? session.last_updated_time)}
                  </span>
                </span>
              </button>
            ))}
            {sessions_query.data?.length === 0 ? (
              <div className="rounded-2xl border border-dashed p-3 text-sm text-muted-foreground">
                No sessions yet.
              </div>
            ) : null}
          </div>
        </ScrollArea>

        <Separator className="my-4" />
        <div className="space-y-2 px-1 text-xs text-muted-foreground">
          <div className="flex items-center justify-between gap-3">
            <span>Main agent</span>
            <span className="truncate text-foreground">
              {agents_query.data?.[0]?.agent_name ?? '...'}
            </span>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span>Model</span>
            <span className="truncate text-foreground">
              {agents_query.data?.[0]?.default_model_route?.model_name ??
                agents_query.data?.[0]?.default_model_name ??
                agents_query.data?.[0]?.default_model ??
                'Recommended'}
            </span>
          </div>
        </div>
      </aside>

      <section className="min-w-0 p-5">
        <header className="flex min-h-14 items-center justify-between gap-4 border-b pb-4">
          <div className="min-w-0">
            <div className="text-xs font-medium uppercase tracking-normal text-muted-foreground">
              Session
            </div>
            <h1 className="mt-1 truncate text-2xl font-semibold tracking-normal">
              {selected_session?.session_title ?? 'Create a session'}
            </h1>
          </div>
          <StatusBadge value={selected_session?.session_status ?? 'idle'} />
        </header>

        {selected_session_id ? (
          <SessionDetail
            session_id={selected_session_id}
            {...((selected_session?.agent_id ?? agents_query.data?.[0]?.agent_id)
              ? { agent_id: selected_session?.agent_id ?? agents_query.data?.[0]?.agent_id }
              : {})}
          />
        ) : (
          <Card className="mt-5 rounded-2xl">
            <CardContent className="flex min-h-56 flex-col items-center justify-center gap-5 py-10">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Bot className="size-5" />
                Start a session to put your coworker to work.
              </div>
              <NewSessionForm basePath={basePath} />
            </CardContent>
          </Card>
        )}
      </section>
    </main>
  );
}

function SessionDetail({
  session_id,
  agent_id,
}: {
  session_id: string;
  agent_id?: string | undefined;
}) {
  const query_client = useQueryClient();
  const file_input_ref = useRef<HTMLInputElement>(null);
  const [message, set_message] = useState('');
  const [attachments, set_attachments] = useState<PendingAttachment[]>([]);
  const [reasoning_level, set_reasoning_level] =
    useState<ReasoningLevel>(agent_run_reasoning_level);
  const [selected_run_id, set_selected_run_id] = useState<string | undefined>();
  const [connection_setup_notice, set_connection_setup_notice] =
    useState<ConnectionSetupNotice | null>(null);
  const [streaming_response, set_streaming_response] = useState<{
    run_id: string;
    text: string;
  } | null>(null);

  const runs_query = useQuery({
    queryKey: query_keys.runs(session_id),
    queryFn: () => list_session_runs(session_id),
    refetchInterval: (query) => (should_poll_runs(query.state.data) ? 1500 : false),
  });
  const latest_run = runs_query.data?.[0];
  const inspected_run =
    runs_query.data?.find((run) => run.run_id === selected_run_id) ?? latest_run;
  const inspected_run_id = inspected_run?.run_id;
  const should_poll_runtime = Boolean(
    latest_run && ['queued', 'running'].includes(latest_run.run_status),
  );
  const should_poll_inspected_run = Boolean(
    inspected_run && ['queued', 'running'].includes(inspected_run.run_status),
  );

  useEffect(() => {
    if (!runs_query.data) return;
    set_selected_run_id((current) => {
      if (current && runs_query.data.some((run) => run.run_id === current)) return current;
      return latest_run?.run_id;
    });
  }, [latest_run?.run_id, runs_query.data]);

  const messages_query = useQuery({
    queryKey: query_keys.messages(session_id),
    queryFn: async () => (await list_session_messages(session_id)).items,
    refetchInterval: should_poll_runtime ? 1500 : false,
  });
  const tool_calls_query = useQuery({
    queryKey: query_keys.tool_calls(inspected_run_id),
    queryFn: () => list_run_tool_calls(inspected_run_id ?? ''),
    enabled: Boolean(inspected_run_id),
    refetchInterval: should_poll_inspected_run ? 1500 : false,
  });
  const run_inspection_query = useQuery({
    queryKey: query_keys.run_inspection(inspected_run_id),
    queryFn: () => inspect_run(inspected_run_id ?? ''),
    enabled: Boolean(inspected_run_id),
    refetchInterval: should_poll_inspected_run ? 1500 : false,
  });
  const apps_query = useCatalogApps();
  const nodes_query = useQuery({
    queryKey: query_keys.nodes(),
    queryFn: () => list_catalog_nodes(),
  });
  const connections_query = useQuery({
    queryKey: query_keys.connections(),
    queryFn: list_connections,
  });
  const enabled_nodes_query = useQuery({
    queryKey: query_keys.enabled_nodes(agent_id),
    queryFn: () => list_agent_enabled_nodes(agent_id ?? ''),
    enabled: Boolean(agent_id),
  });
  const create_connection_mutation = useMutation({
    mutationFn: (app: CatalogApp) => {
      const provider_profile = first_connection_profile(app);
      return create_connection({
        app_id: app.app_id,
        ...(provider_profile?.provider_key ? { provider_key: provider_profile.provider_key } : {}),
        ...(provider_profile?.provider_config_key
          ? { provider_config_key: provider_profile.provider_config_key }
          : {}),
        ...(provider_profile?.connection_profile_key
          ? { connection_profile_key: provider_profile.connection_profile_key }
          : {}),
      });
    },
    onSuccess: async (result) => {
      show_connection_setup_result(result, 'Connection setup started');
      await query_client.invalidateQueries({ queryKey: query_keys.connections() });
    },
    onError: (error) => {
      show_connection_setup_error(error, 'Connection setup failed');
    },
  });
  const revoke_connection_mutation = useMutation({
    mutationFn: revoke_connection,
    onSuccess: async () => {
      set_connection_setup_notice({
        tone: 'success',
        title: 'Connection revoked',
        description: 'The connection can no longer execute tools until it is reconnected.',
      });
      await query_client.invalidateQueries({ queryKey: query_keys.connections() });
    },
    onError: (error) => {
      show_connection_setup_error(error, 'Revoke failed');
    },
  });
  const reconnect_connection_mutation = useMutation({
    mutationFn: (connection_id: string) => reconnect_connection(connection_id),
    onSuccess: async (result) => {
      show_connection_setup_result(result, 'Reconnect setup started');
      await query_client.invalidateQueries({ queryKey: query_keys.connections() });
    },
    onError: (error) => {
      show_connection_setup_error(error, 'Reconnect failed');
    },
  });
  const update_enabled_nodes_mutation = useMutation({
    mutationFn: (enabled_nodes: AgentEnabledNode[]) =>
      update_agent_enabled_nodes(agent_id ?? '', enabled_nodes),
    onSuccess: async () => {
      await query_client.invalidateQueries({ queryKey: query_keys.enabled_nodes(agent_id) });
    },
  });

  function enable_catalog_node(node: CatalogNode) {
    if (!agent_id) return;
    const current_nodes = enabled_nodes_query.data ?? [];
    if (current_nodes.some((item) => item.node_key === node.node_key)) return;

    update_enabled_nodes_mutation.mutate([
      ...current_nodes,
      {
        node_key: node.node_key,
        provider_key: node.provider_key as AgentEnabledNode['provider_key'],
        status: 'enabled',
        connection_selector: node.connection_profile_key
          ? { strategy: 'latest_active_matching_connection' }
          : { strategy: 'no_connection_required' },
        input_defaults: {},
        approval_policy_override: null,
      },
    ]);
  }

  function disable_catalog_node(node_key: string) {
    const current_nodes = enabled_nodes_query.data ?? [];
    update_enabled_nodes_mutation.mutate(
      current_nodes.filter((item) => item.node_key !== node_key),
    );
  }

  function show_connection_setup_result(result: ConnectionSetupResult, title: string) {
    const action_url = result.start_url;

    set_connection_setup_notice({
      tone: result.setup.setup_error ? 'warning' : 'success',
      title,
      description: connection_setup_description(result.setup),
      ...(action_url ? { action_url } : {}),
    });
  }

  function show_connection_setup_error(error: unknown, title: string) {
    set_connection_setup_notice({
      tone: 'error',
      title,
      description: format_error_message(error, 'The request failed.'),
    });
  }
  const visible_messages = useMemo(
    () =>
      messages_query.data?.filter(
        (item) =>
          ['user', 'assistant'].includes(item.message_role) && is_visible_chat_message(item),
      ) ?? [],
    [messages_query.data],
  );
  const chat_items = useMemo(
    () =>
      create_chat_items({
        messages: visible_messages,
        ...(streaming_response?.text ? { streaming_response } : {}),
        tool_calls: tool_calls_query.data ?? [],
        ...(inspected_run_id === undefined ? {} : { inspected_run_id }),
      }),
    [inspected_run_id, streaming_response, tool_calls_query.data, visible_messages],
  );

  function apply_stream_event(event: AgentRunStreamEvent) {
    if (event.type === 'run_created' || event.type === 'run_updated') {
      query_client.setQueryData<Run[]>(query_keys.runs(session_id), (runs) =>
        upsert_run(runs, event.run),
      );
      if (event.type === 'run_created') set_selected_run_id(event.run.run_id);
      return;
    }

    if (event.type === 'message_created') {
      query_client.setQueryData<RunMessage[]>(query_keys.messages(session_id), (messages) =>
        upsert_message(messages, event.message),
      );

      return;
    }

    if (event.type === 'chat_event') {
      const text_delta = chat_event_text_delta(event);
      if (text_delta) {
        set_streaming_response((current) => ({
          run_id: event.run_id,
          text: current?.run_id === event.run_id ? `${current.text}${text_delta}` : text_delta,
        }));
      }
    }
  }

  const send_message = useMutation({
    mutationFn: (draft: {
      message_text: string;
      attachments: PendingAttachment[];
      reasoning_level: ReasoningLevel;
    }) =>
      stream_session_message(
        session_id,
        create_message_payload(draft.message_text, draft.attachments, draft.reasoning_level),
        apply_stream_event,
      ),
    onMutate: () => {
      set_message('');
      set_attachments([]);
      set_streaming_response(null);
    },
    onSuccess: async () => {
      await Promise.all([
        query_client.invalidateQueries({ queryKey: query_keys.messages(session_id) }),
        query_client.invalidateQueries({ queryKey: query_keys.runs(session_id) }),
        query_client.invalidateQueries({ queryKey: query_keys.tool_calls() }),
        query_client.invalidateQueries({ queryKey: query_keys.run_inspection() }),
        query_client.invalidateQueries({ queryKey: query_keys.sessions() }),
      ]);
      set_streaming_response(null);
    },
    onError: (error, draft) => {
      set_message(draft.message_text);
      set_attachments(draft.attachments);
      set_streaming_response(null);
      toast.error(format_error_message(error, 'The run could not be completed.'));
    },
  });

  async function append_files(files: Iterable<File>) {
    const selected_files = [...files];
    if (selected_files.length === 0) return;

    const next_attachments = await Promise.all(
      selected_files.slice(0, 20).map((file) => create_pending_attachment(file)),
    );
    set_attachments((current) => [...current, ...next_attachments].slice(0, 20));
  }

  async function attach_selected_files(files: FileList | null) {
    if (!files?.length) return;

    await append_files(files);
    if (file_input_ref.current) file_input_ref.current.value = '';
  }

  function attach_pasted_files(event: ClipboardEvent<HTMLTextAreaElement>) {
    const files = files_from_data_transfer(event.clipboardData);
    if (files.length === 0) return;

    event.preventDefault();
    void append_files(files);
  }

  function attach_dropped_files(event: DragEvent<HTMLFormElement>) {
    const files = files_from_data_transfer(event.dataTransfer);
    if (files.length === 0) return;

    event.preventDefault();
    void append_files(files);
  }

  return (
    <div className="grid h-[calc(100vh-94px)] grid-cols-[minmax(420px,1fr)_640px] gap-4 pt-4 max-2xl:grid-cols-[minmax(0,1fr)_560px] max-xl:h-auto max-xl:grid-cols-1">
      <Card className="grid min-h-0 grid-rows-[minmax(0,1fr)_auto] gap-0 rounded-2xl py-0">
        <ScrollArea className="min-h-0">
          <div className="flex min-h-[420px] flex-col gap-3 p-4">
            {messages_query.error ? (
              <QueryError label="Messages" onRetry={() => messages_query.refetch()} />
            ) : null}
            {messages_query.isLoading ? <MessageSkeleton /> : null}
            {chat_items.map((item) =>
              item.type === 'message' ? (
                <MessageBubble key={item.message.run_message_id} message={item.message} />
              ) : item.type === 'streaming_message' ? (
                <StreamingMessageBubble key={`streaming-${item.run_id}`} text={item.text} />
              ) : (
                <ToolActivityList key={`tools-${item.run_id}`} tool_calls={item.tool_calls} />
              ),
            )}
            {messages_query.data && chat_items.length === 0 ? (
              <div className="m-auto text-sm text-muted-foreground">No messages yet.</div>
            ) : null}
          </div>
        </ScrollArea>
        <form
          className="grid grid-cols-[minmax(0,1fr)_42px_42px] gap-2 border-t p-3"
          onSubmit={(event) => {
            event.preventDefault();
            const message_text = message.trim();
            if (message_text || attachments.length > 0) {
              send_message.mutate({ message_text, attachments, reasoning_level });
            }
          }}
          onDragOver={(event) => {
            if (files_from_data_transfer(event.dataTransfer).length > 0) event.preventDefault();
          }}
          onDrop={attach_dropped_files}
        >
          <div className="min-w-0 space-y-2">
            <Textarea
              className="min-h-11 py-3"
              value={message}
              onChange={(event) => set_message(event.target.value)}
              onPaste={attach_pasted_files}
              placeholder={`Ask ${product_brand_name} to do something`}
            />
            <div className="flex min-h-8 flex-wrap items-center gap-2">
              <select
                aria-label="Reasoning level"
                className="h-8 rounded-2xl border bg-background px-2 text-xs"
                value={reasoning_level}
                onChange={(event) => set_reasoning_level(event.target.value as ReasoningLevel)}
              >
                {reasoning_level_options.map((option) => (
                  <option key={option.reasoning_level} value={option.reasoning_level}>
                    {option.label}
                  </option>
                ))}
              </select>
              {attachments.map((attachment) => (
                <button
                  className="inline-flex h-8 max-w-56 items-center gap-1 rounded-2xl border px-2 text-xs"
                  key={attachment.id}
                  type="button"
                  onClick={() =>
                    set_attachments((current) =>
                      current.filter((item) => item.id !== attachment.id),
                    )
                  }
                >
                  <FileText className="size-3.5 shrink-0" />
                  <span className="truncate">{attachment.name}</span>
                  <X className="size-3 shrink-0 text-muted-foreground" />
                </button>
              ))}
            </div>
          </div>
          <input
            className="hidden"
            multiple
            ref={file_input_ref}
            type="file"
            onChange={(event) => void attach_selected_files(event.currentTarget.files)}
          />
          <Button
            aria-label="Attach files"
            className="size-11 self-end"
            size="icon"
            type="button"
            variant="outline"
            onClick={() => file_input_ref.current?.click()}
          >
            <Paperclip />
          </Button>
          <Button
            aria-label="Send message"
            className="size-11 self-end"
            size="icon"
            type="submit"
            disabled={(!message.trim() && attachments.length === 0) || send_message.isPending}
          >
            <Send />
          </Button>
        </form>
      </Card>

      <aside className="min-w-0">
        <Tabs defaultValue="runs" className="h-full">
          <TabsList className="grid w-full grid-cols-3 rounded-2xl">
            <TabsTrigger value="runs">Runs</TabsTrigger>
            <TabsTrigger value="tools">Tools</TabsTrigger>
            <TabsTrigger value="catalog">Catalog</TabsTrigger>
          </TabsList>

          <TabsContent value="runs" className="mt-3 space-y-3">
            <TraceCard icon={<FileJson className="size-4" />} title="Run Inspector">
              {run_inspection_query.error ? (
                <QueryError label="Run inspector" onRetry={() => run_inspection_query.refetch()} />
              ) : null}
              <RunInspector inspection={run_inspection_query.data} />
            </TraceCard>
            <TraceCard icon={<Clock3 className="size-4" />} title="Runs">
              {runs_query.error ? (
                <QueryError label="Runs" onRetry={() => runs_query.refetch()} />
              ) : null}
              {runs_query.data?.map((run) => (
                <RunRow
                  is_selected={run.run_id === inspected_run_id}
                  key={run.run_id}
                  run={run}
                  onSelect={() => set_selected_run_id(run.run_id)}
                />
              ))}
              {runs_query.data?.length === 0 ? <EmptyTrace text="No runs yet." /> : null}
            </TraceCard>
          </TabsContent>

          <TabsContent value="tools" className="mt-3 space-y-3">
            <TraceCard icon={<ShieldCheck className="size-4" />} title="Agent Tools">
              <AgentToolsPanel
                connections={connections_query.data ?? []}
                enabled_nodes={enabled_nodes_query.data ?? []}
                nodes={nodes_query.data ?? []}
                onDisableNode={disable_catalog_node}
                onEnableNode={enable_catalog_node}
              />
            </TraceCard>
            <TraceCard icon={<Wrench className="size-4" />} title="Latest Tool Calls">
              {tool_calls_query.error ? (
                <QueryError label="Tool calls" onRetry={() => tool_calls_query.refetch()} />
              ) : null}
              {tool_calls_query.data?.map((tool_call) => (
                <ToolCallRow key={tool_call.tool_call_id} tool_call={tool_call} />
              ))}
              {tool_calls_query.data?.length === 0 ? (
                <EmptyTrace text="No tool calls yet." />
              ) : null}
            </TraceCard>
          </TabsContent>

          <TabsContent value="catalog" className="mt-3 space-y-3">
            <TraceCard icon={<Plug className="size-4" />} title="Catalog">
              {apps_query.error || nodes_query.error || connections_query.error ? (
                <QueryError
                  label="Catalog"
                  onRetry={() => {
                    apps_query.refetch();
                    nodes_query.refetch();
                    connections_query.refetch();
                  }}
                />
              ) : null}
              <MetricRow label="Apps" value={String(apps_query.data?.length ?? 0)} />
              <MetricRow label="Nodes" value={String(nodes_query.data?.length ?? 0)} />
              <MetricRow label="Connections" value={String(connections_query.data?.length ?? 0)} />
            </TraceCard>
            <TraceCard icon={<Link2 className="size-4" />} title="Connections">
              <ConnectionsPanel
                apps={apps_query.data ?? []}
                connections={connections_query.data ?? []}
                is_connecting={create_connection_mutation.isPending}
                is_reconnecting={reconnect_connection_mutation.isPending}
                setup_notice={connection_setup_notice}
                onConnect={(app) => create_connection_mutation.mutate(app)}
                onReconnect={(connection_id) => reconnect_connection_mutation.mutate(connection_id)}
                onRevoke={(connection_id) => revoke_connection_mutation.mutate(connection_id)}
              />
            </TraceCard>
            <TraceCard icon={<Wrench className="size-4" />} title="Nodes">
              {nodes_query.data?.map((node) => (
                <div className="rounded-2xl border p-3" key={node.node_id}>
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0 truncate text-sm font-medium">
                      {node.node_display_name}
                    </div>
                    <StatusBadge value={node.node_status} />
                  </div>
                  <div className="mt-1 truncate text-xs text-muted-foreground">
                    {node.provider_key} · {node.node_runtime ?? node.node_kind} ·{' '}
                    {node.runtime_handler}
                  </div>
                </div>
              ))}
            </TraceCard>
          </TabsContent>
        </Tabs>
      </aside>
    </div>
  );
}

function should_poll_runs(data: Run[] | undefined) {
  const latest_run = data?.[0];
  return Boolean(latest_run && ['queued', 'running'].includes(latest_run.run_status));
}

function upsert_message(messages: RunMessage[] | undefined, message: RunMessage) {
  const next_messages = messages ? [...messages] : [];
  const existing_index = next_messages.findIndex(
    (item) => item.run_message_id === message.run_message_id,
  );

  if (existing_index === -1) next_messages.push(message);
  else next_messages[existing_index] = message;

  return next_messages.sort((left, right) => left.message_sequence - right.message_sequence);
}

function create_message_payload(
  message_text: string,
  attachments: PendingAttachment[],
  reasoning_level: ReasoningLevel,
): SessionMessagePayload {
  const images = attachments
    .map((item) => item.part)
    .filter(
      (part): part is Extract<SessionMessagePart, { type: 'image' }> => part.type === 'image',
    );
  const content = attachments
    .map((item) => item.part)
    .filter(
      (part): part is Exclude<SessionMessagePart, { type: 'image' }> => part.type !== 'image',
    );

  return {
    ...(message_text ? { message: message_text } : {}),
    ...(content.length === 0 ? {} : { content }),
    ...(images.length === 0 ? {} : { images }),
    reasoning_level,
  };
}

function files_from_data_transfer(data_transfer: DataTransfer) {
  const direct_files = Array.from(data_transfer.files ?? []);
  if (direct_files.length > 0) return direct_files;

  return Array.from(data_transfer.items ?? [])
    .filter((item) => item.kind === 'file')
    .map((item) => item.getAsFile())
    .filter((file): file is File => file !== null);
}

async function create_pending_attachment(file: File): Promise<PendingAttachment> {
  const mime_type = file.type || mime_type_from_file_name(file.name);
  const part = mime_type.startsWith('image/')
    ? await image_file_to_message_part(file, mime_type)
    : await document_file_to_message_part(file, mime_type);

  return {
    id: `${file.name}:${file.size}:${file.lastModified}:${Math.random().toString(16).slice(2)}`,
    name: file.name,
    mime_type,
    byte_size: file.size,
    part,
  };
}

async function image_file_to_message_part(
  file: File,
  mime_type: string,
): Promise<SessionMessagePart> {
  const data_url = await read_file_as_data_url(file);
  return {
    type: 'image',
    data: data_url_to_base64(data_url),
    mime_type,
    detail: 'high',
    source: file.name,
  };
}

async function document_file_to_message_part(
  file: File,
  mime_type: string,
): Promise<SessionMessagePart> {
  const text = is_text_like_file(file, mime_type)
    ? truncate_text(await file.text(), 50_000)
    : `[attached document: ${file.name}; mime_type=${mime_type}; byte_size=${file.size}; text extraction unavailable in the browser]`;

  return {
    type: 'file',
    name: file.name,
    mime_type,
    text,
  };
}

function read_file_as_data_url(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error ?? new Error(`Failed to read ${file.name}`));
    reader.readAsDataURL(file);
  });
}

function data_url_to_base64(data_url: string) {
  const comma_index = data_url.indexOf(',');
  return comma_index === -1 ? data_url : data_url.slice(comma_index + 1);
}

function is_text_like_file(file: File, mime_type: string) {
  const extension = file.name.split('.').pop()?.toLowerCase();
  return (
    mime_type.startsWith('text/') ||
    [
      'application/json',
      'application/ld+json',
      'application/xml',
      'application/yaml',
      'application/x-yaml',
    ].includes(mime_type) ||
    new Set([
      'c',
      'css',
      'csv',
      'go',
      'html',
      'java',
      'js',
      'json',
      'jsx',
      'log',
      'md',
      'py',
      'rb',
      'rs',
      'sql',
      'toml',
      'ts',
      'tsx',
      'txt',
      'xml',
      'yaml',
      'yml',
    ]).has(extension ?? '')
  );
}

function mime_type_from_file_name(file_name: string) {
  const extension = file_name.split('.').pop()?.toLowerCase();
  if (extension === 'md') return 'text/markdown';
  if (extension === 'json') return 'application/json';
  if (extension === 'csv') return 'text/csv';
  if (extension === 'pdf') return 'application/pdf';
  return 'application/octet-stream';
}

function upsert_run(runs: Run[] | undefined, run: Run) {
  const next_runs = runs ? [...runs] : [];
  const existing_index = next_runs.findIndex((item) => item.run_id === run.run_id);

  if (existing_index === -1) next_runs.push(run);
  else next_runs[existing_index] = run;

  return next_runs.sort(
    (left, right) => new Date(right.created_time).getTime() - new Date(left.created_time).getTime(),
  );
}

type ChatTimelineItem =
  | { type: 'message'; message: RunMessage }
  | { type: 'streaming_message'; run_id: string; text: string }
  | { type: 'tools'; run_id: string; tool_calls: ToolCall[] };

function create_chat_items(input: {
  messages: RunMessage[];
  streaming_response?: { run_id: string; text: string };
  tool_calls: ToolCall[];
  inspected_run_id?: string;
}): ChatTimelineItem[] {
  const inspected_run_id = input.inspected_run_id;
  const streaming_response =
    input.streaming_response?.text.trim() &&
    (!inspected_run_id || input.streaming_response.run_id === inspected_run_id)
      ? input.streaming_response
      : undefined;
  const run_id = inspected_run_id ?? streaming_response?.run_id;
  const run_tool_calls = run_id
    ? input.tool_calls.filter((tool_call) => tool_call.run_id === run_id)
    : [];
  const items: ChatTimelineItem[] = [];

  for (const message of input.messages) {
    if (
      streaming_response &&
      message.run_id === streaming_response.run_id &&
      message.message_role === 'assistant'
    ) {
      continue;
    }

    items.push({ type: 'message', message });
  }

  if (streaming_response) {
    items.push({
      run_id: streaming_response.run_id,
      text: streaming_response.text,
      type: 'streaming_message',
    });
  }

  if (run_id && run_tool_calls.length > 0) {
    items.push({ type: 'tools', run_id, tool_calls: run_tool_calls });
  }

  return items;
}

function MessageBubble({ message }: { message: RunMessage }) {
  const text = format_chat_text(get_chat_message_text(message.message_content));
  const is_user = message.message_role === 'user';

  return (
    <div className={cn('flex', is_user ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'max-w-[min(760px,92%)] rounded-2xl border px-3 py-2 text-sm leading-6',
          is_user ? 'bg-primary text-primary-foreground' : 'bg-card',
        )}
      >
        <div
          className={cn(
            'mb-1 text-xs',
            is_user ? 'text-primary-foreground' : 'text-muted-foreground',
          )}
        >
          {message.message_role}
        </div>
        <p className="m-0 whitespace-pre-wrap break-words">{text}</p>
      </div>
    </div>
  );
}

function StreamingMessageBubble({ text }: { text: string }) {
  return (
    <div className="flex justify-start">
      <div className="max-w-[min(760px,92%)] rounded-2xl border bg-card px-3 py-2 text-sm leading-6">
        <div className="mb-1 text-xs text-muted-foreground">assistant</div>
        <p className="m-0 whitespace-pre-wrap break-words">{format_chat_text(text)}</p>
      </div>
    </div>
  );
}

function ToolActivityList({ tool_calls }: { tool_calls: ToolCall[] }) {
  if (tool_calls.length === 0) return null;

  return (
    <div className="flex justify-start">
      <div className="grid max-w-[min(760px,92%)] gap-1 py-1 text-xs text-muted-foreground">
        {tool_calls.map((tool_call) => (
          <ToolActivityRow key={tool_call.tool_call_id} tool_call={tool_call} />
        ))}
      </div>
    </div>
  );
}

function ToolActivityRow({ tool_call }: { tool_call: ToolCall }) {
  const summary = summarize_tool_call(tool_call);
  const delta = tool_call_delta(tool_call);
  const is_failed = tool_call.tool_status === 'failed' || Boolean(tool_call.error_message);

  return (
    <div className="grid min-h-6 grid-cols-[18px_minmax(0,1fr)_auto] items-center gap-2">
      {tool_call_icon(tool_call)}
      <span className={cn('truncate', is_failed && 'text-destructive')}>{summary}</span>
      {delta ? <span className="font-mono text-[11px] text-positive-ink">{delta}</span> : null}
    </div>
  );
}

function format_chat_text(text: string) {
  return text.replace(/\s+Tools:\s*none\.$/u, '.');
}

function is_visible_chat_message(message: RunMessage) {
  if (message.is_user_visible === false) return false;
  if (message.message_role !== 'assistant') return true;
  if (message.message_content.data?.has_visible_text === false) return false;
  if (message.source_metadata.has_visible_text === false) return false;
  const text = get_chat_message_text(message.message_content).trim();
  return text.length > 0;
}

function get_chat_message_text(content: RunMessage['message_content']) {
  if (content.text) return content.text;
  const part_text = (content.parts ?? [])
    .map((part) => {
      if (part.type === 'text') return part.text;
      if (part.type === 'image') {
        return `[image${part.source ? `: ${part.source}` : ''}]`;
      }
      if (part.type === 'file') {
        return `[file${part.name ? `: ${part.name}` : ''}]`;
      }
      if (part.type === 'tool_result') {
        return tool_result_part_text(part);
      }
      return '';
    })
    .filter(Boolean)
    .join('\n');
  return part_text;
}

function get_message_content_text(content: RunMessage['message_content']) {
  const chat_text = get_chat_message_text(content);
  if (chat_text) return chat_text;

  if (content.data !== undefined) return JSON.stringify(content.data);

  return JSON.stringify(content);
}

function tool_result_part_text(
  part: Extract<
    NonNullable<RunMessage['message_content']['parts']>[number],
    { type: 'tool_result' }
  >,
) {
  const tool_name = part.tool_name ?? 'tool';
  const result = part.result as ToolResultDisplay;
  if (result.content_text?.trim()) {
    return `[${tool_name}] ${result.content_text}`;
  }
  if (result.error_message?.trim()) {
    return `[${tool_name}] ${result.error_message}`;
  }
  if (result.content_json !== undefined)
    return `[${tool_name}] ${stringify_pretty(result.content_json)}`;
  return `[${tool_name}] ${stringify_pretty(part.result)}`;
}

function summarize_tool_call(tool_call: ToolCall) {
  const input = tool_call.input_data as ToolSummaryInput;
  const path_value = String(input.path ?? '');

  if (is_named_tool(tool_call.tool_name, 'sandbox-write', 'workspace-write_file')) {
    return `Wrote ${format_workspace_display_path(path_value || 'file')}`;
  }
  if (is_named_tool(tool_call.tool_name, 'sandbox-edit', 'workspace-edit_file')) {
    return `Edited ${format_workspace_display_path(path_value || 'file')}`;
  }
  if (is_named_tool(tool_call.tool_name, 'sandbox-read', 'workspace-read_file')) {
    return `Read ${format_workspace_display_path(path_value || 'file')}`;
  }
  if (is_named_tool(tool_call.tool_name, 'sandbox-view_image', 'workspace-view_image')) {
    return `Viewed ${format_workspace_display_path(path_value || 'image')}`;
  }
  if (is_named_tool(tool_call.tool_name, 'sandbox-list', 'workspace-list_files')) {
    return `Listed ${format_workspace_display_path(path_value || '.')}`;
  }
  if (is_named_tool(tool_call.tool_name, 'sandbox-grep', 'workspace-grep')) {
    return `Searched ${format_workspace_display_path(path_value || '.')}`;
  }
  if (is_named_tool(tool_call.tool_name, 'sandbox-glob', 'workspace-glob')) {
    return `Found ${String(input.pattern ?? '') || 'paths'}`;
  }
  if (is_named_tool(tool_call.tool_name, 'sandbox-exec', 'workspace-run_command')) {
    const command = String(input.command ?? '') || 'command';
    const args = input.args ?? [];
    return `Ran ${truncate_text([command, ...args].join(' '), 110)}`;
  }
  if (is_named_tool(tool_call.tool_name, 'sandbox-preview', 'workspace-preview')) {
    const port = typeof input.port === 'number' ? input.port : 3000;
    return `Started preview on port ${port}`;
  }

  return tool_call.tool_name;
}

function tool_call_delta(tool_call: ToolCall) {
  const input = tool_call.input_data as ToolSummaryInput;
  if (is_named_tool(tool_call.tool_name, 'sandbox-write', 'workspace-write_file')) {
    const content = String(input.content ?? '');
    const line_count = count_lines(content);
    return line_count > 0 ? `+${line_count}` : undefined;
  }
  if (is_named_tool(tool_call.tool_name, 'sandbox-edit', 'workspace-edit_file')) {
    const added = count_lines(String(input.new_text ?? ''));
    const removed = count_lines(String(input.old_text ?? ''));
    if (added === 0 && removed === 0) return undefined;
    return [`+${added}`, `-${removed}`].join(' ');
  }

  return undefined;
}

function tool_call_icon(tool_call: ToolCall) {
  const is_failed = tool_call.tool_status === 'failed' || Boolean(tool_call.error_message);
  if (is_failed) return <CircleAlert className="size-3.5 text-destructive" />;
  if (
    is_named_tool(
      tool_call.tool_name,
      'sandbox-exec',
      'workspace-run_command',
      'sandbox-preview',
      'workspace-preview',
    )
  ) {
    return <SquareTerminal className="size-3.5" />;
  }
  if (
    is_named_tool(tool_call.tool_name, 'sandbox-write', 'workspace-write_file') ||
    is_named_tool(tool_call.tool_name, 'sandbox-edit', 'workspace-edit_file')
  ) {
    return <PencilLine className="size-3.5" />;
  }
  return <FileText className="size-3.5" />;
}

function is_named_tool(tool_name: string, ...names: string[]) {
  return names.includes(tool_name);
}

function format_workspace_display_path(value: string) {
  return value
    .replace(/^\/work\/repo\//u, '')
    .replace(/^\/work\//u, '')
    .replace(/^repo\//u, '');
}

function count_lines(value: string) {
  if (!value) return 0;
  const normalized = value.endsWith('\n') ? value.slice(0, -1) : value;
  return normalized.length === 0 ? 0 : normalized.split(/\r?\n/u).length;
}

function filter_inspection_items<T>(items: T[], filter_text: string) {
  const query = filter_text.trim().toLowerCase();
  if (!query) return items;

  return items.filter((item) => stringify_searchable(item).includes(query));
}

function is_browsable_run_event(event: RunInspectionEvent) {
  if (event.event_type !== 'progress') return true;
  return !internal_runtime_event_labels.has(event.event_label ?? '');
}

const internal_runtime_event_labels = new Set([
  'pi.agent_start',
  'pi.turn_start',
  'pi.message_start',
  'pi.turn_end',
  'pi.agent_end',
]);

function stringify_searchable(value: unknown) {
  return stringify_pretty(value).toLowerCase();
}

type SnapshotArtifactIdentity = {
  id?: string | number | boolean;
  tool_call_id?: string | number | boolean;
  tool_name?: string | number | boolean;
  role?: string | number | boolean;
};

type SnapshotMessage = SnapshotArtifactIdentity & {
  content?: Array<{ text?: string }>;
};

type SnapshotTool = SnapshotArtifactIdentity & {
  description?: string;
};

function summarize_runtime_message(value: SnapshotMessage) {
  const text = (value.content ?? [])
    .map((part) => {
      return part.text || summarize_unknown(part);
    })
    .join('\n')
    .trim();

  return text || summarize_unknown(value);
}

function summarize_unknown(value: unknown) {
  return truncate_text(stringify_pretty(value).replace(/\s+/gu, ' '), 180);
}

function stringify_pretty(value: unknown) {
  if (typeof value === 'string') return value;

  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
}

function truncate_text(value: string, max_length: number) {
  if (value.length <= max_length) return value;
  return `${value.slice(0, max_length - 3)}...`;
}

function chat_event_text_delta(event: AgentRunStreamEvent) {
  if (event.type !== 'chat_event' || event.event_type !== 'item_delta') return '';
  return event.delta.delta_type === 'text_delta' ? event.delta.text : '';
}

function stable_artifact_key(value: SnapshotArtifactIdentity) {
  return (
    String(value.id ?? '') ||
    String(value.tool_call_id ?? '') ||
    String(value.tool_name ?? '') ||
    `${String(value.role ?? '') || 'artifact'}_${hash_string(stringify_pretty(value))}`
  );
}

function stable_artifact_items<T extends SnapshotArtifactIdentity>(items: T[]) {
  const seen_counts = new Map<string, number>();

  return items.map((item) => {
    const base_key = stable_artifact_key(item);
    const occurrence = (seen_counts.get(base_key) ?? 0) + 1;
    seen_counts.set(base_key, occurrence);

    return {
      key: occurrence === 1 ? base_key : `${base_key}_${occurrence}`,
      item,
    };
  });
}

function hash_string(value: string) {
  let hash = 0x811c9dc5;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }

  return (hash >>> 0).toString(36);
}

function RunRow({
  is_selected,
  run,
  onSelect,
}: {
  is_selected: boolean;
  run: Run;
  onSelect: () => void;
}) {
  return (
    <button
      className={cn(
        'w-full rounded-2xl border p-3 text-left transition-colors hover:bg-hover',
        is_selected && 'border-primary bg-primary/5',
      )}
      type="button"
      onClick={onSelect}
    >
      <div className="flex items-center justify-between gap-3">
        <span className="truncate font-mono text-xs">{run.run_id}</span>
        <StatusBadge value={run.run_status} />
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-muted-foreground">
        <MetricRow label="Provider" value={run.model_provider ?? 'local'} />
        <MetricRow label="Model" value={run.model_name ?? 'local'} />
        <MetricRow
          label="Updated"
          value={relative_time(run.finished_time ?? run.completed_time ?? run.created_time)}
        />
        <MetricRow
          label="Tokens"
          value={String((run.input_tokens ?? 0) + (run.output_tokens ?? 0))}
        />
        <MetricRow label="Duration" value={run.duration_ms ? `${run.duration_ms}ms` : '-'} />
      </div>
      {run.error_message ? (
        <div className="mt-2 rounded-2xl bg-destructive/10 p-2 text-xs text-destructive">
          {run.error_message}
        </div>
      ) : null}
    </button>
  );
}

function RunInspector({ inspection }: { inspection: RunInspection | undefined }) {
  const [filter_text, set_filter_text] = useState('');
  const [selected_snapshot_id, set_selected_snapshot_id] = useState<string | undefined>();
  const [selected_tool_call_id, set_selected_tool_call_id] = useState<string | undefined>();
  const [selected_event_id, set_selected_event_id] = useState<string | undefined>();
  const [selected_message_id, set_selected_message_id] = useState<string | undefined>();
  const [selected_artifact_id, set_selected_artifact_id] = useState<string | undefined>();
  const [event_tool_filter_id, set_event_tool_filter_id] = useState<string | undefined>();
  const [active_trace_tab, set_active_trace_tab] = useState('context');

  if (!inspection) return <EmptyTrace text="No run selected yet." />;

  const browsable_events = inspection.events.filter(is_browsable_run_event);
  const snapshots = filter_inspection_items(inspection.model_context_snapshots, filter_text);
  const tool_calls = filter_inspection_items(inspection.tool_calls, filter_text);
  const filtered_events = event_tool_filter_id
    ? browsable_events.filter((event) => event.tool_call_id === event_tool_filter_id)
    : browsable_events;
  const events = filter_inspection_items(filtered_events, filter_text);
  const messages = filter_inspection_items(inspection.messages, filter_text);
  const files = filter_inspection_items(inspection.files, filter_text);
  const selected_snapshot =
    snapshots.find((snapshot) => snapshot.run_model_context_snapshot_id === selected_snapshot_id) ??
    snapshots[snapshots.length - 1];
  const selected_tool_call =
    tool_calls.find((tool_call) => tool_call.tool_call_id === selected_tool_call_id) ??
    tool_calls[0];
  const selected_event =
    events.find((event) => event.run_event_id === selected_event_id) ?? events[0];
  const selected_message =
    messages.find((message) => message.run_message_id === selected_message_id) ?? messages[0];
  const selected_artifact =
    files.find((artifact) => artifact.file_id === selected_artifact_id) ?? files[0];
  const selected_tool_events = selected_tool_call
    ? browsable_events.filter((event) => event.tool_call_id === selected_tool_call.tool_call_id)
    : [];

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2 text-xs max-sm:grid-cols-2">
        <MetricRow label="Messages" value={String(inspection.messages.length)} />
        <MetricRow label="Events" value={String(browsable_events.length)} />
        <MetricRow label="Tools" value={String(inspection.tool_calls.length)} />
        <MetricRow label="Artifacts" value={String(inspection.files.length)} />
        <MetricRow label="Context" value={String(inspection.model_context_snapshots.length)} />
        <MetricRow label="Unfinished" value={String(inspection.audit.unfinished_tool_call_count)} />
        <MetricRow label="Failed tools" value={String(inspection.audit.failed_tool_call_count)} />
      </div>

      <ContextUsageIndicator snapshot={selected_snapshot} />

      <div className="relative">
        <Search className="-translate-y-1/2 pointer-events-none absolute top-1/2 left-2.5 size-4 text-muted-foreground" />
        <Input
          className="h-9 pl-8"
          value={filter_text}
          onChange={(event) => set_filter_text(event.target.value)}
          placeholder="Filter trace"
        />
      </div>

      <Tabs value={active_trace_tab} onValueChange={set_active_trace_tab}>
        <TabsList className="grid w-full grid-cols-5 rounded-2xl">
          <TabsTrigger value="context">Context</TabsTrigger>
          <TabsTrigger value="tools">Tools</TabsTrigger>
          <TabsTrigger value="events">Events</TabsTrigger>
          <TabsTrigger value="files">Artifacts</TabsTrigger>
          <TabsTrigger value="messages">Chat</TabsTrigger>
        </TabsList>

        <TabsContent value="context" className="mt-2 space-y-2">
          <InspectorExplorer
            detail={<SnapshotDetail snapshot={selected_snapshot} />}
            empty_text="No model context snapshot saved."
            has_items={snapshots.length > 0}
          >
            {snapshots.map((snapshot) => (
              <ArtifactButton
                eyebrow={`#${snapshot.snapshot_sequence}`}
                is_selected={
                  snapshot.run_model_context_snapshot_id ===
                  selected_snapshot?.run_model_context_snapshot_id
                }
                key={snapshot.run_model_context_snapshot_id}
                meta={`${snapshot.message_count} msgs · ${snapshot.tool_count} tools · ${snapshot.token_estimate} tokens`}
                status={snapshot.snapshot_kind}
                title={snapshot.model_name ?? snapshot.model_provider ?? 'context'}
                onClick={() => set_selected_snapshot_id(snapshot.run_model_context_snapshot_id)}
              />
            ))}
          </InspectorExplorer>
        </TabsContent>

        <TabsContent value="tools" className="mt-2 space-y-2">
          <InspectorExplorer
            detail={
              <ToolCallDetail
                linked_events={selected_tool_events}
                tool_call={selected_tool_call}
                onShowEvents={() => {
                  if (!selected_tool_call) return;
                  set_event_tool_filter_id(selected_tool_call.tool_call_id);
                  set_active_trace_tab('events');
                }}
              />
            }
            empty_text="No tool calls."
            has_items={tool_calls.length > 0}
          >
            {tool_calls.map((tool_call) => (
              <ArtifactButton
                eyebrow={relative_time(tool_call.created_time)}
                is_selected={tool_call.tool_call_id === selected_tool_call?.tool_call_id}
                key={tool_call.tool_call_id}
                meta={tool_call.error_message ?? summarize_unknown(tool_call.input_data)}
                status={tool_call.tool_status}
                title={tool_call.tool_name}
                onClick={() => set_selected_tool_call_id(tool_call.tool_call_id)}
              />
            ))}
          </InspectorExplorer>
        </TabsContent>

        <TabsContent value="events" className="mt-2 space-y-2">
          {event_tool_filter_id ? (
            <div className="flex items-center justify-between gap-2 rounded-2xl border px-3 py-2 text-xs">
              <span className="min-w-0 truncate text-muted-foreground">
                tool_call_id={event_tool_filter_id}
              </span>
              <Button
                className="h-7 px-2 text-xs"
                size="sm"
                type="button"
                variant="ghost"
                onClick={() => set_event_tool_filter_id(undefined)}
              >
                Clear
              </Button>
            </div>
          ) : null}
          <InspectorExplorer
            detail={<EventDetail event={selected_event} />}
            empty_text="No runtime events."
            has_items={events.length > 0}
          >
            {events.map((event) => (
              <ArtifactButton
                eyebrow={`#${event.event_sequence}`}
                is_selected={event.run_event_id === selected_event?.run_event_id}
                key={event.run_event_id}
                meta={event.event_label ?? summarize_unknown(event.event_data)}
                status={event.event_type}
                title={event.event_type}
                onClick={() => set_selected_event_id(event.run_event_id)}
              />
            ))}
          </InspectorExplorer>
        </TabsContent>

        <TabsContent value="files" className="mt-2 space-y-2">
          <InspectorExplorer
            detail={<ArtifactDetail artifact={selected_artifact} />}
            empty_text="No files."
            has_items={files.length > 0}
          >
            {files.map((artifact) => (
              <ArtifactButton
                eyebrow={relative_time(artifact.created_time)}
                is_selected={artifact.file_id === selected_artifact?.file_id}
                key={artifact.file_id}
                meta={artifact.workspace_path ?? artifact.storage_key}
                status={artifact.file_status}
                title={artifact.file_name ?? artifact.file_purpose}
                onClick={() => set_selected_artifact_id(artifact.file_id)}
              />
            ))}
          </InspectorExplorer>
        </TabsContent>

        <TabsContent value="messages" className="mt-2 space-y-2">
          <InspectorExplorer
            detail={<MessageDetail message={selected_message} />}
            empty_text="No run messages."
            has_items={messages.length > 0}
          >
            {messages.map((message) => (
              <ArtifactButton
                eyebrow={`#${message.message_sequence}`}
                is_selected={message.run_message_id === selected_message?.run_message_id}
                key={message.run_message_id}
                meta={get_message_content_text(message.message_content)}
                status={message.message_kind}
                title={message.message_role}
                onClick={() => set_selected_message_id(message.run_message_id)}
              />
            ))}
          </InspectorExplorer>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function ContextUsageIndicator({ snapshot }: { snapshot: RunInspectionSnapshot | undefined }) {
  if (!snapshot) return <EmptyTrace text="No context usage snapshot yet." />;

  const snapshot_record = snapshot.snapshot as ContextSnapshotData;
  const selection_policy = snapshot_record.selection_policy ?? {};
  const context_management = read_context_management(snapshot_record);
  const selected_tokens = selection_policy.selected_token_estimate;
  const token_budget = selection_policy.recent_token_budget;
  const selected_count = selection_policy.selected_message_count;
  const message_limit = selection_policy.recent_message_limit;
  const usage_percent =
    selected_tokens !== undefined && token_budget !== undefined && token_budget > 0
      ? Math.min(100, Math.round((selected_tokens / token_budget) * 100))
      : undefined;
  const usage_status =
    usage_percent === undefined
      ? 'unknown'
      : usage_percent >= 100
        ? 'at budget'
        : usage_percent >= 85
          ? 'near budget'
          : 'ok';
  const engine_compaction = context_management.engine_compaction || 'unknown';
  const summary_generation = context_management.summary_generation || 'unknown';
  const summary_source = context_management.summary_source || 'unknown';
  const hidden_compaction_allowed =
    context_management.hidden_compaction_allowed === true ? 'allowed' : 'disabled';

  return (
    <div className="rounded-2xl border p-3 text-xs">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="font-medium">Context Usage</div>
          <div className="mt-0.5 text-muted-foreground">
            {selected_tokens === undefined || token_budget === undefined
              ? 'No recent-window budget recorded.'
              : `${format_count(selected_tokens)} / ${format_count(token_budget)} estimated recent tokens`}
          </div>
        </div>
        <StatusBadge value={usage_status} />
      </div>

      <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted">
        <div
          className={cn(
            'h-full rounded-full',
            usage_percent !== undefined && usage_percent >= 100
              ? 'bg-destructive'
              : usage_percent !== undefined && usage_percent >= 85
                ? 'bg-caution'
                : 'bg-positive',
          )}
          style={{ width: `${usage_percent ?? 0}%` }}
        />
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 max-sm:grid-cols-1">
        <MetricRow
          label="Recent window"
          value={
            selected_count === undefined || message_limit === undefined
              ? '-'
              : `${format_count(selected_count)} / ${format_count(message_limit)} msgs`
          }
        />
        <MetricRow
          label="Snapshot total"
          value={`${format_count(snapshot.token_estimate)} tokens`}
        />
        <MetricRow label="Pi compaction" value={engine_compaction} />
        <MetricRow label="Summary generation" value={summary_generation} />
        <MetricRow label="Summary source" value={summary_source} />
        <MetricRow label="Hidden compaction" value={hidden_compaction_allowed} />
      </div>
    </div>
  );
}

type ContextManagementData = {
  engine_compaction?: string;
  summary_generation?: string;
  summary_source?: string;
  hidden_compaction_allowed?: boolean;
};

type ContextSnapshotData = {
  selection_policy?: {
    selected_token_estimate?: number;
    recent_token_budget?: number;
    selected_message_count?: number;
    recent_message_limit?: number;
  };
  context_management?: ContextManagementData;
  metadata?: { context_management?: ContextManagementData };
  messages?: SnapshotMessage[];
  tools?: SnapshotTool[];
  system_prompt?: string;
};

function read_context_management(snapshot_record: ContextSnapshotData) {
  return snapshot_record.context_management ?? snapshot_record.metadata?.context_management ?? {};
}

function format_count(value: number) {
  return new Intl.NumberFormat('en-US').format(value);
}

function InspectorExplorer({
  children,
  detail,
  empty_text,
  has_items,
}: {
  children: React.ReactNode;
  detail: React.ReactNode;
  empty_text: string;
  has_items: boolean;
}) {
  if (!has_items) return <EmptyTrace text={empty_text} />;

  return (
    <div className="grid h-[460px] min-h-0 grid-cols-[160px_minmax(0,1fr)] gap-2 max-sm:h-auto max-sm:grid-cols-1">
      <ScrollArea className="min-h-0 rounded-2xl border">
        <div className="space-y-1 p-1">{children}</div>
      </ScrollArea>
      <div className="min-w-0 overflow-hidden rounded-2xl border bg-background p-3">{detail}</div>
    </div>
  );
}

function ArtifactButton({
  eyebrow,
  is_selected,
  meta,
  status,
  title,
  onClick,
}: {
  eyebrow: string;
  is_selected: boolean;
  meta: string;
  status: string;
  title: string;
  onClick: () => void;
}) {
  return (
    <button
      className={cn(
        'grid w-full gap-1 rounded-2xl px-2 py-2 text-left text-xs transition-colors hover:bg-hover',
        is_selected && 'bg-brand-wash text-foreground',
      )}
      type="button"
      onClick={onClick}
    >
      <span className="flex items-center justify-between gap-2">
        <span className="truncate text-muted-foreground">{eyebrow}</span>
        <span className="truncate rounded-lg bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
          {status}
        </span>
      </span>
      <span className="truncate font-medium">{title}</span>
      <span className="line-clamp-2 break-words text-muted-foreground">{meta}</span>
    </button>
  );
}

function SnapshotDetail({ snapshot }: { snapshot: RunInspectionSnapshot | undefined }) {
  if (!snapshot) return <EmptyTrace text="No context snapshot selected." />;

  const snapshot_record = snapshot.snapshot as ContextSnapshotData;
  const messages = snapshot_record.messages ?? [];
  const tools = snapshot_record.tools ?? [];
  const system_prompt = snapshot_record.system_prompt ?? '';

  return (
    <ScrollArea className="h-full pr-2">
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-2 text-xs">
          <MetricRow label="Kind" value={snapshot.snapshot_kind} />
          <MetricRow label="Tokens" value={String(snapshot.token_estimate)} />
          <MetricRow label="Messages" value={String(snapshot.message_count)} />
          <MetricRow label="Tools" value={String(snapshot.tool_count)} />
        </div>

        <InspectorSection title="System">
          <pre className="max-h-32 overflow-auto whitespace-pre-wrap rounded-2xl bg-muted p-2 text-[11px] leading-5">
            {system_prompt || '-'}
          </pre>
        </InspectorSection>

        <InspectorSection title="Messages">
          <div className="space-y-1">
            {stable_artifact_items(messages).map(({ item: message, key }) => {
              return (
                <div className="rounded-2xl border p-2 text-xs" key={key}>
                  <div className="mb-1 font-medium">{String(message.role ?? '')}</div>
                  <div className="line-clamp-4 whitespace-pre-wrap text-muted-foreground">
                    {summarize_runtime_message(message)}
                  </div>
                </div>
              );
            })}
            {messages.length === 0 ? <EmptyTrace text="No messages in snapshot." /> : null}
          </div>
        </InspectorSection>

        <InspectorSection title="Tools">
          <div className="grid gap-1">
            {stable_artifact_items(tools).map(({ item: tool, key }) => {
              return (
                <div className="rounded-2xl border p-2 text-xs" key={key}>
                  <div className="font-medium">{String(tool.tool_name ?? '')}</div>
                  <div className="mt-1 line-clamp-2 text-muted-foreground">
                    {tool.description ?? ''}
                  </div>
                </div>
              );
            })}
            {tools.length === 0 ? <EmptyTrace text="No tools in snapshot." /> : null}
          </div>
        </InspectorSection>

        <InspectorSection title="Raw">
          <JsonBlock value={snapshot.snapshot} />
        </InspectorSection>
      </div>
    </ScrollArea>
  );
}

function ToolCallDetail({
  linked_events,
  tool_call,
  onShowEvents,
}: {
  linked_events: RunInspectionEvent[];
  tool_call: RunInspectionToolCall | undefined;
  onShowEvents: () => void;
}) {
  if (!tool_call) return <EmptyTrace text="No tool call selected." />;

  return (
    <ScrollArea className="h-full pr-2">
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0 truncate text-sm font-medium">{tool_call.tool_name}</div>
          <StatusBadge value={tool_call.tool_status} />
        </div>
        <div className="grid grid-cols-2 gap-2 text-xs">
          <MetricRow label="Started" value={relative_time(tool_call.started_time)} />
          <MetricRow
            label="Duration"
            value={tool_call.duration_ms ? `${tool_call.duration_ms}ms` : '-'}
          />
          <MetricRow label="Risk" value={tool_call.risk_class ?? '-'} />
          <MetricRow label="Approval" value={tool_call.approval_mode ?? '-'} />
          <MetricRow label="Events" value={String(linked_events.length)} />
          <MetricRow label="Artifact" value={tool_call.output_file_id ?? '-'} />
        </div>
        {tool_call.error_message ? (
          <div className="rounded-2xl bg-destructive/10 p-2 text-xs text-destructive">
            {tool_call.error_message}
          </div>
        ) : null}
        {linked_events.length > 0 ? (
          <InspectorSection title="Lifecycle">
            <div className="space-y-1">
              {linked_events.map((event) => (
                <button
                  className="flex w-full items-center justify-between gap-2 rounded-2xl border px-2 py-1.5 text-left text-xs hover:bg-hover"
                  key={event.run_event_id}
                  type="button"
                  onClick={onShowEvents}
                >
                  <span className="truncate">
                    #{event.event_sequence} {event.event_label ?? event.event_type}
                  </span>
                  <span className="truncate text-muted-foreground">{event.event_type}</span>
                </button>
              ))}
            </div>
          </InspectorSection>
        ) : null}
        <InspectorSection title="Input">
          <JsonBlock value={tool_call.input_data} />
        </InspectorSection>
        <InspectorSection title="Output">
          <JsonBlock value={tool_call.output_data ?? tool_call.output_text} />
        </InspectorSection>
      </div>
    </ScrollArea>
  );
}

function ArtifactDetail({ artifact }: { artifact: RunInspectionArtifact | undefined }) {
  const artifact_content_query = useQuery({
    queryKey: query_keys.artifact_content(artifact?.file_id),
    queryFn: () => open_artifact_content(artifact?.file_id ?? ''),
    enabled: Boolean(artifact?.file_id),
  });

  if (!artifact) return <EmptyTrace text="No artifact selected." />;

  return (
    <ScrollArea className="h-full pr-2">
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0 truncate text-sm font-medium">
            {artifact.file_name ?? artifact.workspace_path ?? artifact.file_id}
          </div>
          <StatusBadge value={artifact.file_status} />
        </div>
        <div className="grid gap-2 text-xs">
          <MetricRow label="Kind" value={artifact.file_purpose} />
          <MetricRow label="Provider" value={artifact.storage_provider} />
          <MetricRow label="Bytes" value={String(artifact.byte_size ?? 0)} />
          <MetricRow label="Visible" value={artifact.is_visible ? 'yes' : 'no'} />
          <MetricRow label="Tool" value={artifact.source_tool_call_id ?? '-'} />
          <MetricRow label="Runtime" value={artifact.runtime_environment_id ?? '-'} />
        </div>
        <InspectorSection title="Pointer">
          <JsonBlock
            value={{
              file_id: artifact.file_id,
              storage_key: artifact.storage_key,
              workspace_path: artifact.workspace_path,
              checksum_sha256: artifact.checksum_sha256,
            }}
            maxHeightClassName="max-h-44"
          />
        </InspectorSection>
        <InspectorSection title="Content">
          {artifact_content_query.isLoading ? (
            <div className="rounded-2xl bg-muted p-2 text-xs text-muted-foreground">
              Opening artifact...
            </div>
          ) : artifact_content_query.isError ? (
            <div className="rounded-2xl bg-destructive/10 p-2 text-xs text-destructive">
              Artifact bytes are missing.
            </div>
          ) : (
            <pre className="max-h-60 overflow-auto whitespace-pre-wrap rounded-2xl bg-muted p-2 text-[11px] leading-5">
              {artifact_content_query.data?.content_text ?? artifact.content_preview ?? ''}
            </pre>
          )}
        </InspectorSection>
      </div>
    </ScrollArea>
  );
}

function EventDetail({ event }: { event: RunInspectionEvent | undefined }) {
  if (!event) return <EmptyTrace text="No runtime event selected." />;

  return (
    <ScrollArea className="h-full pr-2">
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0 truncate text-sm font-medium">
            #{event.event_sequence} {event.event_type}
          </div>
          <StatusBadge value={event.event_type} />
        </div>
        {event.event_label ? (
          <div className="rounded-2xl bg-muted p-2 text-xs">{event.event_label}</div>
        ) : null}
        <div className="grid grid-cols-2 gap-2 text-xs">
          <MetricRow label="Tool" value={event.tool_call_id ?? '-'} />
          <MetricRow label="Created" value={relative_time(event.created_time)} />
        </div>
        <InspectorSection title="Payload">
          <JsonBlock value={event.event_data} />
        </InspectorSection>
        <InspectorSection title="Metadata">
          <JsonBlock value={event.event_metadata} />
        </InspectorSection>
      </div>
    </ScrollArea>
  );
}

function MessageDetail({ message }: { message: RunInspectionMessage | undefined }) {
  if (!message) return <EmptyTrace text="No run message selected." />;

  return (
    <ScrollArea className="h-full pr-2">
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0 truncate text-sm font-medium">{message.message_role}</div>
          <StatusBadge value={message.message_kind} />
        </div>
        <div className="rounded-2xl bg-muted p-2 text-sm leading-6">
          {get_message_content_text(message.message_content)}
        </div>
        <JsonBlock value={message.message_content} />
      </div>
    </ScrollArea>
  );
}

function InspectorSection({ children, title }: { children: React.ReactNode; title: string }) {
  return (
    <section className="space-y-1">
      <h3 className="text-xs font-medium text-muted-foreground">{title}</h3>
      {children}
    </section>
  );
}

function ToolCallRow({ tool_call }: { tool_call: ToolCall }) {
  return (
    <div className="rounded-2xl border p-3">
      <div className="flex items-center justify-between gap-3">
        <span className="truncate text-sm font-medium">{tool_call.tool_name}</span>
        <StatusBadge value={tool_call.tool_status} />
      </div>
      <pre className="mt-2 max-h-40 overflow-auto rounded-2xl bg-muted p-2 text-xs leading-5">
        {tool_call.output_text ?? JSON.stringify(tool_call.output_data, null, 2)}
      </pre>
      {tool_call.error_message ? (
        <div className="mt-2 text-xs text-destructive">{tool_call.error_message}</div>
      ) : null}
    </div>
  );
}

function JsonBlock({
  value,
  maxHeightClassName = 'max-h-80',
}: {
  value: unknown;
  maxHeightClassName?: string;
}) {
  const [copied, set_copied] = useState(false);
  const json_text = stringify_pretty(value);

  async function copy_json() {
    try {
      await copy_text(json_text);
      set_copied(true);
      window.setTimeout(() => set_copied(false), 1200);
    } catch (error) {
      toast.error(format_error_message(error, 'Could not copy JSON'));
    }
  }

  return (
    <div className="mt-2 overflow-hidden rounded-2xl bg-muted">
      <div className="flex items-center justify-end border-b px-2 py-1">
        <Button
          className="h-7 gap-1 px-2 text-xs"
          size="sm"
          type="button"
          variant="ghost"
          onClick={copy_json}
        >
          <Copy className="size-3" />
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
      <pre className={cn('overflow-auto p-2 text-[11px] leading-5', maxHeightClassName)}>
        {json_text}
      </pre>
    </div>
  );
}

function ConnectionsPanel({
  apps,
  connections,
  is_connecting,
  is_reconnecting,
  setup_notice,
  onConnect,
  onReconnect,
  onRevoke,
}: {
  apps: CatalogApp[];
  connections: Connection[];
  is_connecting: boolean;
  is_reconnecting: boolean;
  setup_notice: ConnectionSetupNotice | null;
  onConnect(app: CatalogApp): void;
  onReconnect(connection_id: string): void;
  onRevoke(connection_id: string): void;
}) {
  const connectable_apps = apps.filter((app) => first_connection_profile(app));

  return (
    <div className="space-y-3">
      {setup_notice ? <ConnectionSetupCallout notice={setup_notice} /> : null}
      <div className="space-y-2">
        {connections.map((connection) => (
          <div
            className="rounded-2xl border p-3"
            data-testid={`connection-${connection.connection_id}`}
            key={connection.connection_id}
          >
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">
                  {connection.connection_name ?? connection.external_account_name ?? 'Connection'}
                </div>
                <div className="truncate text-xs text-muted-foreground">
                  {connection.provider_key} · {connection.connection_profile_key}
                </div>
              </div>
              <StatusBadge value={connection.connection_status} />
            </div>
            <div className="mt-3 flex gap-2">
              <Button
                className="h-8 gap-1 px-2 text-xs"
                disabled={is_reconnecting}
                type="button"
                variant="outline"
                onClick={() => onReconnect(connection.connection_id)}
              >
                <RefreshCw className="size-3.5" />
                {is_reconnecting ? 'Starting...' : 'Reconnect'}
              </Button>
              <Button
                className="h-8 gap-1 px-2 text-xs"
                type="button"
                variant="outline"
                onClick={() => onRevoke(connection.connection_id)}
              >
                <Unplug className="size-3.5" />
                Revoke
              </Button>
            </div>
          </div>
        ))}
        {connections.length === 0 ? <EmptyTrace text="No connections yet." /> : null}
      </div>
      <Separator />
      <div className="grid gap-2">
        {connectable_apps.slice(0, 8).map((app) => {
          const profile = first_connection_profile(app);
          return (
            <div
              className="flex items-center justify-between gap-3 rounded-2xl border p-3"
              data-testid={`connect-app-${profile?.connection_profile_key ?? app.app_id}`}
              key={app.app_id}
            >
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">{app.app_display_name}</div>
                <div className="truncate text-xs text-muted-foreground">
                  {profile?.provider_key} · {profile?.connection_profile_key}
                </div>
              </div>
              <Button
                className="h-8 gap-1 px-2 text-xs"
                disabled={is_connecting}
                type="button"
                onClick={() => onConnect(app)}
              >
                <Link2 className="size-3.5" />
                {is_connecting ? 'Starting...' : 'Connect'}
              </Button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ConnectionSetupCallout({ notice }: { notice: ConnectionSetupNotice }) {
  const tone_class_name =
    notice.tone === 'error'
      ? 'border-destructive/40 bg-destructive/5 text-destructive'
      : notice.tone === 'warning'
        ? 'border-caution/40 bg-caution-wash text-caution-ink'
        : 'border-positive/30 bg-positive-wash text-positive-ink';

  return (
    <div className={cn('rounded-2xl border p-3 text-sm', tone_class_name)}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-medium">{notice.title}</div>
          <div className="mt-1 text-xs opacity-80">{notice.description}</div>
        </div>
        {notice.action_url ? (
          <a
            className={buttonVariants({ variant: 'outline', size: 'xs' })}
            href={notice.action_url}
          >
            <ExternalLink className="size-3.5" />
            Open setup
          </a>
        ) : null}
      </div>
    </div>
  );
}

function AgentToolsPanel({
  nodes,
  connections,
  enabled_nodes,
  onEnableNode,
  onDisableNode,
}: {
  nodes: CatalogNode[];
  connections: Connection[];
  enabled_nodes: AgentEnabledNode[];
  onEnableNode(node: CatalogNode): void;
  onDisableNode(node_key: string): void;
}) {
  const [tool_query, set_tool_query] = useState('');
  const enabled_node_keys = new Set(enabled_nodes.map((node) => node.node_key));
  const enabled_catalog_nodes = enabled_nodes.map((enabled_node) => ({
    enabled_node,
    node: nodes.find((node) => node.node_key === enabled_node.node_key),
  }));
  const available_nodes = sort_available_agent_nodes(
    nodes.filter((node) => !enabled_node_keys.has(node.node_key)),
  );
  const matching_nodes = available_nodes.filter((node) =>
    matches_agent_tool_query(node, tool_query),
  );
  const visible_nodes = matching_nodes.slice(0, agent_tool_page_size);

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        {enabled_catalog_nodes.map(({ enabled_node, node }) => (
          <div className="rounded-2xl border p-3" key={enabled_node.node_key}>
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">
                  {node?.node_display_name ?? enabled_node.node_key}
                </div>
                <div className="truncate text-xs text-muted-foreground">
                  {enabled_node.provider_key} · {connection_state_label(node, connections)}
                </div>
              </div>
              <Button
                className="h-8 px-2 text-xs"
                type="button"
                variant="outline"
                onClick={() => onDisableNode(enabled_node.node_key)}
              >
                Disable
              </Button>
            </div>
          </div>
        ))}
        {enabled_catalog_nodes.length === 0 ? <EmptyTrace text="No enabled nodes." /> : null}
      </div>
      <Separator />
      <Input
        className="h-9"
        placeholder="Search tools"
        value={tool_query}
        onChange={(event) => set_tool_query(event.target.value)}
      />
      <div className="grid gap-2">
        {visible_nodes.map((node) => (
          <div
            className="flex items-center justify-between gap-3 rounded-2xl border p-3"
            data-testid={`available-node-${node.node_key}`}
            key={node.node_id}
          >
            <div className="min-w-0">
              <div className="truncate text-sm font-medium">{node.node_display_name}</div>
              <div className="truncate text-xs text-muted-foreground">
                {node.provider_key} · {node.node_key}
              </div>
            </div>
            <Button
              className="h-8 gap-1 px-2 text-xs"
              type="button"
              variant="outline"
              onClick={() => onEnableNode(node)}
            >
              <Plus className="size-3.5" />
              Enable
            </Button>
          </div>
        ))}
        {matching_nodes.length === 0 ? (
          <EmptyTrace text={tool_query ? 'No tool matches that.' : 'No tools left to enable.'} />
        ) : null}
        {matching_nodes.length > visible_nodes.length ? (
          <p className="text-xs text-muted-foreground">
            {matching_nodes.length - visible_nodes.length} more. Search to narrow.
          </p>
        ) : null}
      </div>
    </div>
  );
}

export function matches_agent_tool_query(
  node: { node_display_name: string; node_key: string; app_key: string; provider_key: string },
  query: string,
) {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return [node.node_display_name, node.node_key, node.app_key, node.provider_key]
    .join(' ')
    .toLowerCase()
    .includes(needle);
}

const agent_tool_page_size = 20;

function sort_available_agent_nodes(nodes: CatalogNode[]) {
  return [...nodes].sort(compare_agent_tool_priority);
}

function compare_agent_tool_priority(left: CatalogNode, right: CatalogNode) {
  const provider_priority =
    agent_tool_provider_priority(left) - agent_tool_provider_priority(right);
  if (provider_priority !== 0) return provider_priority;
  return left.node_name.localeCompare(right.node_name);
}

function agent_tool_provider_priority(node: CatalogNode) {
  return node.provider_key === 'native' ? 0 : 1;
}

function first_connection_profile(app: CatalogApp) {
  const provider_configs = app.metadata.provider_configs ?? [];
  for (const config of provider_configs) {
    if (config.status !== 'active') continue;
    const profile = config.connection_profiles.find((candidate) => candidate.status === 'active');
    if (!profile) continue;
    return {
      provider_key: config.provider_key,
      provider_config_key: config.provider_config_key,
      connection_profile_key: profile.connection_profile_key,
    };
  }

  return null;
}

function connection_setup_description(setup: ConnectionSetupState) {
  if (setup.setup_error) return setup.setup_error;
  if (setup.type === 'manual') return 'Manual setup is ready for this connection.';
  if (setup.type === 'manual') return 'Manual setup is ready for this connection.';
  return 'The connection row is pending setup.';
}

function connection_state_label(node: CatalogNode | undefined, connections: Connection[]) {
  if (!node) return 'node missing';
  if (node.node_status === 'retired') return 'retired';
  if (node.node_status === 'deprecated') return 'deprecated';
  if (!node.connection_profile_key) return 'no connection required';

  const connection = connections.find(
    (candidate) =>
      candidate.connection_status === 'active' &&
      candidate.app_id === node.app_id &&
      candidate.provider_key === node.provider_key &&
      candidate.provider_config_key === node.provider_config_key &&
      candidate.provider_config_version === node.provider_config_version &&
      candidate.connection_profile_key === node.connection_profile_key &&
      candidate.connection_profile_version === node.connection_profile_version,
  );

  return connection
    ? `connected: ${connection.external_account_name ?? connection.connection_id}`
    : 'connection missing';
}

function TraceCard({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="rounded-2xl" size="sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          {icon}
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">{children}</CardContent>
    </Card>
  );
}

function MetricRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 items-center justify-between gap-2">
      <span className="truncate text-muted-foreground">{label}</span>
      <span className="truncate text-foreground">{value}</span>
    </div>
  );
}

function StatusBadge({ value }: { value: string }) {
  const variant =
    value === 'failed' || value === 'error'
      ? 'destructive'
      : value === 'completed' || value === 'active' || value === 'enabled'
        ? 'secondary'
        : 'outline';

  return (
    <Badge className="gap-1 rounded-2xl" variant={variant}>
      {value === 'failed' || value === 'error' ? <CircleAlert className="size-3" /> : null}
      {value}
    </Badge>
  );
}

function EmptyTrace({ text }: { text: string }) {
  return (
    <div className="rounded-2xl border border-dashed p-3 text-sm text-muted-foreground">{text}</div>
  );
}

function QueryError({ label, onRetry }: { label: string; onRetry: () => void }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-2xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
      <span>{label} unavailable.</span>
      <Button size="sm" variant="outline" type="button" onClick={onRetry}>
        Retry
      </Button>
    </div>
  );
}

function SessionSkeleton() {
  return (
    <>
      <Skeleton className="h-14 rounded-2xl" />
      <Skeleton className="h-14 rounded-2xl" />
      <Skeleton className="h-14 rounded-2xl" />
    </>
  );
}

function MessageSkeleton() {
  return (
    <>
      <Skeleton className="h-16 w-2/3 rounded-2xl" />
      <Skeleton className="ml-auto h-16 w-1/2 rounded-2xl" />
      <Skeleton className="h-20 w-3/4 rounded-2xl" />
    </>
  );
}
