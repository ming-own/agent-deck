import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogContentSection,
  DialogHeader,
} from '@/components/ui/dialog';
import { DsText } from '@/components/ui/ds-text';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import type { ConfiguredModelChoice } from '@/lib/configuredModels';
import {
  sessionAgentApi,
  type AgentTask,
  type AgentToolId,
  type RouteOrigin,
  type RouteReceipt,
  type SessionAgent,
} from '@/service/sessionAgentApi';
import { resolveNodeConnection } from '@/service/sessionAgentModels';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BranchRouter } from './BranchRouter';
import { TurnTools } from './ToolPermissions';

export interface RouterLocation {
  project: string;
  name: string;
  agents: SessionAgent[];
  opener: HTMLButtonElement;
  origin?: RouteOrigin;
}

export function TaskRouter({
  location,
  onTaskCreated,
  openWorkshop,
  account,
  choices,
  email,
  close,
}: {
  onTaskCreated: () => void;
  openWorkshop?: () => void;
  location: RouterLocation;
  account: string;
  choices: ConfiguredModelChoice[];
  email: string;
  close: () => void;
}) {
  const { t } = useTranslation();
  const api = useMemo(
    () => sessionAgentApi(account, location.project),
    [account, location.project]
  );
  const [tab, setTab] = useState(location.origin ? 'log' : 'compose');
  const [reply, setReply] = useState<RouteReceipt | null>(null);
  const [receipts, setReceipts] = useState<RouteReceipt[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [readError, setReadError] = useState(false);
  const [sending, setSending] = useState(false);
  const [epoch, setEpoch] = useState(0);
  useEffect(() => {
    if (tab !== 'log') return;
    let current = true;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      let delay = 10000;
      try {
        const rows = await api.receipts(location.origin);
        if (current) {
          if (rows.some((r) => ['running', 'queued'].includes(r.status)))
            delay = 1500;
          setReceipts(rows);
          setReadError(false);
          setLoaded(true);
        }
      } catch {
        if (current) setReadError(true);
      }
      if (current) timer = setTimeout(poll, delay);
    }
    void poll();
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [api, location.origin, tab, epoch]);
  const destination = (r: RouteReceipt) =>
    r.target_name + ' / ' + (r.target_task_name || t('chat.node-task-default'));
  const origin = (r: RouteReceipt) =>
    r.origin_name
      ? r.origin_name +
        ' / ' +
        (r.origin_task_name || t('chat.node-task-default'))
      : t('chat.canvas-title');
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !sending) close();
      }}
    >
      <DialogContent
        size="md"
        overlayVariant="dimmed"
        aria-describedby={undefined}
        showCloseButton={!sending}
        onCloseAutoFocus={(e) => {
          e.preventDefault();
          location.opener.focus();
        }}
      >
        <DialogHeader title={t('chat.route-node')} subtitle={location.name} />
        <Tabs
          value={tab}
          onValueChange={setTab}
          className="flex min-h-0 flex-col"
        >
          <div className="shrink-0 px-ds-panel-inset">
            <TabsList appearance="outline" aria-label={t('chat.route-node')}>
              <TabsTrigger value="compose" disabled={sending}>
                {t('chat.route-send')}
              </TabsTrigger>
              {!location.origin && (
                <TabsTrigger value="branches" disabled={sending}>
                  {t('chat.batch-tab')}
                </TabsTrigger>
              )}
              <TabsTrigger value="log" disabled={sending}>
                {t('chat.route-log')}
              </TabsTrigger>
            </TabsList>
            {!location.origin && openWorkshop && (
              <Button
                variant="text"
                size="xs"
                disabled={sending}
                onClick={openWorkshop}
              >
                {t('chat.workshop')}
              </Button>
            )}
          </div>
          <DialogContentSection>
            <TabsContent
              forceMount
              value="compose"
              className="m-0 data-[state=inactive]:hidden"
            >
              <RouteComposer
                key={reply?.event_id ?? 'new-' + epoch}
                location={location}
                api={api}
                choices={choices}
                email={email}
                reply={reply}
                cancelReply={() => setReply(null)}
                sending={sending}
                setSending={setSending}
                onSent={(receipt, created) => {
                  if (created) onTaskCreated();
                  setReceipts((old) => [
                    receipt,
                    ...old.filter((r) => r.event_id !== receipt.event_id),
                  ]);
                  setReply(null);
                  setTab('log');
                  setEpoch((n) => n + 1);
                }}
              />
            </TabsContent>
            {!location.origin && (
              <TabsContent
                value="branches"
                className="m-0 data-[state=inactive]:hidden"
              >
                <BranchRouter
                  api={api}
                  agents={location.agents}
                  choices={choices}
                  email={email}
                  sending={sending}
                  setSending={setSending}
                  onTaskCreated={onTaskCreated}
                />
              </TabsContent>
            )}
            <TabsContent
              value="log"
              className="m-0 flex flex-col gap-ds-stack-related data-[state=inactive]:hidden"
            >
              {readError && (
                <DsText role="base" aria-live="polite">
                  {t('chat.session-agents-load-error')}
                </DsText>
              )}
              {!readError && !receipts.length && (
                <DsText role="base" className="text-ds-ink-muted-default">
                  {t(
                    loaded ? 'chat.route-empty' : 'chat.session-agents-loading'
                  )}
                </DsText>
              )}
              {receipts.map((r) => (
                <article
                  key={r.event_id}
                  className="flex flex-col gap-ds-6 rounded-ds-field bg-ds-neutral-muted-default p-ds-panel-inset"
                >
                  <DsText role="base" weight="semibold" className="break-words">
                    {origin(r)} → {destination(r)}
                  </DsText>
                  <DsText
                    role="base"
                    className="break-words whitespace-pre-wrap"
                  >
                    {r.message}
                  </DsText>
                  <DsText role="meta" className="text-ds-ink-muted-default">
                    {t('chat.session-agents-status-' + r.status)} ·{' '}
                    {new Date(r.created_at).toLocaleString()}
                  </DsText>
                  {r.status === 'completed' && (
                    <div>
                      <DsText role="meta" weight="semibold">
                        {t('chat.route-return', { name: origin(r) })}
                      </DsText>
                      <DsText
                        role="base"
                        className="break-words whitespace-pre-wrap"
                      >
                        {r.output}
                      </DsText>
                    </div>
                  )}
                  <div className="flex flex-wrap items-center gap-ds-control-gap">
                    <Button
                      size="xs"
                      variant="secondary"
                      onClick={() => {
                        setReply(r);
                        setTab('compose');
                      }}
                    >
                      {t('chat.route-follow')}
                    </Button>
                    <details className="min-w-0 text-ds-text-meta text-ds-ink-muted-default">
                      <summary className="cursor-pointer">
                        {t('chat.route-id')}
                      </summary>
                      <span className="break-all">
                        {r.event_id}
                        {r.reply_to && ' ← ' + r.reply_to}
                      </span>
                    </details>
                  </div>
                </article>
              ))}
            </TabsContent>
          </DialogContentSection>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

