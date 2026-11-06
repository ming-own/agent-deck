import { describe, expect, it } from 'vitest';
import { buildWorkspaceGraph, graphItems } from './graphModel';
import type { WorkspaceData } from './useWorkspaceGraph';

function fixture() {
  return {
    sessions: [
      { id: 's', name: 'Session' },
      {
        id: 'generated',
        name: 'Run',
        metadata: { workspaceAutomation: { triggerId: 7 } },
      },
    ],
    agents: [
      { id: 'a', name: 'A', projectId: 's', outputs: ['b'] },
      { id: 'b', name: 'B', projectId: 's' },
      { id: 'member', projectId: 's', workforce_member: true },
    ],
    tasks: [
      { id: 'default', name: 'default', agent: { id: 'a', projectId: 's' } },
    ],
    historyTasks: [
      { id: 'original-task', projectId: 's', name: 'Original conversation' },
    ],
    memories: [{ memory_id: 'm', content: 'Shared fact', kind: 'fact' }],
    automations: [{ id: 7, name: 'Daily' }],
    graph: {
      space_id: 'space',
      contexts: [{ id: 'c', name: 'Brief', content: 'Version one' }],
      positions: [],
      agent_references: [
        { agent_id: 'a', context_ids: ['c'], memory_ids: ['m'] },
      ],
      automation_bindings: [{ trigger_id: '7', agent_id: 'a' }],
    },
  } as unknown as WorkspaceData;
}
function board(
  data = fixture(),
  expanded = new Set(['s']),
  options = { tasks: false, members: false }
) {
  return buildWorkspaceGraph(
    data,
    graphItems(data, 'Space'),
    expanded,
    () => {},
    () => {},
    options
  );
}
describe('workspace graph canonical projection', () => {
  it('uses existing identities for agents, references and automation-generated sessions', () => {
    const graph = board();
    expect(graph.nodes.map((n) => n.id)).toEqual(
      expect.arrayContaining([
        'session:s',
        'agent:a',
        'automation:7',
        'context:c',
        'memory:m',
        'settings:space',
      ])
    );
    expect(graph.edges.map((e) => [e.source, e.target])).toEqual(
      expect.arrayContaining([
        ['agent:a', 'agent:b'],
        ['context:c', 'agent:a'],
        ['memory:m', 'agent:a'],
        ['automation:7', 'agent:a'],
        ['automation:7', 'session:generated'],
      ])
    );
  });
  it('keeps task directory complete while task and team detail are opt-in on canvas', () => {
    const data = fixture(),
      items = graphItems(data, 'Space');
    expect(
      items.find((i) => i.historyTaskId === 'original-task')?.projectId
    ).toBe('s');
    expect(items.find((i) => i.task?.id === 'default')?.id).toBe('a:default');
    expect(
      board(data).nodes.some(
        (n) => n.id.startsWith('task:') || n.id === 'agent:member'
      )
    ).toBe(false);
    const details = board(data, new Set(['s']), { tasks: true, members: true });
    expect(details.nodes.map((n) => n.id)).toEqual(
      expect.arrayContaining([
        'task:a:default',
        'task:history:s:original-task',
        'agent:member',
      ])
    );
  });
  it('restores scoped positions without rewriting object identity', () => {
    const data = fixture();
    data.graph!.positions = [
      { kind: 'agent', object_id: 'a', x: 137, y: 91, revision: 2 },
    ];
    expect(board(data).nodes.find((n) => n.id === 'agent:a')).toMatchObject({
      parentId: 'session:s',
      position: { x: 137, y: 91 },
    });
  });
  it('collapses a session without dangling execution or resource edges', () => {
    const graph = board(fixture(), new Set());
    expect(graph.nodes.some((n) => n.id === 'agent:a')).toBe(false);
    const ids = new Set(graph.nodes.map((n) => n.id));
    expect(
      graph.edges.every((e) => ids.has(e.source) && ids.has(e.target))
    ).toBe(true);
  });
});
