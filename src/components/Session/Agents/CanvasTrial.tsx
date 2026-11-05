import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogContentSection,
  DialogHeader,
} from '@/components/ui/dialog';
import { DsIcon } from '@/components/ui/ds-icon';
import { DsText } from '@/components/ui/ds-text';
import { Textarea } from '@/components/ui/textarea';
import type { ConfiguredModelChoice } from '@/lib/configuredModels';
import {
  sessionAgentApi,
  type CanvasTrial,
  type SessionAgent,
} from '@/service/sessionAgentApi';
import { resolveNodeConnection } from '@/service/sessionAgentModels';
import { Play } from 'lucide-react';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useTranslation } from 'react-i18next';

type Region = { id: string; agents: SessionAgent[] };
type PickNode = { project: string; agent: SessionAgent };
type Choice = { project: string; id: string; results: boolean };
type Step = CanvasTrial['steps'][number];
const Context = createContext<{
  trials: Record<string, CanvasTrial>;
  open: (c: Choice) => void;
}>({ trials: {}, open: () => {} });
const statusKey = (status: Step['status']) =>
  status === 'waiting'
    ? 'chat.tool-status-pending'
    : status === 'skipped'
      ? 'chat.trial-skipped'
      : 'chat.session-agents-status-' + status;

export function TrialAction({ project, agent }: PickNode) {
  const { t } = useTranslation(),
    { open, trials } = useContext(Context);
  return (
    <Button
      className="nodrag nopan"
      variant="ghost"
      size="xs"
      buttonContent="icon-only"
      aria-label={t('chat.canvas-trial') + ' · ' + agent.name}
      title={t('chat.canvas-trial')}
      disabled={trials[project]?.status === 'running'}
      onClick={() => open({ project, id: agent.id, results: false })}
    >
      <DsIcon icon={Play} recipe="main-compact" />
    </Button>
  );
}
export function TrialResult({
  project,
  agent,
  children,
}: PickNode & { children: ReactNode }) {
  const { t } = useTranslation(),
    { open, trials } = useContext(Context);
  const step = trials[project]?.steps.find((s) => s.agent_id === agent.id);
  if (!step) return <>{children}</>;
  return (
    <button
      type="button"
      className="nodrag nopan rounded-ds-control flex min-w-0 items-baseline gap-ds-6 bg-transparent text-left text-ds-ink-default-default"
      onClick={() => open({ project, id: agent.id, results: true })}
      title={t('chat.node-run-result') + ' · ' + agent.name}
      aria-label={t('chat.node-run-result') + ' · ' + agent.name}
    >
      <DsText role="meta" weight="semibold" className="shrink-0">
        {t(statusKey(step.status))}
      </DsText>
      <DsText role="base" className="truncate">
        {step.output || agent.model.name}
      </DsText>
    </button>
  );
}