function RouteComposer({
  location,
  api,
  choices,
  email,
  reply,
  cancelReply,
  sending,
  setSending,
  onSent,
}: {
  location: RouterLocation;
  api: ReturnType<typeof sessionAgentApi>;
  choices: ConfiguredModelChoice[];
  email: string;
  reply: RouteReceipt | null;
  cancelReply: () => void;
  sending: boolean;
  setSending: (value: boolean) => void;
  onSent: (r: RouteReceipt, created: boolean) => void;
}) {
  const { t } = useTranslation();
  const [agentId, setAgent] = useState(reply?.target_agent_id ?? '');
  const [taskId, setTask] = useState('new');
  const [name, setName] = useState('');
  const [message, setMessage] = useState('');
  const [tasks, setTasks] = useState<AgentTask[]>([]);
  const [readError, setReadError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [permissions, setPermissions] = useState<AgentToolId[]>([]);
  const [error, setError] = useState('');
  const lock = useRef(false);
  const pending = useRef<{ key: string; id: string } | null>(null);
  const agent = location.agents.find((a) => a.id === agentId);
  useEffect(() => {
    if (!agentId || reply) return;
    let current = true;
    api
      .tasks(agentId)
      .then((rows) => {
        if (current) {
          setTasks(rows);
          setReadError(false);
        }
      })
      .catch(() => {
        if (current) setReadError(true);
      });
    return () => {
      current = false;
    };
  }, [api, agentId, reply, retry]);
  let connection: ReturnType<typeof resolveNodeConnection> | undefined;
  if (agent)
    try {
      connection = resolveNodeConnection(
        agent,
        choices,
        location.agents,
        email
      );
    } catch {
      /* Offer the existing model-unavailable state. */
    }
  const ready =
    !!connection &&
    !!message.trim() &&
    (!!reply ||
      (taskId === 'new' ? !!name.trim() : tasks.some((v) => v.id === taskId)));
  async function send() {
    if (!agent || !ready || lock.current) return;
    lock.current = true;
    setSending(true);
    setError('');
    const envelope = {
      origin_agent_id: reply
        ? reply.origin_agent_id
        : (location.origin?.agentId ?? null),
      origin_task_id: reply
        ? reply.origin_task_id
        : (location.origin?.taskId ?? null),
      target_agent_id: agentId,
      ...(reply
        ? { reply_to: reply.event_id }
        : taskId === 'new'
          ? { new_task_name: name.trim() }
          : { task_id: taskId }),
      expected_revision: agent.revision,
      approved_tools: [...permissions].sort(),
      message: message.trim(),
    };
    const key = JSON.stringify(envelope);
    if (pending.current?.key !== key)
      pending.current = { key, id: crypto.randomUUID() };
    try {
      onSent(
        await api.route({
          ...envelope,
          event_id: pending.current.id,
          email,
          connection,
        }),
        !reply && taskId === 'new'
      );
    } catch (e) {
      setError(
        (e as { status?: number })?.status === 409
          ? 'chat.handoff-conflict'
          : 'chat.session-agents-request-error'
      );
    } finally {
      lock.current = false;
      setSending(false);
    }
  }
  return (
    <form
      className="flex flex-col gap-ds-stack-related"
      onSubmit={(e) => {
        e.preventDefault();
        void send();
      }}
    >
      {reply ? (
        <div className="flex items-center justify-between gap-ds-control-gap rounded-ds-field bg-ds-neutral-muted-default p-ds-panel-inset">
          <DsText role="base">
            {reply.target_name} /{' '}
            {reply.target_task_name || t('chat.node-task-default')}
          </DsText>
          <Button
            size="xs"
            type="button"
            variant="ghost"
            disabled={sending}
            onClick={cancelReply}
          >
            {t('chat.session-agents-cancel')}
          </Button>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-ds-control-gap sm:grid-cols-2">
            <Select
              value={agentId}
              disabled={sending}
              onValueChange={(id) => {
                if (id === agentId) return;
                setAgent(id);
                setTask('new');
                setTasks([]);
                setPermissions([]);
                setReadError(false);
                setError('');
              }}
            >
              <SelectTrigger
                size="sm"
                title={t('chat.handoff-agent')}
                aria-label={t('chat.handoff-agent')}
                wrapperClassName="min-w-0"
              >
                <SelectValue placeholder={t('chat.session-agents-select')} />
              </SelectTrigger>
              <SelectContent>
                {location.agents.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={taskId}
              disabled={sending || !agent}
              onValueChange={setTask}
            >
              <SelectTrigger
                size="sm"
                title={t('chat.handoff-task')}
                aria-label={t('chat.handoff-task')}
                wrapperClassName="min-w-0"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="new">{t('chat.node-task-new')}</SelectItem>
                {tasks
                  .filter(
                    (task) =>
                      location.origin?.agentId !== agentId ||
                      location.origin.taskId !== task.id
                  )
                  .map((task) => (
                    <SelectItem key={task.id} value={task.id}>
                      {task.name || t('chat.node-task-default')}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
          {taskId === 'new' && (
            <Input
              title={t('chat.node-task-name')}
              aria-label={t('chat.node-task-name')}
              value={name}
              maxLength={100}
              disabled={sending}
              onChange={(e) => setName(e.target.value)}
            />
          )}
        </>
      )}
      {!location.agents.length && (
        <DsText role="base">{t('chat.session-agents-empty')}</DsText>
      )}
      {agent && !connection && (
        <DsText role="base">{t('chat.session-agents-unavailable')}</DsText>
      )}
      {readError && (
        <Button
          type="button"
          size="xs"
          variant="text"
          onClick={() => setRetry((n) => n + 1)}
        >
          {t('chat.session-agents-load-error')} ·{' '}
          {t('chat.session-agents-retry')}
        </Button>
      )}
      <Textarea
        title={t(reply ? 'chat.route-follow' : 'chat.route-body')}
        aria-label={t(reply ? 'chat.route-follow' : 'chat.route-body')}
        variant="outlined"
        size="sm"
        rows={3}
        maxLength={32000}
        disabled={sending}
        value={message}
        onChange={(e) => setMessage(e.target.value)}
      />
      {agent && (
        <TurnTools
          policy={agent.tool_policy ?? {}}
          selected={permissions}
          onChange={setPermissions}
          disabled={sending}
        />
      )}
      {error && (
        <DsText role="base" aria-live="assertive">
          {t(error)}
        </DsText>
      )}
      <div className="flex justify-end">
        <Button type="submit" size="sm" disabled={sending || !ready}>
          {t('chat.route-send')}
        </Button>
      </div>
    </form>
  );
}
