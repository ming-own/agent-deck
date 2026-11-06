import type { WorkspaceNodeKind } from '@/service/workspaceGraphApi';
import type { Edge, Node, XYPosition } from '@xyflow/react';
import type {
  WorkspaceAgent,
  WorkspaceData,
  WorkspaceTask,
} from './useWorkspaceGraph';
export type GraphItem = {
  kind: WorkspaceNodeKind;
  id: string;
  name: string;
  description?: string;
  projectId?: string;
  agent?: WorkspaceAgent;
  task?: WorkspaceTask;
  historyTaskId?: string;
  latestTask?: WorkspaceTask;
};
export type GraphNode = Node<
  {
    item: GraphItem;
    open: (item: GraphItem) => void;
    expanded?: boolean;
    toggle?: (id: string) => void;
  },
  'object' | 'session'
>;
export const nodeId = (kind: WorkspaceNodeKind, id: string) => kind + ':' + id;
export function graphItems(
  data: WorkspaceData,
  spaceName: string
): GraphItem[] {
  return [
    ...data.sessions.map((s) => ({
      kind: 'session' as const,
      id: s.id,
      name: s.name,
    })),
    ...data.agents.map((a) => ({
      kind: 'agent' as const,
      id: a.id,
      name: a.name,
      description: a.role || a.instructions,
      projectId: a.projectId,
      agent: a,
      latestTask: data.tasks
        .filter((task) => task.agent.id === a.id && task.last_run)
        .sort((a, b) => {
          const active = (t: WorkspaceTask) =>
            ['running', 'queued', 'confirmation'].includes(t.last_run!.status)
              ? 1
              : 0;
          return (
            active(b) - active(a) ||
            b.last_run!.created_at.localeCompare(a.last_run!.created_at)
          );
        })[0],
    })),
    ...data.tasks.map((task) => ({
      kind: 'task' as const,
      id: task.agent.id + ':' + task.id,
      name: task.name || 'default',
      projectId: task.agent.projectId,
      agent: task.agent,
      task,
    })),
    ...data.historyTasks.map((task) => ({
      kind: 'task' as const,
      id: 'history:' + task.projectId + ':' + task.id,
      name: task.name,
      projectId: task.projectId,
      historyTaskId: task.id,
    })),
    ...data.automations.map((a) => ({
      kind: 'automation' as const,
      id: String(a.id),
      name: a.name,
      description: a.task_prompt || a.description,
    })),
    ...(data.graph?.contexts ?? []).map((c) => ({
      kind: 'context' as const,
      id: c.id,
      name: c.name,
      description: c.content,
    })),
    ...data.memories.map((m) => ({
      kind: 'memory' as const,
      id: m.memory_id,
      name: m.content,
      description: m.kind,
    })),
    { kind: 'settings', id: data.graph?.space_id ?? '', name: spaceName },
  ];
}
export function buildWorkspaceGraph(
  data: WorkspaceData,
  items: GraphItem[],
  expanded: Set<string>,
  open: (i: GraphItem) => void,
  toggle: (id: string) => void,
  options = { tasks: false, members: false }
) {
  const nodes: GraphNode[] = [],
    edges: Edge[] = [];
  const positions = new Map(
    data.graph?.positions.map((p) => [nodeId(p.kind, p.object_id), p])
  );
  const position = (item: GraphItem, fallback: XYPosition) => {
    const p = positions.get(nodeId(item.kind, item.id));
    return p ? { x: p.x, y: p.y } : fallback;
  };
  let y = 0;
  for (const s of items.filter((i) => i.kind === 'session')) {
    const isOpen = expanded.has(s.id),
      children = items.filter(
        (i) =>
          i.kind === 'agent' &&
          i.projectId === s.id &&
          (options.members || !i.agent?.workforce_member)
      ),
      taskItems = items.filter(
        (i) =>
          options.tasks &&
          i.kind === 'task' &&
          i.projectId === s.id &&
          (options.members || !i.agent?.workforce_member)
      );
    const columns = Math.min(3, Math.max(1, children.length));
    const rows = Math.ceil(children.length / 3);
    const taskStart = 64 + rows * 312;
    const dims = isOpen
      ? {
          width: Math.max(600, columns * 268 + 48),
          height: Math.max(
            220,
            taskStart + Math.ceil(taskItems.length / 3) * 108 + 24
          ),
        }
      : { width: 600, height: 72 };
    const at = position(s, { x: 0, y });
    y += dims.height + 48;
    nodes.push({
      id: nodeId('session', s.id),
      type: 'session',
      position: at,
      ...dims,
      data: { item: s, open, expanded: isOpen, toggle },
      selectable: false,
    });
    if (!isOpen) continue;
    for (const [i, item] of children.entries())
      nodes.push({
        id: nodeId(item.kind, item.id),
        type: 'object',
        parentId: nodeId('session', s.id),
        position: position(item, {
          x: 24 + (i % 3) * 268,
          y: 64 + Math.floor(i / 3) * 312,
        }),
        width: 244,
        height: 288,
        extent: 'parent',
        data: { item, open },
      });
    for (const [i, item] of taskItems.entries()) {
      nodes.push({
        id: nodeId(item.kind, item.id),
        type: 'object',
        parentId: nodeId('session', s.id),
        position: position(item, {
          x: 24 + (i % 3) * 268,
          y: taskStart + Math.floor(i / 3) * 108,
        }),
        width: 244,
        height: 88,
        extent: 'parent',
        data: { item, open },
      });
      if (item.agent)
        edges.push({
          id: 'owns:' + item.id,
          source: nodeId('agent', item.agent!.id),
          target: nodeId('task', item.id),
          label: 'task',
          data: { relation: 'task' },
          style: {
            stroke: 'var(--ds-hairline-default-default)',
            strokeDasharray: '3 4',
          },
        });
    }
  }
  let r = 0;
  for (const item of items.filter(
    (i) => !['session', 'agent', 'task'].includes(i.kind)
  )) {
    nodes.push({
      id: nodeId(item.kind, item.id),
      type: 'object',
      position: position(item, {
        x: -660 + (r % 2) * 292,
        y: Math.floor(r / 2) * 168,
      }),
      width: 268,
      height: 144,
      data: { item, open },
    });
    r++;
  }
  const visible = new Set(nodes.map((n) => n.id));
  const edge = (source: string, target: string, relation: string) => {
    if (visible.has(source) && visible.has(target))
      edges.push({
        id: relation + ':' + source + ':' + target,
        source,
        target,
        label: relation,
        data: { relation },
        style: {
          stroke: 'var(--ds-ink-muted-default)',
          ...(relation === 'context' || relation === 'memory'
            ? { strokeDasharray: '5 5' }
            : {}),
        },
      });
  };
  for (const a of data.agents)
    for (const to of a.outputs ?? [])
      edge(nodeId('agent', a.id), nodeId('agent', to), 'output');
  for (const b of data.graph?.agent_references ?? []) {
    for (const id of b.context_ids)
      edge(nodeId('context', id), nodeId('agent', b.agent_id), 'context');
    for (const id of b.memory_ids)
      edge(nodeId('memory', id), nodeId('agent', b.agent_id), 'memory');
  }
  for (const b of data.graph?.automation_bindings ?? [])
    edge(
      nodeId('automation', b.trigger_id),
      nodeId('agent', b.agent_id),
      'trigger'
    );

  for (const session of data.sessions) {
    const source = session.metadata?.workspaceAutomation as
      { triggerId?: number | string } | undefined;
    if (source?.triggerId !== undefined)
      edge(
        nodeId('automation', String(source.triggerId)),
        nodeId('session', session.id),
        'session'
      );
  }
  return { nodes, edges };
}
