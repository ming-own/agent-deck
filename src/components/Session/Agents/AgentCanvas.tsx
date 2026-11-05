import { Button } from '@/components/ui/button';
import { DsIcon } from '@/components/ui/ds-icon';
import { DsText } from '@/components/ui/ds-text';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { sessionAgentApi, type SessionAgent } from '@/service/sessionAgentApi';
import {
  getVisibleProjectMetasForSpace,
  useSpaceStore,
} from '@/store/spaceStore';
import {
  Background,
  BackgroundVariant,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Node,
  type NodeProps,
  type OnNodesChange,
  type Viewport,
  type XYPosition,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
  Bot,
  Focus,
  Folder,
  Maximize,
  Minus,
  Pencil,
  Plus,
  Workflow,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

type EditNode = (
  project: string,
  opener: HTMLButtonElement,
  node?: SessionAgent
) => void;
type Region = {
  id: string;
  name: string;
  agents: SessionAgent[];
  failed: boolean;
  retry: () => void;
};
type AreaNode = Node<
  { region: Region; edit: EditNode; current: boolean },
  'sessionArea'
>;
type AgentNode = Node<
  { project: string; agent: SessionAgent; edit: EditNode },
  'agentCard'
>;
type OpenRouter = (
  project: string,
  name: string,
  agents: SessionAgent[],
  opener: HTMLButtonElement
) => void;
type RouterNode = Node<{ region: Region; openRouter: OpenRouter }, 'router'>;
type BoardNode = AreaNode | AgentNode | RouterNode;
// A pinned router occupies the strip above the editable Agent layout.
const ROUTER_STRIP = 52;

// Flow-space geometry, in unscaled world coordinates. Cards live inside their parent region.
const CARD_W = 224,
  CARD_H = 100,
  PAD = 24,
  HEADER = 64,
  GUTTER = 48;
const initialPosition = (index: number) => ({
  x: PAD + (index % 2) * 256,
  y: 72 + Math.floor(index / 2) * 132,
});

function SessionArea({ data }: NodeProps<AreaNode>) {
  const { t } = useTranslation();
  return (
    <div className="flex h-full w-full flex-col rounded-ds-panel border border-x border-y border-solid border-ds-hairline-default-default bg-ds-neutral-subtle-default">
      <div className="flex items-center gap-ds-control-gap px-ds-panel-inset py-ds-12">
        <DsIcon
          icon={Folder}
          className={
            data.current
              ? 'text-ds-ink-default-default'
              : 'text-ds-ink-muted-default'
          }
        />
        <DsText
          role="body-large"
          weight="semibold"
          className="min-w-0 truncate"
          title={data.region.name}
        >
          {data.region.name}
        </DsText>
        <DsText role="meta" className="text-ds-ink-muted-default">
          {data.region.agents.filter((a) => !a.workforce_member).length}
        </DsText>
        <Button
          className="nodrag nopan pointer-events-auto ml-auto"
          size="sm"
          variant="ghost"
          buttonContent="icon-only"
          aria-label={t('chat.canvas-add-in', { name: data.region.name })}
          title={t('chat.session-agents-add')}
          onClick={(e) => data.edit(data.region.id, e.currentTarget)}
        >
          <DsIcon icon={Plus} />
        </Button>
      </div>
      {data.region.failed && (
        <Button
          className="nodrag nopan pointer-events-auto self-start"
          size="sm"
          variant="text"
          onClick={data.region.retry}
        >
          {t('chat.session-agents-load-error')} ·{' '}
          {t('chat.session-agents-retry')}
        </Button>
      )}
      {!data.region.failed &&
        !data.region.agents.filter((a) => !a.workforce_member).length && (
          <div className="flex flex-1 items-center justify-center px-ds-panel-inset pb-ds-panel-inset">
            <DsText role="base" className="text-ds-ink-muted-default">
              {t('chat.session-agents-empty')}
            </DsText>
          </div>
        )}
    </div>
  );
}
function AgentCard({ data, selected }: NodeProps<AgentNode>) {
  const { t } = useTranslation(),
    a = data.agent;
  return (
    <div
      className={`flex h-full min-w-0 flex-col justify-center gap-ds-6 rounded-ds-card border border-x border-y border-solid bg-ds-neutral-subtle-default px-ds-12 shadow-ds-elevation-control ${selected ? 'border-ds-accent-strong-default' : 'border-ds-hairline-default-default'}`}
    >
      <div className="flex min-w-0 items-center gap-ds-control-gap">
        <DsIcon icon={a.workforce ? Workflow : Bot} />
        <DsText
          role="body-large"
          weight="semibold"
          className="min-w-0 flex-1 truncate"
          title={a.name}
        >
          {a.name}
        </DsText>
        <Button
          className="nodrag nopan"
          size="xs"
          variant="ghost"
          buttonContent="icon-only"
          aria-label={t('chat.canvas-edit-node', { name: a.name })}
          title={t('chat.session-agents-edit')}
          onClick={(e) => data.edit(data.project, e.currentTarget, a)}
        >
          <DsIcon icon={Pencil} recipe="main-compact" />
        </Button>
      </div>
      <DsText role="base" className="truncate" title={a.model.name}>
        {a.model.name}
      </DsText>
      <DsText role="meta" className="truncate text-ds-ink-muted-default">
        {a.workforce
          ? a.workforce.branches.map((b) => b.name).join(' / ')
          : a.harness_id === 'plan_execute'
            ? t('chat.node-harness-plan-execute')
            : t('chat.node-harness-standard')}
      </DsText>
    </div>
  );
}
function RouterCard({ data }: NodeProps<RouterNode>) {
  const { t } = useTranslation();
  return (
    <Button
      variant="secondary"
      size="sm"
      className="nodrag nopan pointer-events-auto"
      onClick={(e) =>
        data.openRouter(
          data.region.id,
          data.region.name,
          data.region.agents,
          e.currentTarget
        )
      }
    >
      <DsIcon icon={Workflow} />
      {t('chat.route-node')}
    </Button>
  );
}
const types = {
  sessionArea: SessionArea,
  agentCard: AgentCard,
  router: RouterCard,
};
function buildBoard(
  regions: Region[],
  current: string,
  edit: EditNode,
  offsets: Record<string, XYPosition>,
  openRouter: OpenRouter
): BoardNode[] {
  const nodes: BoardNode[] = [];
  let y = 0;
  for (let i = 0; i < regions.length; i += 2) {
    let x = 0,
      rowHeight = 0;
    for (const region of regions.slice(i, i + 2)) {
      const visible = region.agents.filter((a) => !a.workforce_member);
      const positions = visible.map(
        (agent, j) => offsets[agent.id] ?? agent.position ?? initialPosition(j)
      );
      const width = positions.reduce(
        (w, pos) => Math.max(w, pos.x + CARD_W + 64),
        visible.length > 1 ? 560 : 352
      );
      const height = positions.reduce(
        (h, pos) => Math.max(h, pos.y + CARD_H + 64),
        224
      );
      const parentId = 'region:' + region.id;
      nodes.push({
        id: parentId,
        type: 'sessionArea',
        position: { x, y },
        width,
        height: height + ROUTER_STRIP,
        draggable: false,
        selectable: false,
        focusable: false,
        data: { region, edit, current: region.id === current },
      });
      nodes.push({
        id: 'router:' + region.id,
        type: 'router',
        parentId,
        position: { x: PAD, y: HEADER },
        draggable: false,
        selectable: false,
        focusable: false,
        data: { region, openRouter },
      });
      visible.forEach((a, j) =>
        nodes.push({
          id: a.id,
          type: 'agentCard',
          parentId,
          position: { x: positions[j].x, y: positions[j].y + ROUTER_STRIP },
          width: CARD_W,
          height: CARD_H,
          extent: [
            [PAD, HEADER + ROUTER_STRIP],
            [1_000_000 + CARD_W, 1_000_000 + CARD_H + ROUTER_STRIP],
          ],
          ariaLabel: a.name,
          data: { agent: a, project: region.id, edit },
        })
      );
      rowHeight = Math.max(rowHeight, height + ROUTER_STRIP);
      x += width + GUTTER;
    }
    y += rowHeight + GUTTER;
  }
  return nodes;
}

function camera(key: string): Viewport | null {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? 'null');
    return v &&
      Number.isFinite(v.x) &&
      Number.isFinite(v.y) &&
      Number.isFinite(v.zoom) &&
      v.zoom >= 0.15 &&
      v.zoom <= 2
      ? v
      : null;
  } catch {
    return null;
  }
}

