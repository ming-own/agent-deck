// ========= Copyright 2025-2026 @ Eigent.ai All Rights Reserved. =========
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
// ========= Copyright 2025-2026 @ Eigent.ai All Rights Reserved. =========

import ContentHeader from '@/components/Layout/ContentHeader';
import { AgentForm, CanvasNodeTasks } from '@/components/Session/Agents';
import { CanvasLinks } from '@/components/Session/Agents/CanvasLinks';
import {
  CanvasTrials,
  TrialAction,
} from '@/components/Session/Agents/CanvasTrial';
import { InstanceCardDesigner } from '@/components/Session/Agents/CardDesigner';
import { NodeInspector } from '@/components/Session/Agents/NodeInspector';
import {
  TaskRouter,
  type RouterLocation,
} from '@/components/Session/Agents/TaskRouter';
import { WorkforceDetails } from '@/components/Session/Agents/WorkforceDetails';
import { Workshop } from '@/components/Session/Agents/Workshop';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { DialogContentSection } from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { DsIcon } from '@/components/ui/ds-icon';
import { DsText } from '@/components/ui/ds-text';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useConfiguredModels } from '@/hooks/useConfiguredModels';
import { getAccountEnvironmentKey } from '@/lib/authEnvironment';
import { selectableConfiguredModels } from '@/lib/configuredModels';
import { ensureProjectRuntimeLoaded } from '@/lib/projectRuntimeHydration';
import { getActiveSpaceTriggerLabel } from '@/lib/spaceLabel';
import { sessionAgentApi } from '@/service/sessionAgentApi';
import { modelReference } from '@/service/sessionAgentModels';
import { proxyCreateSpaceProject } from '@/service/spaceApi';
import { useAuthStore } from '@/store/authStore';
import { usePageTabStore } from '@/store/pageTabStore';
import { useProjectRuntimeStore } from '@/store/projectRuntimeStore';
import { useSpaceStore } from '@/store/spaceStore';
import {
  Background,
  BackgroundVariant,
  MarkerType,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  useStore,
  type Connection,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
  CircleHelp,
  FolderOpen,
  LayoutGrid,
  Maximize,
  MessageCircle,
  Plus,
  RefreshCw,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { AutomationEditor } from './AutomationEditor';
import {
  buildWorkspaceGraph,
  graphItems,
  nodeId,
  type GraphItem,
  type GraphNode,
} from './graphModel';
import {
  WorkspaceObjectNode,
  WorkspaceSessionNode,
  kindIcons,
} from './GraphNodes';
import { createResourceConnector } from './resourceConnections';
import {
  ContextEditor,
  MemoryEditor,
  ReferenceEditor,
} from './ResourceEditors';
import { useWorkspaceGraph, type WorkspaceAgent } from './useWorkspaceGraph';
const agentFlowId = (id: string) => nodeId('agent', id);
const nodeTypes = {
  object: WorkspaceObjectNode,
  session: WorkspaceSessionNode,
};

export default function WorkspaceGraph({
  onConversation,
}: {
  onConversation: () => void;
}) {
  const { t } = useTranslation();
  const auth = useAuthStore(),
    space = useSpaceStore((s) =>
      s.activeSpaceId ? s.spaces[s.activeSpaceId] : null
    ),
    account = getAccountEnvironmentKey(auth);
  if (!space) return null;
  return (
    <ReactFlowProvider key={account + ':' + space.id}>
      <WorkspaceGraphBody
        account={account}
        spaceId={space.id}
        spaceName={getActiveSpaceTriggerLabel(space.name, t)}
        email={auth.email ?? ''}
        onConversation={onConversation}
      />
    </ReactFlowProvider>
  );
}
function WorkspaceGraphBody({
  account,
  spaceId,
  spaceName,
  email,
  onConversation,
}: {
  account: string;
  spaceId: string;
  spaceName: string;
  email: string;
  onConversation: () => void;
}) {
  const { t } = useTranslation(),
    navigate = useNavigate(),
    flow = useReactFlow<GraphNode>(),
    data = useWorkspaceGraph(account, spaceId);
  const canvasWidth = useStore((s) => s.width),
    canvasHeight = useStore((s) => s.height);
  const connectResource = useMemo(
    () => createResourceConnector(data.api),
    [data.api]
  );
  const inventory = useConfiguredModels(),
    choices = selectableConfiguredModels(inventory);
  const [showTasks, setShowTasks] = useState(false),
    [showMembers, setShowMembers] = useState(false);
  const [link, setLink] = useState<{
    source: WorkspaceAgent;
    target: string;
  } | null>(null);
  const restored = useRef(false);
  const [view, setView] = useState('canvas'),
    [pick, setPick] = useState<GraphItem | null>(null),
    [edit, setEdit] = useState<{
      projectId: string;
      node?: WorkspaceAgent;
    } | null>(null),
    [panelTab, setPanelTab] = useState('details');
  const expansionKey =
    'agentdeck:workspace-expanded:' + JSON.stringify([account, spaceId]);
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(expansionKey) ?? 'null');
      if (Array.isArray(saved) && saved.every((id) => typeof id === 'string'))
        return new Set(saved);
    } catch {}
    return new Set(
      [useSpaceStore.getState().lastVisitedProjectBySpace[spaceId]].filter(
        Boolean
      )
    );
  });
  useEffect(() => {
    try {
      localStorage.setItem(expansionKey, JSON.stringify([...expanded]));
    } catch {}
  }, [expanded, expansionKey]);
  const [router, setRouter] = useState<RouterLocation | null>(null),
    [workshop, setWorkshop] = useState<string | null>(null);
  const [workshopSource, setWorkshopSource] = useState<
    WorkspaceAgent | undefined
  >();
  const [appearance, setAppearance] = useState<WorkspaceAgent | null>(null);
  const workshopApi = useMemo(
    () => sessionAgentApi(account, workshop ?? '__card-library__'),
    [account, workshop]
  );
  const appearanceApi = useMemo(
    () => sessionAgentApi(account, appearance?.projectId ?? ''),
    [account, appearance?.projectId]
  );
  const [error, setError] = useState(false),
    [saving, setSaving] = useState<Set<string>>(new Set()),
    [initialized, setInitialized] = useState(false),
    [positionEpoch, setPositionEpoch] = useState(0);
  const [offsets, setOffsets] = useState<
    Record<string, { x: number; y: number }>
  >({});
  const [measured, setMeasured] = useState<
    Record<string, { width: number; height: number }>
  >({});
  const cameraKey =
    'agentdeck:workspace-camera:' + JSON.stringify([account, spaceId]);
  const openSettings = () =>
    navigate(
      '/home?section=spaces&spaceId=' +
        encodeURIComponent(spaceId) +
        '&spaceTab=workspace-profile'
    );
  const open = useCallback((item: GraphItem) => {
    setEdit(null);
    setPanelTab(item.kind === 'task' ? 'conversation' : 'details');
    setPick(item);
  }, []);
  const toggle = useCallback(
    (id: string) =>
      setExpanded((old) => {
        const next = new Set(old);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      }),
    []
  );
  const items = graphItems(data, spaceName);
  const board = buildWorkspaceGraph(data, items, expanded, open, toggle, {
    tasks: showTasks,
    members: showMembers,
  });
  const edges = board.edges.map((e) => ({
    ...e,
    label:
      e.data?.relation === 'output'
        ? undefined
        : t('chat.workspace-relation-' + String(e.data?.relation)),
    markerEnd: {
      type: MarkerType.ArrowClosed,
      color: 'var(--ds-ink-muted-default)',
    },
    labelStyle: { fill: 'var(--ds-ink-muted-default)' },
    labelBgStyle: { fill: 'var(--ds-neutral-subtle-default)' },
  }));
  const api = useMemo(
    () => sessionAgentApi(account, pick?.projectId ?? edit?.projectId ?? ''),
    [account, pick?.projectId, edit?.projectId]
  );
  const regions = useMemo(
    () =>
      data.sessions.map((s) => ({
        id: s.id,
        name: s.name,
        agents: data.agents.filter((a) => a.projectId === s.id),
      })),
    [data.sessions, data.agents]
  );
  const freshPick =
    pick?.id === 'new'
      ? pick
      : pick
        ? (items.find((i) => i.kind === pick.kind && i.id === pick.id) ?? null)
        : null;
  const agent = freshPick?.agent;
  const pickedNodeReady =
    !!pick &&
    board.nodes.some(
      (n) =>
        n.id ===
        nodeId(pick.agent ? 'agent' : pick.kind, pick.agent?.id ?? pick.id)
    );
  useEffect(() => {
    if (
      view !== 'canvas' ||
      !pick ||
      !pickedNodeReady ||
      pick.id === 'new' ||
      !canvasWidth ||
      !canvasHeight
    )
      return;
    const id = pick.agent
      ? nodeId('agent', pick.agent.id)
      : nodeId(pick.kind, pick.id);
    const frame = requestAnimationFrame(() => {
      void flow.fitView({ nodes: [{ id }], padding: 0.3, maxZoom: 0.9 });
    });
    return () => cancelAnimationFrame(frame);
  }, [pick, pickedNodeReady, view, flow, canvasWidth, canvasHeight]);
  const openSession = (id: string) => {
    useProjectRuntimeStore.getState().setActiveProject(id);
    useSpaceStore.getState().setLastVisitedProject(spaceId, id);
    usePageTabStore.getState().setActiveWorkspaceTab('project');
  };
  useEffect(() => {
    if (!initialized || data.loading || restored.current) return;
    restored.current = true;
    try {
      const v = JSON.parse(localStorage.getItem(cameraKey) ?? 'null');
      if (
        v &&
        Number.isFinite(v.x) &&
        Number.isFinite(v.y) &&
        v.zoom >= 0.15 &&
        v.zoom <= 2
      ) {
        void flow.setViewport(v);
        return;
      }
    } catch {}
    const first =
      board.nodes.find((n) => n.type === 'session' && n.data.expanded) ??
      board.nodes[0];
    if (first)
      void flow.fitView({
        nodes: [{ id: first.id }],
        padding: 0.18,
        maxZoom: 0.9,
      });
  }, [initialized, data.loading, board.nodes, cameraKey, flow]);
  const connect = async (c: Connection) => {
    const source = board.nodes.find((n) => n.id === c.source)?.data.item,
      target = board.nodes.find((n) => n.id === c.target)?.data.item;
    if (!source || !target?.agent || target.kind !== 'agent') return;
    setError(false);
    try {
      if (
        source.kind === 'agent' &&
        source.agent?.projectId === target.projectId
      )
        await sessionAgentApi(account, target.projectId!).setLink(
          source.id,
          target.id,
          true
        );
      else if (
        source.kind === 'context' ||
        source.kind === 'memory' ||
        source.kind === 'automation'
      ) {
        const change = await connectResource(
          { kind: source.kind, id: source.id },
          { id: target.id, projectId: target.projectId! }
        );
        data.setGraph(
          (graph) =>
            graph &&
            (change.kind === 'references'
              ? {
                  ...graph,
                  agent_references: [
                    ...graph.agent_references.filter(
                      (r) => r.agent_id !== change.value.agent_id
                    ),
                    change.value,
                  ],
                }
              : {
                  ...graph,
                  automation_bindings: [
                    ...graph.automation_bindings.filter(
                      (b) => b.trigger_id !== change.value.trigger_id
                    ),
                    change.value,
                  ],
                })
        );
      } else return;
      data.refresh();
    } catch {
      setError(true);
    }
  };
  const create = (kind: GraphItem['kind']) => {
    if (kind === 'automation') {
      usePageTabStore.getState().setActiveWorkspaceTab('triggers');
      usePageTabStore.getState().requestOpenTriggerAddDialog();
      return;
    }
    setPanelTab('details');
    setPick({ kind, id: 'new', name: t('chat.workspace-add-' + kind) });
  };
  const saved = () => {
    data.refresh();
    setPick(null);
  };
  const visibleItems =
    view === 'canvas' ? items : items.filter((i) => i.kind === view);
  return (
    <section
      className="relative flex min-h-0 min-w-0 flex-1 flex-col bg-ds-neutral-subtle-default"
      aria-label={t('chat.workspace-title')}
    >
      <ContentHeader title={spaceName} leading={<DsIcon icon={LayoutGrid} />}>
        <div className="ml-auto flex items-center gap-ds-control-gap">
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              setWorkshopSource(undefined);
              setWorkshop(
                pick?.projectId ?? data.sessions[0]?.id ?? '__card-library__'
              );
            }}
          >
            {t('chat.workshop')}
          </Button>
          <Button size="sm" variant="ghost" onClick={onConversation}>
            <DsIcon icon={MessageCircle} />
            {t('chat.canvas-chat')}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            buttonContent="icon-only"
            aria-label={t('chat.session-agents-retry')}
            onClick={data.refresh}
          >
            <DsIcon icon={RefreshCw} />
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm">
                <DsIcon icon={Plus} />
                {t('chat.workspace-add')}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {(
                ['session', 'agent', 'context', 'memory', 'automation'] as const
              ).map((k) => (
                <DropdownMenuItem key={k} onSelect={() => create(k)}>
                  <DsIcon icon={kindIcons[k]} />
                  {t('chat.workspace-add-' + k)}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </ContentHeader>
      <div className="scrollbar-overlay shrink-0 overflow-x-auto px-ds-12">
        <Tabs
          value={view}
          onValueChange={(v) => {
            if (v === 'settings') openSettings();
            else {
              setView(v);
              setPick(null);
            }
          }}
        >
          <TabsList appearance="border" aria-label={t('chat.workspace-title')}>
            {[
              'canvas',
              'session',
              'task',
              'automation',
              'context',
              'memory',
              'settings',
            ].map((k) => (
              <TabsTrigger key={k} value={k}>
                {t(
                  k === 'canvas' ? 'chat.canvas-title' : 'chat.workspace-' + k
                )}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>
      {(error || data.errors.length > 0) && (
        <div
          role="alert"
          className="flex items-center gap-ds-control-gap px-ds-panel-inset py-ds-8"
        >
          <DsText role="base">
            {t(
              error ? 'chat.workspace-save-error' : 'chat.workspace-load-error'
            )}
          </DsText>
          <Button
            size="xs"
            variant="text"
            onClick={() => {
              setError(false);
              data.refresh();
            }}
          >
            {t('chat.session-agents-retry')}
          </Button>
        </div>
      )}
      {data.loading && !data.graph ? (
        <DsText role="base" className="p-ds-panel-inset">
          {t('chat.session-agents-loading')}
        </DsText>
      ) : (
        <CanvasTrials
          flowNodeId={agentFlowId}
          account={account}
          regions={regions}
          choices={choices}
          email={email}
          inspectorOpen={!!pick || !!edit}
          onInspect={() => {
            setPick(null);
            setEdit(null);
          }}
        >
          <div className="relative flex min-h-0 min-w-0 flex-1 flex-col lg:flex-row">
            <div className="workspace-card-canvas relative min-h-0 min-w-0 flex-1">
              {view === 'canvas' ? (
                <ReactFlow<GraphNode>
                  key={positionEpoch}
                  nodes={board.nodes.map((n) => ({
                    ...n,
                    measured: measured[n.id],
                    position: offsets[n.id] ?? n.position,
                    draggable: !saving.has(n.id),
                  }))}
                  edges={edges}
                  nodeTypes={nodeTypes}
                  onInit={() => setInitialized(true)}
                  onNodeClick={(_, n) => {
                    if (n.data.item.kind === 'settings') openSettings();
                  }}
                  onNodeDoubleClick={(_, n) =>
                    n.data.item.kind === 'session'
                      ? toggle(n.data.item.id)
                      : open(n.data.item)
                  }
                  onEdgeClick={(_, edge) => {
                    if (edge.data?.relation === 'output') {
                      const source = data.agents.find(
                        (a) => nodeId('agent', a.id) === edge.source
                      );
                      if (source)
                        setLink({ source, target: edge.target.slice(6) });
                    } else if (
                      edge.data?.relation === 'context' ||
                      edge.data?.relation === 'memory'
                    ) {
                      const target = items.find(
                        (i) => nodeId(i.kind, i.id) === edge.target
                      );
                      if (target) {
                        open(target);
                        setPanelTab('references');
                      }
                    } else if (edge.data?.relation === 'trigger') {
                      const source = items.find(
                        (i) => nodeId(i.kind, i.id) === edge.source
                      );
                      if (source) open(source);
                    }
                  }}
                  onConnect={(c) => void connect(c)}
                  connectOnClick
                  isValidConnection={(c) => {
                    const a = board.nodes.find((n) => n.id === c.source)?.data
                        .item,
                      b = board.nodes.find((n) => n.id === c.target)?.data.item;
                    return (
                      !!a &&
                      b?.kind === 'agent' &&
                      a.id !== b.id &&
                      (['context', 'memory', 'automation'].includes(a.kind) ||
                        (a.kind === 'agent' && a.projectId === b.projectId))
                    );
                  }}
                  onNodesChange={(changes) => {
                    const dimensions = changes.flatMap((c) =>
                      c.type === 'dimensions' && c.dimensions
                        ? [[c.id, c.dimensions] as const]
                        : []
                    );
                    if (dimensions.length)
                      setMeasured((old) => {
                        if (
                          dimensions.every(
                            ([id, size]) =>
                              old[id]?.width === size.width &&
                              old[id]?.height === size.height
                          )
                        )
                          return old;
                        return { ...old, ...Object.fromEntries(dimensions) };
                      });
                    for (const c of changes)
                      if (c.type === 'position' && c.position)
                        setOffsets((old) => ({ ...old, [c.id]: c.position! }));
                  }}
                  onNodeDragStop={async (_, n) => {
                    setSaving((old) => new Set([...old, n.id]));
                    setError(false);
                    const item = n.data.item,
                      prior = data.graph?.positions.find(
                        (p) => p.kind === item.kind && p.object_id === item.id
                      );
                    try {
                      const p = await data.api.move({
                        kind: item.kind,
                        object_id: item.id,
                        x: n.position.x,
                        y: n.position.y,
                        expected_revision: prior?.revision ?? 0,
                      });
                      data.setGraph(
                        (g) =>
                          g && {
                            ...g,
                            positions: [
                              ...g.positions.filter(
                                (p) =>
                                  p.kind !== item.kind ||
                                  p.object_id !== item.id
                              ),
                              p,
                            ],
                          }
                      );
                    } catch {
                      setError(true);
                      setPositionEpoch((e) => e + 1);
                    } finally {
                      setSaving((old) => {
                        const x = new Set(old);
                        x.delete(n.id);
                        return x;
                      });
                      setOffsets((old) => {
                        const next = { ...old };
                        delete next[n.id];
                        return next;
                      });
                    }
                  }}
                  onMoveEnd={(_, v) => {
                    try {
                      localStorage.setItem(cameraKey, JSON.stringify(v));
                    } catch {}
                  }}
                  minZoom={0.15}
                  maxZoom={2}
                  deleteKeyCode={null}
                  proOptions={{ hideAttribution: true }}
                >
                  <Panel position="top-left">
                    <div className="flex flex-wrap items-center gap-ds-12 rounded-ds-field bg-ds-neutral-subtle-default p-ds-8">
                      <label className="flex items-center gap-ds-6">
                        <Checkbox
                          checked={showTasks}
                          onCheckedChange={(v) => setShowTasks(v === true)}
                        />
                        <DsText role="meta">
                          {t('chat.workspace-show-tasks')}
                        </DsText>
                      </label>
                      <label className="flex items-center gap-ds-6">
                        <Checkbox
                          checked={showMembers}
                          onCheckedChange={(v) => setShowMembers(v === true)}
                        />
                        <DsText role="meta">{t('chat.team-members')}</DsText>
                      </label>
                      <Button
                        variant="ghost"
                        size="sm"
                        buttonContent="icon-only"
                        aria-label={t('chat.workspace-connect-help')}
                        title={t('chat.workspace-connect-help')}
                      >
                        <DsIcon icon={CircleHelp} />
                      </Button>
                    </div>
                  </Panel>
                  <Background
                    variant={BackgroundVariant.Dots}
                    gap={24}
                    color="var(--ds-hairline-default-default)"
                  />
                  <Panel position="bottom-left">
                    <div className="flex items-center gap-ds-4 rounded-ds-field bg-ds-neutral-subtle-default p-ds-4 shadow-ds-elevation-control">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => void flow.zoomOut()}
                      >
                        −
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => void flow.zoomIn()}
                      >
                        +
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => void flow.fitView({ padding: 0.15 })}
                      >
                        <DsIcon icon={Maximize} />
                        {t('chat.canvas-fit')}
                      </Button>
                    </div>
                  </Panel>
                </ReactFlow>
              ) : (
                <div className="scrollbar-always-visible h-full overflow-y-auto p-ds-panel-inset">
                  <div className="flex flex-col gap-ds-8">
                    {visibleItems.map((item) => (
                      <Button
                        key={nodeId(item.kind, item.id)}
                        variant="ghost"
                        size="lg"
                        className="w-full justify-start"
                        onClick={() => open(item)}
                      >
                        <DsIcon icon={kindIcons[item.kind]} />
                        <span className="min-w-0 truncate">
                          {item.name === 'default'
                            ? t('chat.node-task-default')
                            : item.name}
                        </span>
                      </Button>
                    ))}
                  </div>
                  {!visibleItems.length && (
                    <DsText role="base" className="text-ds-ink-muted-default">
                      {t('chat.workspace-empty')}
                    </DsText>
                  )}
                </div>
              )}
            </div>
            {freshPick && !edit && (
              <NodeInspector
                docked
                inline
                title={
                  freshPick.id === 'new'
                    ? freshPick.name
                    : t('chat.workspace-' + freshPick.kind)
                }
                subtitle={freshPick.id === 'new' ? undefined : freshPick.name}
                busy={false}
                close={() => setPick(null)}
              >
                <DialogContentSection className="scrollbar-always-visible flex flex-col gap-ds-16">
                  {freshPick.kind === 'context' && (
                    <ContextEditor
                      key={
                        freshPick.id +
                        ':' +
                        (data.graph?.contexts.find((c) => c.id === freshPick.id)
                          ?.revision ?? 0)
                      }
                      data={data}
                      document={data.graph?.contexts.find(
                        (c) => c.id === freshPick.id
                      )}
                      onSaved={saved}
                    />
                  )}
                  {freshPick.kind === 'memory' && (
                    <MemoryEditor
                      account={account}
                      key={
                        freshPick.id +
                        ':' +
                        (data.memories.find((m) => m.memory_id === freshPick.id)
                          ?.version ?? 0)
                      }
                      spaceId={spaceId}
                      entry={data.memories.find(
                        (m) => m.memory_id === freshPick.id
                      )}
                      onSaved={saved}
                    />
                  )}
                  {freshPick.kind === 'session' &&
                    (freshPick.id === 'new' ? (
                      <NewSession
                        account={account}
                        spaceId={spaceId}
                        done={saved}
                      />
                    ) : (
                      <>
                        <DsText role="base">
                          {t('chat.workspace-session-help')}
                        </DsText>
                        <Button
                          size="sm"
                          onClick={() => {
                            setExpanded(
                              (old) => new Set([...old, freshPick.id])
                            );
                            setView('canvas');
                            setPick(null);
                            void flow.fitView({
                              nodes: [{ id: nodeId('session', freshPick.id) }],
                              padding: 0.15,
                              maxZoom: 0.9,
                            });
                          }}
                        >
                          {t('chat.workspace-expand')}
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => {
                            setEdit({ projectId: freshPick.id });
                            setPick(null);
                          }}
                        >
                          {t('chat.session-agents-add')}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => openSession(freshPick.id)}
                        >
                          <DsIcon icon={FolderOpen} />
                          {t('chat.workspace-open')}
                        </Button>
                      </>
                    ))}
                  {freshPick.kind === 'agent' && freshPick.id === 'new' && (
                    <>
                      <DsText role="base">
                        {t('chat.workspace-choose-session')}
                      </DsText>
                      {data.sessions.map((s) => (
                        <Button
                          key={s.id}
                          size="sm"
                          variant="secondary"
                          onClick={() => {
                            setEdit({ projectId: s.id });
                            setPick(null);
                          }}
                        >
                          {s.name}
                        </Button>
                      ))}
                      {!data.sessions.length && (
                        <Button size="sm" onClick={() => create('session')}>
                          {t('chat.workspace-add-session')}
                        </Button>
                      )}
                    </>
                  )}
                  {freshPick.historyTaskId && (
                    <Button
                      size="sm"
                      onClick={async () => {
                        const id = freshPick.projectId!;
                        openSession(id);
                        const store = useProjectRuntimeStore.getState();
                        await ensureProjectRuntimeLoaded(store, id);
                        const project = useProjectRuntimeStore
                          .getState()
                          .getProjectById(id);
                        for (const [chatId, chat] of Object.entries(
                          project?.chatStores ?? {}
                        )) {
                          if (chat.getState().tasks[freshPick.historyTaskId!]) {
                            useProjectRuntimeStore
                              .getState()
                              .setActiveChatStore(id, chatId);
                            chat
                              .getState()
                              .setActiveTaskId(freshPick.historyTaskId!);
                            break;
                          }
                        }
                      }}
                    >
                      {t('chat.workspace-open')}
                    </Button>
                  )}
                  {agent && (
                    <>
                      <Tabs value={panelTab} onValueChange={setPanelTab}>
                        <TabsList appearance="border">
                          {['details', 'conversation', 'references'].map(
                            (v) => (
                              <TabsTrigger key={v} value={v}>
                                {t('chat.workspace-' + v)}
                              </TabsTrigger>
                            )
                          )}
                        </TabsList>
                      </Tabs>
                      {panelTab === 'references' ? (
                        <ReferenceEditor
                          key={
                            agent.id +
                            ':' +
                            (data.graph?.agent_references.find(
                              (r) => r.agent_id === agent.id
                            )?.revision ?? 0)
                          }
                          data={data}
                          agent={agent}
                          onSaved={data.refresh}
                        />
                      ) : panelTab === 'conversation' ? (
                        <CanvasNodeTasks
                          key={agent.id + ':' + freshPick.task?.id}
                          initialTaskId={freshPick.task?.id}
                          node={agent}
                          api={api}
                          choices={choices}
                          email={email}
                          account={account}
                          project={agent.projectId}
                          modelsLoading={
                            inventory.loading || inventory.codexModelsLoading
                          }
                          openRouter={setRouter}
                        />
                      ) : (
                        <>
                          <div className="flex flex-wrap gap-ds-8">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => setAppearance(agent)}
                            >
                              {t('chat.card-appearance')}
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => {
                                setWorkshopSource(agent);
                                setWorkshop(agent.projectId);
                              }}
                            >
                              {t('chat.card-save-to-library')}
                            </Button>
                          </div>
                          <DsText role="base">
                            {agent.role ||
                              agent.instructions ||
                              t('chat.session-agents-default-role')}
                          </DsText>
                          <DsText
                            role="meta"
                            className="text-ds-ink-muted-default"
                          >
                            {agent.model.name}
                          </DsText>
                          <Button
                            size="sm"
                            onClick={() =>
                              setEdit({
                                projectId: agent.projectId,
                                node: agent,
                              })
                            }
                          >
                            {t('chat.session-agents-edit')}
                          </Button>
                          <TrialAction
                            project={agent.projectId}
                            agent={agent}
                          />
                        </>
                      )}
                    </>
                  )}
                  {freshPick.kind === 'automation' && (
                    <AutomationEditor
                      key={
                        freshPick.id +
                        ':' +
                        (data.graph?.automation_bindings.find(
                          (b) => b.trigger_id === freshPick.id
                        )?.revision ?? 0)
                      }
                      data={data}
                      triggerId={freshPick.id}
                      done={data.refresh}
                    />
                  )}
                </DialogContentSection>
              </NodeInspector>
            )}
          </div>
        </CanvasTrials>
      )}
      {link && (
        <CanvasLinks
          source={link.source}
          initialTarget={link.target}
          nodes={data.agents.filter(
            (a) => a.projectId === link.source.projectId
          )}
          api={sessionAgentApi(account, link.source.projectId)}
          choices={choices}
          email={email}
          close={() => setLink(null)}
          persist={async (target, enabled) => {
            await sessionAgentApi(account, link.source.projectId).setLink(
              link.source.id,
              target,
              enabled
            );
            data.refresh();
            setLink(null);
          }}
        />
      )}
      {edit &&
        (edit.node?.workforce ? (
          <WorkforceDetails
            docked
            node={edit.node}
            api={sessionAgentApi(account, edit.projectId)}
            epoch={data.epoch}
            choices={choices}
            email={email}
            close={() => setEdit(null)}
            edit={(node) =>
              setEdit({
                projectId: edit.projectId,
                node: { ...node, projectId: edit.projectId },
              })
            }
            save={() => {
              setWorkshopSource(edit.node);
              setWorkshop(edit.projectId);
            }}
            updated={() => {
              data.refresh();
              setEdit(null);
            }}
          />
        ) : (
          <AgentForm
            docked
            node={edit.node}
            choices={choices}
            loadSkills={sessionAgentApi(account, edit.projectId).skills}
            restoreFocus={() => {}}
            onCancel={() => setEdit(null)}
            onSave={async (name, choice, behavior) => {
              const a = sessionAgentApi(account, edit.projectId);
              if (edit.node)
                await a.update(
                  edit.node,
                  name,
                  modelReference(choice),
                  behavior
                );
              else await a.create(name, modelReference(choice), behavior);
              setExpanded((old) => new Set([...old, edit.projectId]));
              setEdit(null);
              data.refresh();
            }}
          />
        ))}
      {router && (
        <TaskRouter
          location={router}
          account={account}
          choices={choices}
          email={email}
          close={() => setRouter(null)}
          onTaskCreated={data.refresh}
          openWorkshop={() => {
            setWorkshopSource(undefined);
            setWorkshop(router.project);
          }}
        />
      )}
      {workshop && (
        <Workshop
          key={workshop}
          embedded
          projectId={workshop}
          api={workshopApi}
          initialNode={workshopSource}
          choices={choices}
          sessions={data.sessions.map((s) => ({ id: s.id, name: s.name }))}
          resolveApi={(id) => sessionAgentApi(account, id)}
          createSession={async (name, id) => {
            const p = await proxyCreateSpaceProject(
              spaceId,
              {
                id,
                name,
                metadata: {
                  agentSession: true,
                  spaceModelDefaultPending: false,
                },
              },
              { expectedAccountKey: account }
            );
            useSpaceStore.getState().upsertProjectMetas([
              {
                id: p.id,
                spaceId,
                name: p.name,
                status: 'active',
                createdAt: Date.now(),
                updatedAt: Date.now(),
                metadata: p.metadata ?? {},
              },
            ]);
            return p.id;
          }}
          onClose={() => {
            setWorkshop(null);
            setWorkshopSource(undefined);
          }}
          beforeInstall={async () => {}}
          onInstalled={(node, projectId) => {
            setExpanded((old) => new Set([...old, projectId]));
            setView('canvas');
            setEdit(null);
            setPanelTab('details');
            setPick({
              kind: 'agent',
              id: node.id,
              name: node.name,
              projectId,
              agent: { ...node, projectId },
            });
            data.refresh();
          }}
        />
      )}
      {appearance && (
        <section
          className="absolute inset-0 z-40 flex min-h-0 flex-col bg-ds-neutral-subtle-default"
          aria-label={t('chat.card-appearance')}
        >
          <InstanceCardDesigner
            key={appearance.id}
            api={appearanceApi}
            node={appearance}
            close={() => setAppearance(null)}
            onSaved={() => {
              setAppearance(null);
              data.refresh();
            }}
          />
        </section>
      )}
    </section>
  );
}
function NewSession({
  account,
  spaceId,
  done,
}: {
  account: string;
  spaceId: string;
  done: () => void;
}) {
  const { t } = useTranslation(),
    [name, setName] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(false);
  return (
    <form
      className="flex flex-col gap-ds-12"
      onSubmit={async (e) => {
        e.preventDefault();
        if (busy) return;
        setBusy(true);
        try {
          const p = await proxyCreateSpaceProject(
            spaceId,
            {
              name,
              metadata: { agentSession: true, spaceModelDefaultPending: false },
            },
            { expectedAccountKey: account }
          );
          useSpaceStore.getState().upsertProjectMetas([
            {
              id: p.id,
              spaceId,
              name: p.name,
              status: 'active',
              createdAt: Date.now(),
              updatedAt: Date.now(),
              metadata: p.metadata ?? {},
            },
          ]);
          done();
        } catch {
          setError(true);
        } finally {
          setBusy(false);
        }
      }}
    >
      <Input
        aria-label={t('chat.workspace-name')}
        value={name}
        onChange={(e) => setName(e.target.value)}
        required
        maxLength={80}
      />
      {error && <DsText role="base">{t('chat.workspace-save-error')}</DsText>}
      <Button type="submit" size="sm" disabled={busy}>
        {t('chat.workspace-add-session')}
      </Button>
    </form>
  );
}
