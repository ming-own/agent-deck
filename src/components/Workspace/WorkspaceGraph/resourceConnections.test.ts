import type { WorkspaceGraph } from '@/service/workspaceGraphApi';
import { describe, expect, it } from 'vitest';
import { createResourceConnector } from './resourceConnections';

describe('resource connection persistence', () => {
  it('preserves both references when a second wire arrives before the first save finishes', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const graph: WorkspaceGraph = {
      space_id: 'space',
      session_ids: ['s'],
      contexts: [],
      positions: [],
      automation_bindings: [],
      agent_references: [
        {
          project_id: 's',
          agent_id: 'a',
          context_ids: ['existing'],
          memory_ids: [],
          revision: 7,
        },
      ],
    };
    const connect = createResourceConnector({
      get: async () => structuredClone(graph),
      setAgentReferences: async (project, agent, body) => {
        await gate;
        if (body.expected_revision !== graph.agent_references[0].revision)
          throw Error('409 stale revision');
        graph.agent_references = [
          {
            project_id: project,
            agent_id: agent,
            context_ids: body.context_ids,
            memory_ids: body.memory_ids,
            revision: body.expected_revision + 1,
          },
        ];
        return graph.agent_references[0];
      },
      bindAutomation: async () => {
        throw Error('Unexpected binding');
      },
    });
    const first = connect(
      { kind: 'context', id: 'brief' },
      { id: 'a', projectId: 's' }
    );
    const second = connect(
      { kind: 'memory', id: 'shared' },
      { id: 'a', projectId: 's' }
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    release();
    await Promise.all([first, second]);
    expect(graph.agent_references[0]).toEqual({
      project_id: 's',
      agent_id: 'a',
      context_ids: ['existing', 'brief'],
      memory_ids: ['shared'],
      revision: 9,
    });
    await connect(
      { kind: 'context', id: 'brief' },
      { id: 'a', projectId: 's' }
    );
    expect(graph.agent_references[0].context_ids).toEqual([
      'existing',
      'brief',
    ]);
  });
  it('can connect again after a rejected request and uses the latest automation binding', async () => {
    let failed = false;
    let binding = {
      trigger_id: '7',
      project_id: 'old',
      agent_id: 'old',
      revision: 3,
    };
    const connect = createResourceConnector({
      get: async () => {
        if (!failed) {
          failed = true;
          throw Error('offline');
        }
        return {
          space_id: 'space',
          session_ids: [],
          contexts: [],
          positions: [],
          agent_references: [],
          automation_bindings: [binding],
        };
      },
      setAgentReferences: async () => {
        throw Error('Unexpected reference');
      },
      bindAutomation: async (id, body) => {
        if (body.expected_revision !== binding.revision)
          throw Error('409 stale revision');
        binding = {
          trigger_id: id,
          project_id: body.project_id,
          agent_id: body.agent_id,
          revision: body.expected_revision + 1,
        };
        return binding;
      },
    });
    await expect(
      connect({ kind: 'automation', id: '7' }, { id: 'a', projectId: 's' })
    ).rejects.toThrow('offline');
    await connect({ kind: 'automation', id: '7' }, { id: 'a', projectId: 's' });
    expect(binding).toEqual({
      trigger_id: '7',
      project_id: 's',
      agent_id: 'a',
      revision: 4,
    });
  });
});