export function AgentCanvas(props: {
  account: string;
  projectId: string;
  refreshKey: number;
  openRouter: OpenRouter;
  edit: EditNode;
}) {
  return (
    <ReactFlowProvider>
      <CanvasBody {...props} />
    </ReactFlowProvider>
  );
}

function CanvasBody({
  account,
  projectId,
  refreshKey,
  openRouter,
  edit,
}: {
  account: string;
  projectId: string;
  refreshKey: number;
  openRouter: OpenRouter;
  edit: EditNode;
}) {
  const { t } = useTranslation();
  const meta = useSpaceStore((s) => s.getProjectMeta(projectId));
  const all = useSpaceStore((s) => s.projectsBySpaceId);
  const sessions = useMemo(() => {
    const visible = getVisibleProjectMetasForSpace(all, meta?.spaceId).sort(
      (a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id)
    );
    return visible.some((p) => p.id === projectId)
      ? visible.map((p) => ({ id: p.id, name: p.name }))
      : [
          {
            id: projectId,
            name: meta?.name || t('chat.session-agents-new-session'),
          },
        ];
  }, [all, meta?.spaceId, meta?.name, projectId, t]);
  const [failedProjects, setFailedProjects] = useState<string[]>([]);
  const sessionIds = JSON.stringify(sessions.map((s) => s.id));
  const [byProject, setByProject] = useState<Record<
    string,
    SessionAgent[]
  > | null>(null);
  const [error, setError] = useState(false),
    [attempt, setAttempt] = useState(0);
  const [offsets, setOffsets] = useState<Record<string, XYPosition>>({}),
    [selected, setSelected] = useState('');
  const [saving, setSaving] = useState<ReadonlySet<string>>(new Set());
  const busy = useRef(new Set<string>()),
    live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  useEffect(() => {
    let cancelled = false;
    const ids: string[] = JSON.parse(sessionIds);
    void Promise.allSettled(
      ids.map((id) => sessionAgentApi(account, id).list())
    ).then((results) => {
      if (cancelled) return;
      setFailedProjects(ids.filter((_, i) => results[i].status === 'rejected'));
      setByProject((old) => {
        const next: Record<string, SessionAgent[]> = {};
        results.forEach((result, i) => {
          const id = ids[i],
            previous = old?.[id] ?? [];
          const known = new Map(
            previous.map((agent) => [agent.id, agent.position])
          );
          next[id] =
            result.status === 'rejected'
              ? previous
              : result.value.map((agent) => {
                  const saved = known.get(agent.id);
                  return saved &&
                    saved.revision > (agent.position?.revision ?? 0)
                    ? { ...agent, position: saved }
                    : agent;
                });
        });
        return next;
      });
      setError(false);
    });
    return () => {
      cancelled = true;
    };
  }, [account, sessionIds, attempt, refreshKey]);
  const regions = useMemo(
    () =>
      sessions.map((s) => ({
        ...s,
        agents: byProject?.[s.id] ?? [],
        failed: failedProjects.includes(s.id),
        retry: () => setAttempt((n) => n + 1),
      })),
    [sessions, byProject, failedProjects]
  );
  const base = useMemo(
    () => buildBoard(regions, projectId, edit, offsets, openRouter),
    [regions, projectId, edit, offsets, openRouter]
  );
  const nodes = useMemo(
    () =>
      base.map((n) =>
        n.type === 'agentCard'
          ? {
              ...n,
              selected: n.id === selected,
              draggable: !saving.has(n.id),
            }
          : n
      ),
    [base, selected, saving]
  );
  const flow = useReactFlow<BoardNode>();
  const key =
    'agentdeck:canvas-camera:' +
    JSON.stringify([account, meta?.spaceId, projectId]);
  const focus = useCallback(
    (id = projectId) => {
      const area = base.find((n) => n.id === 'region:' + id);
      if (area)
        void flow.setViewport({
          x: 24 - area.position.x * 0.9,
          y: 60 - area.position.y * 0.9,
          zoom: 0.9,
        });
    },
    [base, flow, projectId]
  );
  const [initialized, setInitialized] = useState(false);
  const restored = useRef('');
  useEffect(() => {
    if (!initialized || !byProject || restored.current === key) return;
    restored.current = key;
    const v = camera(key);
    if (v) void flow.setViewport(v);
    else focus();
  }, [initialized, byProject, key, flow, focus]);

  const save = async (n: AgentNode, pos: XYPosition) => {
    busy.current.add(n.id);
    setSaving(new Set(busy.current));
    try {
      const saved = await sessionAgentApi(account, n.data.project).move(
        n.id,
        pos.x,
        pos.y,
        n.data.agent.position?.revision ?? 0
      );
      if (live.current)
        setByProject(
          (old) =>
            old && {
              ...old,
              [n.data.project]: (old[n.data.project] ?? []).map((a) =>
                a.id === n.id ? { ...a, position: saved } : a
              ),
            }
        );
    } catch {
      if (live.current) {
        setError(true);
      }
    } finally {
      busy.current.delete(n.id);
      if (live.current) setSaving(new Set(busy.current));
      if (live.current)
        setOffsets((old) => {
          const next = { ...old };
          delete next[n.id];
          return next;
        });
    }
  };
  const change: OnNodesChange<BoardNode> = (changes) => {
    for (const ch of changes) {
      if (ch.type === 'select') {
        setSelected((old) => (ch.selected ? ch.id : old === ch.id ? '' : old));
        continue;
      }
      if (ch.type !== 'position' || !ch.position || busy.current.has(ch.id))
        continue;
      const n = base.find((n) => n.id === ch.id);
      if (n?.type !== 'agentCard') continue;
      const pos = {
        x: Math.round(ch.position.x),
        y: Math.round(ch.position.y - ROUTER_STRIP),
      };
      setOffsets((old) => ({ ...old, [n.id]: pos }));
      if (!ch.dragging) void save(n, pos);
    }
  };
  return (
    <div
      className="relative min-h-0 min-w-0 flex-1 bg-ds-neutral-muted-default"
      aria-label={t('chat.canvas-title')}
    >
      {error && (
        <div
          role="alert"
          className="absolute inset-x-0 top-0 z-10 flex items-center justify-center gap-ds-control-gap bg-ds-neutral-subtle-default p-ds-8"
        >
          <DsText role="base">{t('chat.canvas-sync-error')}</DsText>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => setAttempt((v) => v + 1)}
          >
            {t('chat.session-agents-retry')}
          </Button>
        </div>
      )}
      {byProject ? (
        <ReactFlow<BoardNode>
          nodes={nodes}
          edges={[]}
          nodeTypes={types}
          onNodesChange={change}
          onInit={() => setInitialized(true)}
          onMoveEnd={(_, v) => {
            if (restored.current === key) {
              try {
                localStorage.setItem(key, JSON.stringify(v));
              } catch {
                /* camera preference is optional */
              }
            }
          }}
          minZoom={0.15}
          maxZoom={2}
          nodesConnectable={false}
          deleteKeyCode={null}
          multiSelectionKeyCode={null}
          zoomOnDoubleClick={false}
          proOptions={{ hideAttribution: true }}
        >
          <Background
            variant={BackgroundVariant.Dots}
            gap={20}
            size={1}
            color="var(--ds-hairline-default-default)"
          />
          <Panel position="top-left">
            <Select value="" onValueChange={(id) => focus(id)}>
              <SelectTrigger size="xs" aria-label={t('chat.canvas-locate')}>
                <SelectValue placeholder={t('chat.canvas-locate')} />
              </SelectTrigger>
              <SelectContent>
                {sessions.map((session) => (
                  <SelectItem key={session.id} value={session.id}>
                    {session.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Panel>
          <Panel position="bottom-left">
            <div className="flex items-center gap-ds-4 rounded-ds-field bg-ds-neutral-subtle-default p-ds-4 shadow-ds-elevation-control">
              {[
                {
                  icon: Minus,
                  label: 'layout.zoom-out',
                  action: () => flow.zoomOut(),
                },
                {
                  icon: Plus,
                  label: 'layout.zoom-in',
                  action: () => flow.zoomIn(),
                },
                { icon: Focus, label: 'chat.canvas-current', action: focus },
                {
                  icon: Maximize,
                  label: 'chat.canvas-fit',
                  action: () => flow.fitView({ padding: 0.12 }),
                },
              ].map(({ icon, label, action }) => (
                <Button
                  key={label}
                  size="sm"
                  variant="ghost"
                  buttonContent="icon-only"
                  title={t(label)}
                  aria-label={t(label)}
                  onClick={() => void action()}
                >
                  <DsIcon icon={icon} />
                </Button>
              ))}
            </div>
          </Panel>
        </ReactFlow>
      ) : (
        !error && (
          <DsText role="base" aria-live="polite" className="p-ds-panel-inset">
            {t('chat.session-agents-loading')}
          </DsText>
        )
      )}
    </div>
  );
}
