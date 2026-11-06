import { MarkDown } from '@/components/ChatBox/MessageItem/MarkDown';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DialogContentSection } from '@/components/ui/dialog';
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
import { useReactFlow } from '@xyflow/react';
import {
  ArrowRight,
  CheckCircle2,
  Circle,
  CircleAlert,
  CircleMinus,
  Clock3,
  Play,
} from 'lucide-react';
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
import { NodeInspector } from './NodeInspector';

type Region = { id: string; name?: string; agents: SessionAgent[] };
type PickNode = { project: string; agent: SessionAgent };
type Choice = {
  project: string;
  id: string;
  results: boolean;
  opener?: HTMLButtonElement;
};
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
      className="nodrag nopan shrink-0"
      variant="ghost"
      size="xs"
      aria-label={t('chat.canvas-trial') + ' · ' + agent.name}
      title={t('chat.canvas-trial')}
      disabled={trials[project]?.status === 'running'}
      onClick={(e) =>
        open({ project, id: agent.id, results: false, opener: e.currentTarget })
      }
    >
      <DsIcon icon={Play} recipe="main-compact" />
      {t('chat.canvas-trial')}
    </Button>
  );
}
export function TrialPreview({ project, agent }: PickNode) {
  const { trials, open } = useContext(Context);
  const step = trials[project]?.steps.find((s) => s.agent_id === agent.id);
  if (!step?.output) return null;
  return (
    <Button
      size="xs"
      variant="text"
      className="nodrag nopan min-w-0 justify-start"
      title={step.output}
      aria-label={step.output}
      onClick={(e) =>
        open({ project, id: agent.id, results: true, opener: e.currentTarget })
      }
    >
      <DsText role="meta" className="truncate">
        {step.output}
      </DsText>
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
    <Button
      size="xs"
      variant="text"
      className="nodrag nopan min-w-0 flex-1 justify-start px-0"
      onClick={(e) =>
        open({ project, id: agent.id, results: true, opener: e.currentTarget })
      }
      title={t('chat.node-run-result') + ' · ' + agent.name}
      aria-label={t('chat.node-run-result') + ' · ' + agent.name}
    >
      <DsIcon
        recipe="main-compact"
        icon={stateIcon(step.status)}
        className={stateColor(step.status)}
      />
      <DsText role="meta" className="truncate">
        {t(statusKey(step.status))}
      </DsText>
    </Button>
  );
}
function stateIcon(status: Step['status']) {
  return status === 'completed'
    ? CheckCircle2
    : status === 'running'
      ? Play
      : status === 'failed'
        ? CircleAlert
        : status === 'waiting'
          ? Clock3
          : CircleMinus;
}
function stateColor(status: Step['status']) {
  return status === 'completed'
    ? 'text-ds-text-success-strong-default'
    : status === 'failed'
      ? 'text-ds-text-error-strong-default'
      : status === 'running'
        ? 'text-ds-text-information-strong-default'
        : 'text-ds-ink-muted-default';
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
  inspectorOpen,
  onInspect,
}: {
  account: string;
  regions: Region[];
  choices: ConfiguredModelChoice[];
  email: string;
  children: ReactNode;
  inspectorOpen?: boolean;
  onInspect?: () => void;
}) {
  const [trials, setTrials] = useState<Record<string, CanvasTrial>>({}),
    [epochs, setEpochs] = useState<Record<string, number>>({});
  const [pick, setPick] = useState<Choice | null>(null);
  const flow = useReactFlow();
  const open = (choice: Choice) => {
    onInspect?.();
    setPick(choice);
  };
  useEffect(() => {
    if (inspectorOpen) setPick(null);
  }, [inspectorOpen]);
  const region = regions.find((r) => r.id === pick?.project);
  const pathIds =
    pick && region
      ? pick.results
        ? trials[region.id]?.steps.map((s) => s.agent_id)
        : pathFrom(region.agents, pick.id)?.map((n) => n.id)
      : undefined;
  const routeKey = JSON.stringify(pathIds);
  useEffect(() => {
    if (!routeKey) return;
    const ids: string[] = JSON.parse(routeKey);
    // The inline inspector changes canvas width; fit once after that layout.
    const frame = requestAnimationFrame(() => {
      void flow.fitView({
        nodes: ids.map((id) => ({ id })),
        padding: 0.24,
        maxZoom: 1,
        minZoom: 0.3,
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [routeKey, flow]);
  const receive = useCallback(
    (project: string, row: CanvasTrial) =>
      setTrials((old) => ({ ...old, [project]: row })),
    []
  );
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
      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col lg:flex-row">
        {children}
        {pick && region && (
          <TrialDialog
            key={pick.project + pick.results}
            pick={pick}
            region={region}
            choices={choices}
            email={email}
            account={account}
            trial={trials[region.id]}
            close={() => setPick(null)}
            accepted={(row) => {
              receive(region.id, row);
              setEpochs((old) => ({
                ...old,
                [region.id]: (old[region.id] ?? 0) + 1,
              }));
              setPick({ ...pick, results: true });
            }}
          />
        )}
      </div>
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
  const [chosen, setChosen] = useState(pick.id);
  useEffect(() => setChosen(pick.id), [pick.id]);
  const step = trial?.steps.find((s) => s.agent_id === chosen);
  const previous =
    trial && step ? trial.steps[trial.steps.indexOf(step) - 1] : undefined;
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
    <NodeInspector
      docked
      inline
      expanded={!pick.results}
      busy={busy}
      title={t(pick.results ? 'chat.node-run-result' : 'chat.canvas-trial')}
      subtitle={region.name}
      close={close}
      restoreFocus={() => pick.opener?.focus({ preventScroll: true })}
    >
      <DialogContentSection className="scrollbar-always-visible flex flex-col gap-ds-16">
        {pick.results && step && trial ? (
          <>
            <details>
              <summary className="cursor-pointer text-ds-text-meta text-ds-ink-muted-default focus-visible:ring-2 focus-visible:ring-ds-ring-focus">
                {t('chat.trial-input')}
              </summary>
              <DsText
                role="base"
                className="pt-ds-8 break-words whitespace-pre-wrap"
              >
                {trial.prompt}
              </DsText>
            </details>
            <nav
              aria-label={t('chat.node-run-result')}
              className="flex flex-wrap items-center gap-ds-4"
            >
              {trial.steps.map((s, i) => (
                <div
                  key={s.agent_id}
                  className="flex min-w-0 items-center gap-ds-4"
                >
                  {i > 0 && (
                    <DsIcon
                      icon={ArrowRight}
                      recipe="main-compact"
                      className="text-ds-ink-muted-default"
                    />
                  )}
                  <Button
                    size="sm"
                    variant={chosen === s.agent_id ? 'secondary' : 'ghost'}
                    aria-pressed={chosen === s.agent_id}
                    onClick={() => setChosen(s.agent_id)}
                    className="min-w-0"
                    title={s.name}
                  >
                    <DsIcon
                      icon={stateIcon(s.status)}
                      className={stateColor(s.status)}
                    />
                    <span className="truncate">{s.name}</span>
                  </Button>
                </div>
              ))}
            </nav>
            <section
              className="flex min-w-0 flex-col gap-ds-12"
              aria-label={step.name}
            >
              <div className="flex flex-wrap items-center gap-ds-control-gap">
                <DsText
                  as="h3"
                  role="body-large"
                  weight="semibold"
                  className="min-w-0 flex-1 break-words"
                >
                  {step.name}
                </DsText>
                <Badge
                  size="sm"
                  variant="secondary"
                  tone={
                    step.status === 'completed'
                      ? 'success'
                      : step.status === 'failed'
                        ? 'error'
                        : step.status === 'running'
                          ? 'information'
                          : 'neutral'
                  }
                  aria-live="polite"
                >
                  {t(statusKey(step.status))}
                </Badge>
              </div>
              {step.output ? (
                <MarkDown
                  content={step.output}
                  enableTypewriter={false}
                  profile="compact"
                />
              ) : (
                <DsText role="base" className="text-ds-ink-muted-default">
                  {t(
                    step.status === 'failed'
                      ? 'chat.session-agents-run-error'
                      : step.status === 'interrupted'
                        ? 'chat.session-agents-interrupted'
                        : statusKey(step.status)
                  )}
                </DsText>
              )}
            </section>
            {previous?.output && (
              <details className="border-x-0 border-t border-b-0 border-solid border-ds-hairline-default-default pt-ds-12">
                <summary className="cursor-pointer text-ds-text-base text-ds-ink-muted-default focus-visible:outline focus-visible:outline-2 focus-visible:outline-ds-ring-focus">
                  {t('chat.handoff-reference')} · {previous.name}
                </summary>
                <MarkDown
                  content={previous.output}
                  enableTypewriter={false}
                  profile="compact"
                  className="pt-ds-12"
                />
              </details>
            )}
          </>
        ) : path ? (
          <>
            <div className="flex flex-wrap items-center gap-ds-control-gap">
              {path.map((n, i) => (
                <div key={n.id} className="flex min-w-0 items-center gap-ds-6">
                  {i > 0 && (
                    <DsIcon
                      icon={ArrowRight}
                      recipe="main-compact"
                      className="text-ds-ink-muted-default"
                    />
                  )}
                  <DsText role="base" className="break-words">
                    {n.name}
                  </DsText>
                </div>
              ))}
            </div>
            <div className="flex flex-col gap-ds-8">
              <label htmlFor="canvas-trial-input">
                <DsText role="base" weight="semibold">
                  {t('chat.trial-input')}
                </DsText>
              </label>
              <Textarea
                id="canvas-trial-input"
                variant="outlined"
                size="sm"
                rows={5}
                maxLength={32000}
                disabled={busy}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
              />
            </div>
            {error && (
              <DsText
                role="base"
                as="p"
                aria-live="assertive"
                className="text-ds-text-error-strong-default"
              >
                {t(error)}
              </DsText>
            )}
          </>
        ) : (
          <DsText role="base">{t('chat.trial-linear')}</DsText>
        )}
      </DialogContentSection>
      {!pick.results && path && (
        <footer className="flex shrink-0 justify-end p-ds-panel-inset">
          <Button
            size="sm"
            disabled={busy || !prompt.trim() || trial?.status === 'running'}
            onClick={() => void start()}
          >
            <DsIcon icon={busy ? Circle : Play} />
            {t(
              busy ? 'chat.session-agents-status-running' : 'chat.canvas-trial'
            )}
          </Button>
        </footer>
      )}
    </NodeInspector>
  );
}
