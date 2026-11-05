import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogContentSection,
  DialogHeader,
} from '@/components/ui/dialog';
import { DsIcon } from '@/components/ui/ds-icon';
import { DsText } from '@/components/ui/ds-text';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { type ConfiguredModelChoice } from '@/lib/configuredModels';
import {
  type AgentTask,
  type SessionAgent,
  type SessionAgentRun,
  type sessionAgentApi,
} from '@/service/sessionAgentApi';
import { ArrowRight, Link2, Unlink2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AnswerHandoff } from './AnswerHandoff';

function Pick({
  label,
  value,
  set,
  items,
}: {
  label: string;
  value: string;
  set: (v: string) => void;
  items: { id: string; name: string }[];
}) {
  return (
    <Select value={value} onValueChange={set} disabled={!items.length}>
      <SelectTrigger
        size="sm"
        title={label}
        aria-label={label}
        wrapperClassName="min-w-0"
        className="w-full"
      >
        <SelectValue placeholder={label} />
      </SelectTrigger>
      <SelectContent fitTrigger>
        {items.map((i) => (
          <SelectItem key={i.id} value={i.id}>
            {i.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function CanvasLinks({
  source,
  initialTarget,
  nodes,
  api,
  choices,
  email,
  close,
  persist,
}: {
  source: SessionAgent;
  initialTarget?: string;
  nodes: SessionAgent[];
  api: ReturnType<typeof sessionAgentApi>;
  choices: ConfiguredModelChoice[];
  email: string;
  close: () => void;
  persist: (target: string, enabled: boolean) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [targetId, setTarget] = useState(
    initialTarget ?? source.outputs?.[0] ?? ''
  );
  const target = nodes.find((n) => n.id === targetId);
  const connected = !!source.outputs?.includes(targetId);
  const [tasks, setTasks] = useState<AgentTask[]>([]),
    [task, setTask] = useState('default');
  const [runs, setRuns] = useState<SessionAgentRun[] | null>(null),
    [run, setRun] = useState('');
  const [failed, setFailed] = useState(false),
    [revision, refresh] = useState(0),
    [busy, setBusy] = useState(false);
  const [handoff, setHandoff] = useState<{
    source: SessionAgentRun;
    opener: HTMLButtonElement;
  } | null>(null);
  const [saveFailed, setSaveFailed] = useState(false);
  useEffect(() => {
    let live = true;
    setFailed(false);
    setRuns(null);
    setRun('');
    if (connected)
      Promise.all([api.tasks(source.id), api.runs(source.id, task)])
        .then(([ts, rs]) => {
          if (!live) return;
          const done = rs
            .filter((r) => r.status === 'completed' && r.output.trim())
            .reverse();
          setTasks(ts);
          setRuns(done);
          setRun(done[0]?.id ?? '');
        })
        .catch(() => {
          if (live) setFailed(true);
        });
    return () => {
      live = false;
    };
  }, [api, source.id, task, connected, revision]);
  const mutate = async (enabled: boolean) => {
    if (busy || !target) return;
    setBusy(true);
    setSaveFailed(false);
    try {
      await persist(target.id, enabled);
    } catch {
      setSaveFailed(true);
    } finally {
      setBusy(false);
    }
  };
  if (handoff && target)
    return (
      <AnswerHandoff
        {...handoff}
        initialTarget={target.id}
        targets={[target]}
        allNodes={nodes}
        choices={choices}
        email={email}
        api={api}
        close={() => setHandoff(null)}
        delivered={close}
      />
    );
  return (
    <Dialog
      open
      onOpenChange={(v) => {
        if (!v && !busy) close();
      }}
    >
      <DialogContent
        size="md"
        overlayVariant="dimmed"
        aria-describedby={undefined}
      >
        <DialogHeader title={t('chat.canvas-links')} subtitle={source.name} />
        <DialogContentSection className="scrollbar-always-visible flex flex-col gap-ds-stack-related">
          <Pick
            label={t('chat.handoff-agent')}
            items={nodes
              .filter((n) => n.id !== source.id)
              .map((n) => ({
                id: n.id,
                name:
                  n.name +
                  (n.template_version ? ' · v' + n.template_version : ''),
              }))}
            value={targetId}
            set={(id) => {
              if (!busy) {
                setTarget(id);
                setSaveFailed(false);
              }
            }}
          />
          {target && connected && (
            <>
              <DsText
                role="base"
                className="flex flex-wrap items-center gap-ds-control-gap"
              >
                <DsIcon icon={Link2} />
                {source.name}
                <DsIcon icon={ArrowRight} />
                {target.name}
              </DsText>
              <Pick
                label={t('chat.node-task-select')}
                value={task}
                set={(id) => {
                  setTask(id);
                  setRuns(null);
                  setRun('');
                }}
                items={tasks.map((i) => ({
                  ...i,
                  name:
                    i.id === 'default' ? t('chat.node-task-default') : i.name,
                }))}
              />
              {failed ? (
                <Button
                  variant="text"
                  size="sm"
                  onClick={() => refresh((n) => n + 1)}
                >
                  {t('chat.session-agents-retry')}
                </Button>
              ) : runs?.length ? (
                <Pick
                  label={t('chat.handoff-reference')}
                  value={run}
                  set={setRun}
                  items={runs.map((r) => ({
                    id: r.id,
                    name:
                      new Date(r.created_at).toLocaleString() +
                      ' · ' +
                      r.output.slice(0, 80),
                  }))}
                />
              ) : (
                <DsText role="base" className="text-ds-ink-muted-default">
                  {t(
                    runs
                      ? 'chat.canvas-no-answer'
                      : 'chat.session-agents-loading'
                  )}
                </DsText>
              )}
            </>
          )}
          {saveFailed && <div role="alert">{t('chat.canvas-sync-error')}</div>}
        </DialogContentSection>
        <div className="flex flex-wrap items-center justify-end gap-ds-control-gap px-ds-panel-inset pb-ds-16">
          {connected ? (
            <>
              <Button
                className="mr-auto"
                variant="text"
                size="sm"
                disabled={busy}
                onClick={() => void mutate(false)}
              >
                <DsIcon icon={Unlink2} />
                {t('chat.canvas-unlink')}
              </Button>
              <Button
                size="sm"
                disabled={busy || !run || !runs}
                onClick={(e) => {
                  const selected = runs?.find((r) => r.id === run);
                  if (selected)
                    setHandoff({ source: selected, opener: e.currentTarget });
                }}
              >
                {t('chat.handoff-action')}
              </Button>
            </>
          ) : (
            <Button
              size="sm"
              disabled={!target || busy}
              onClick={() => void mutate(true)}
            >
              {t('chat.canvas-link')}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