// Poll only sessions that have an active execution. Closing a dialog never owns the run.
function Watch({
  account,
  project,
  epoch,
  receive,
}: {
  account: string;
  project: string;
  epoch: number;
  receive: (p: string, r: CanvasTrial) => void;
}) {
  useEffect(() => {
    let live = true,
      timer: ReturnType<typeof setTimeout>;
    const read = async () => {
      let retry = false;
      try {
        const row = await sessionAgentApi(account, project).latestTrial();
        if (live && row) {
          receive(project, row);
          retry = row.status === 'running';
        }
      } catch {
        retry = true;
      }
      if (live && retry) timer = setTimeout(read, 1000);
    };
    void read();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [account, project, epoch, receive]);
  return null;
}
function pathFrom(nodes: SessionAgent[], id: string) {
  const path: SessionAgent[] = [];
  while (id) {
    const node = nodes.find((n) => n.id === id);
    if (
      !node ||
      path.some((n) => n.id === id) ||
      path.length >= 32 ||
      (node.outputs?.length ?? 0) > 1
    )
      return null;
    path.push(node);
    id = node.outputs?.[0] ?? '';
  }
  return path;
}
export function CanvasTrials({
  account,
  regions,
  choices,
  email,
  children,
}: {
  account: string;
  regions: Region[];
  choices: ConfiguredModelChoice[];
  email: string;
  children: ReactNode;
}) {
  const [trials, setTrials] = useState<Record<string, CanvasTrial>>({}),
    [epochs, setEpochs] = useState<Record<string, number>>({});
  const [pick, open] = useState<Choice | null>(null);
  const receive = useCallback(
    (project: string, row: CanvasTrial) =>
      setTrials((old) => ({ ...old, [project]: row })),
    []
  );
  const region = regions.find((r) => r.id === pick?.project);
  return (
    <Context.Provider value={{ trials, open }}>
      {regions
        .filter((r) => r.agents.length > 0)
        .map((r) => (
          <Watch
            key={r.id}
            project={r.id}
            account={account}
            epoch={epochs[r.id] ?? 0}
            receive={receive}
          />
        ))}
      {children}
      {pick && region && (
        <TrialDialog
          key={pick.project + pick.id + pick.results}
          pick={pick}
          region={region}
          choices={choices}
          email={email}
          account={account}
          trial={trials[region.id]}
          close={() => open(null)}
          accepted={(row) => {
            receive(region.id, row);
            setEpochs((old) => ({
              ...old,
              [region.id]: (old[region.id] ?? 0) + 1,
            }));
            open(null);
          }}
        />
      )}
    </Context.Provider>
  );
}
function TrialDialog({
  pick,
  region,
  choices,
  email,
  account,
  trial,
  close,
  accepted,
}: {
  pick: Choice;
  region: Region;
  choices: ConfiguredModelChoice[];
  email: string;
  account: string;
  trial?: CanvasTrial;
  close: () => void;
  accepted: (r: CanvasTrial) => void;
}) {
  const { t } = useTranslation(),
    [prompt, setPrompt] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const lock = useRef(false),
    request = useRef({ key: '', id: '' });
  const path = pathFrom(region.agents, pick.id);
  const step = trial?.steps.find((s) => s.agent_id === pick.id);
  const start = async () => {
    if (lock.current || !path || !prompt.trim()) return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      let settings;
      try {
        settings = Object.fromEntries(
          path.map((n) => [
            n.id,
            {
              expected_revision: n.revision,
              email,
              connection: resolveNodeConnection(
                n,
                choices,
                region.agents,
                email
              ),
            },
          ])
        );
      } catch {
        setError('chat.space-model-unavailable');
        return;
      }
      const ids = path.map((n) => n.id),
        key = JSON.stringify([ids, prompt.trim(), path.map((n) => n.revision)]);
      if (request.current.key !== key)
        request.current = { key, id: crypto.randomUUID() };
      const row = await sessionAgentApi(account, region.id).startTrial({
        id: request.current.id,
        prompt: prompt.trim(),
        path: ids,
        settings,
      });
      accepted(row);
    } catch {
      setError('chat.session-agents-request-error');
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
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
        <DialogHeader
          title={t(pick.results ? 'chat.node-run-result' : 'chat.canvas-trial')}
          subtitle={
            pick.results ? step?.name : path?.map((n) => n.name).join(' → ')
          }
        />
        <DialogContentSection className="scrollbar-always-visible flex flex-col gap-ds-stack-related">
          {pick.results && step ? (
            <>
              <DsText role="meta" className="text-ds-ink-muted-default">
                {trial?.prompt}
              </DsText>
              <DsText role="base" weight="semibold" aria-live="polite">
                {t(statusKey(step.status))}
              </DsText>
              <DsText role="base" className="break-words whitespace-pre-wrap">
                {step.output ||
                  (step.status === 'failed'
                    ? t('chat.session-agents-run-error')
                    : '')}
              </DsText>
            </>
          ) : path ? (
            <>
              <label htmlFor="canvas-trial-input">
                <DsText role="base" weight="semibold">
                  {t('chat.trial-input')}
                </DsText>
              </label>
              <Textarea
                id="canvas-trial-input"
                autoFocus
                variant="outlined"
                size="sm"
                rows={4}
                maxLength={32000}
                disabled={busy}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
              />
              {error && <div role="alert">{t(error)}</div>}
              <Button
                size="sm"
                className="self-end"
                disabled={busy || !prompt.trim() || trial?.status === 'running'}
                onClick={() => void start()}
              >
                <DsIcon icon={Play} />
                {t('chat.canvas-trial')}
              </Button>
            </>
          ) : (
            <DsText role="base">{t('chat.trial-linear')}</DsText>
          )}
        </DialogContentSection>
      </DialogContent>
    </Dialog>
  );
}
