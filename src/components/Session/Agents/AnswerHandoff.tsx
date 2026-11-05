import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogContentSection,
  DialogHeader,
} from '@/components/ui/dialog';
import { DsText } from '@/components/ui/ds-text';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import type { ConfiguredModelChoice } from '@/lib/configuredModels';
import type {
  AgentTask,
  AgentToolId,
  SessionAgent,
  SessionAgentRun,
  SourceAnswer,
  sessionAgentApi,
} from '@/service/sessionAgentApi';
import { resolveNodeConnection } from '@/service/sessionAgentModels';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { TurnTools } from './ToolPermissions';

export function AnswerReference({ source }: { source: SourceAnswer }) {
  const { t } = useTranslation();
  return (
    <details className="rounded-ds-field bg-ds-neutral-muted-default px-ds-panel-inset py-ds-8">
      <summary className="cursor-pointer text-ds-text-base break-words focus-visible:ring-2 focus-visible:ring-ds-ring-focus">
        {t('chat.handoff-reference')} · {source.agent_name} ·{' '}
        {source.task_name || t('chat.node-task-default')}
      </summary>
      <DsText role="meta" className="pt-ds-8 text-ds-ink-muted-default">
        {new Date(source.finished_at).toLocaleString()} · {source.id}
      </DsText>
      <DsText role="base" className="pt-ds-8 break-words whitespace-pre-wrap">
        {source.output}
      </DsText>
    </details>
  );
}

export function AnswerHandoff({
  source,
  targets,
  allNodes,
  choices,
  api,
  email,
  close,
  delivered,
  opener,
}: {
  source: SessionAgentRun;
  targets: SessionAgent[];
  allNodes?: SessionAgent[];
  choices: ConfiguredModelChoice[];
  api: ReturnType<typeof sessionAgentApi>;
  email: string;
  close: () => void;
  delivered: (agentId: string, taskId: string) => void;
  opener: HTMLButtonElement;
}) {
  const { t } = useTranslation();
  const [agentId, setAgent] = useState('');
  const target = targets.find((n) => n.id === agentId);
  const [tasks, setTasks] = useState<AgentTask[]>([]);
  const [taskId, setTask] = useState('');
  const [note, setNote] = useState('');
  const [tools, setTools] = useState<AgentToolId[]>([]);
  const [error, setError] = useState('');
  const [attempt, retry] = useState(0);
  const [loadFailed, setLoadFailed] = useState(false);
  const [sending, setSending] = useState(false);
  const locked = useRef(false);
  const submission = useRef<{ key: string; id: string } | null>(null);
  useEffect(() => {
    if (!agentId) return;
    let current = true;
    api
      .tasks(agentId)
      .then((rows) => {
        if (current) {
          setTasks(rows);
          setLoadFailed(false);
        }
      })
      .catch(() => {
        if (current) setLoadFailed(true);
      });
    return () => {
      current = false;
    };
  }, [api, agentId, attempt]);
  let connection: ReturnType<typeof resolveNodeConnection> | undefined;
  if (target) {
    try {
      connection = resolveNodeConnection(
        target,
        choices,
        allNodes ?? targets,
        email
      );
    } catch {
      /* Display the model status in the dialog. */
    }
  }
  const confirm = async () => {
    if (
      locked.current ||
      !target ||
      !connection ||
      !tasks.some((task) => task.id === taskId)
    )
      return;
    locked.current = true;
    setSending(true);
    setError('');
    const key = JSON.stringify([
      source.id,
      target.id,
      target.revision,
      taskId,
      note.trim(),
      [...tools].sort(),
    ]);
    if (submission.current?.key !== key)
      submission.current = { key, id: crypto.randomUUID() };
    try {
      await api.start(target.id, {
        source_run_id: source.id,
        task_id: taskId,
        request_id: submission.current.id,
        expected_revision: target.revision,
        approved_tools: tools,
        prompt: note.trim(),
        connection,
        email,
      });
      delivered(target.id, taskId);
    } catch (err) {
      setError(
        (err as { status?: number }).status === 409
          ? 'chat.handoff-conflict'
          : 'chat.session-agents-request-error'
      );
    } finally {
      locked.current = false;
      setSending(false);
    }
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !locked.current) close();
      }}
    >
      <DialogContent
        size="md"
        overlayVariant="dimmed"
        aria-describedby={undefined}
        showCloseButton={!sending}
        onCloseAutoFocus={(e) => {
          e.preventDefault();
          if (opener.isConnected) opener.focus();
        }}
      >
        <DialogHeader title={t('chat.handoff-action')} />
        <DialogContentSection className="flex flex-col gap-ds-stack-related">
          <details className="rounded-ds-field bg-ds-neutral-muted-default px-ds-panel-inset py-ds-8">
            <summary className="cursor-pointer text-ds-text-base">
              {t('chat.handoff-reference')} · {source.agent.name}
            </summary>
            <DsText
              role="base"
              className="pt-ds-8 break-words whitespace-pre-wrap"
            >
              {source.output}
            </DsText>
          </details>
          <div className="grid grid-cols-1 gap-ds-control-gap sm:grid-cols-2">
            <Select
              value={agentId}
              disabled={sending}
              onValueChange={(id) => {
                if (id === agentId) return;
                setTasks([]);
                setTask('');
                setTools([]);
                setError('');
                setLoadFailed(false);
                setAgent(id);
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
                {targets.map((n) => (
                  <SelectItem key={n.id} value={n.id}>
                    {n.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={taskId}
              disabled={sending || !tasks.length}
              onValueChange={(id) => {
                setTask(id);
                setError('');
              }}
            >
              <SelectTrigger
                size="sm"
                title={t('chat.handoff-task')}
                aria-label={t('chat.handoff-task')}
                wrapperClassName="min-w-0"
              >
                <SelectValue placeholder={t('chat.handoff-task')} />
              </SelectTrigger>
              <SelectContent>
                {tasks.map((task) => (
                  <SelectItem key={task.id} value={task.id}>
                    {task.id === 'default'
                      ? t('chat.node-task-default')
                      : task.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {loadFailed && (
            <Button
              size="xs"
              variant="text"
              onClick={() => retry((v) => v + 1)}
            >
              {t('chat.session-agents-load-error')} ·{' '}
              {t('chat.session-agents-retry')}
            </Button>
          )}
          {target && !connection && (
            <DsText role="base" aria-live="polite">
              {t('chat.session-agents-unavailable')}
            </DsText>
          )}
          <Textarea
            variant="outlined"
            size="sm"
            title={t('chat.handoff-note')}
            aria-label={t('chat.handoff-note')}
            rows={3}
            maxLength={32000}
            value={note}
            disabled={sending}
            onChange={(e) => setNote(e.target.value)}
          />
          {target && (
            <TurnTools
              policy={target.tool_policy ?? {}}
              selected={tools}
              onChange={setTools}
              disabled={sending}
            />
          )}
          {error && (
            <DsText role="base" aria-live="assertive">
              {t(error)}
            </DsText>
          )}
        </DialogContentSection>
        <div className="flex shrink-0 justify-end gap-ds-control-gap border-x-0 border-t border-b-0 border-solid border-ds-hairline-subtle-default px-ds-panel-inset py-ds-12">
          <Button size="sm" variant="ghost" disabled={sending} onClick={close}>
            {t('chat.session-agents-cancel')}
          </Button>
          <Button
            size="sm"
            disabled={sending || !connection || !taskId}
            onClick={() => void confirm()}
          >
            {t('chat.handoff-confirm')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
