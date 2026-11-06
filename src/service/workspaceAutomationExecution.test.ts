import { webcrypto } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const fake = vi.hoisted(() => ({
  account: 'account-a',
  get: vi.fn(),
  lookup: vi.fn(),
  instantiate: vi.fn(),
  projects: vi.fn(),
  create: vi.fn(),
  list: vi.fn(),
  sourceList: vi.fn(),
  runs: vi.fn(),
  start: vi.fn(),
  trial: vi.fn(),
  startTrial: vi.fn(),
  providers: vi.fn(),
  status: vi.fn(),
}));
vi.mock('@/api/http', () => ({
  proxyFetchGet: vi.fn(),
  proxyFetchPost: vi.fn(),
}));
vi.mock('@/lib/authEnvironment', () => ({
  getAccountEnvironmentKey: () => fake.account,
}));
vi.mock('@/store/authStore', () => ({
  getAuthStore: () => ({ email: 'owner@example.com', user_id: 1 }),
}));
vi.mock('@/service/workspaceGraphApi', () => ({
  workspaceGraphApi: () => ({
    get: fake.get,
    getAutomationExecution: fake.lookup,
    instantiateAutomation: fake.instantiate,
  }),
}));
vi.mock('@/service/spaceApi', () => ({
  proxyFetchSpaceProjects: fake.projects,
  proxyCreateSpaceProject: fake.create,
}));
vi.mock('@/service/sessionAgentApi', () => ({
  sessionAgentApi: (_account: string, project: string) => ({
    list: project === 'source-session' ? fake.sourceList : fake.list,
    runs: fake.runs,
    start: fake.start,
    trial: fake.trial,
    startTrial: fake.startTrial,
  }),
}));
vi.mock('@/lib/configuredModels', async (original) => ({
  ...(await original<typeof import('@/lib/configuredModels')>()),
  fetchConfiguredProviders: fake.providers,
}));
vi.mock('@/service/triggerApi', () => ({
  proxyUpdateTriggerExecution: fake.status,
}));

import { TriggerType } from '@/types';
import type { SessionAgent } from './sessionAgentApi';
import {
  executeWorkspaceAutomation,
  reconcileWorkspaceAutomationExecutions,
} from './workspaceAutomationExecution';

const node = {
  id: 'cloned-agent',
  name: 'Researcher',
  revision: 1,
  model: {
    id: 'provider:4',
    name: 'model-a',
    model_platform: 'openai',
    model_type: 'model-a',
  },
  harness_id: 'direct',
  role: '',
  instructions: '',
  skill_ids: [],
  tool_policy: {},
  created_at: '',
  updated_at: '',
} satisfies SessionAgent;
const task = {
  id: 'event',
  triggerId: 7,
  triggerName: 'Daily research',
  executionId: 'execution-1',
  projectId: 'source-session',
  spaceId: 'space-a',
  taskPrompt: 'Research today',
  triggerType: TriggerType.Schedule,
  inputData: {},
  timestamp: 1,
};
const options = () => ({
  accountKey: fake.account,
  spaceId: 'space-a',
  name: 'Automation: Daily research',
  onProject: vi.fn(),
});

describe('bound workspace automation execution', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    vi.stubGlobal('crypto', webcrypto);
    fake.account = 'account-a';
    fake.get.mockResolvedValue({
      space_id: 'space-a',
      automation_bindings: [
        {
          trigger_id: '7',
          project_id: 'source-session',
          agent_id: 'source-agent',
          revision: 1,
        },
      ],
    });
    fake.lookup.mockResolvedValue(null);
    fake.projects.mockResolvedValue([]);
    fake.create.mockImplementation(async (space, body) => {
      const project = { ...body, space_id: space };
      fake.projects.mockResolvedValue([project]);
      return project;
    });
    fake.instantiate.mockImplementation(async (_id, body) => ({
      project_id: body.project_id,
      agent: node,
      created: true,
    }));
    fake.list.mockResolvedValue([node]);
    fake.sourceList.mockResolvedValue([{ ...node, id: 'source-agent' }]);
    fake.trial.mockResolvedValue(null);
    fake.startTrial.mockImplementation(async (body) => ({
      id: body.id,
      prompt: body.prompt,
      status: 'running',
      steps: body.path.map((agent_id: string) => ({
        agent_id,
        status: 'running',
      })),
    }));
    fake.runs.mockResolvedValue([]);
    fake.start.mockImplementation(async (_id, body) => ({
      id: 'run-1',
      agent_id: node.id,
      task_id: 'default',
      request_id: body.request_id,
      status: 'running',
      prompt: body.prompt,
    }));
    fake.providers.mockResolvedValue([
      {
        id: 4,
        provider_name: 'openai',
        model_type: 'model-a',
        api_key: 'secret-key',
        endpoint_url: 'https://example.com/v1',
        is_valid: true,
      },
    ]);
    fake.status.mockResolvedValue(undefined);
  });

  it('creates a canonical separate Session, clones the bound target and runs the requested prompt', async () => {
    const input = options();
    const result = await executeWorkspaceAutomation(task, input);
    expect(result?.projectId).not.toBe('source-session');
    expect(fake.create).toHaveBeenCalledWith(
      'space-a',
      expect.objectContaining({
        id: result?.projectId,
        metadata: {
          agentSession: true,
          spaceModelDefaultPending: false,
          workspaceAutomation: {
            triggerId: 7,
            executionId: task.executionId,
            sourceProjectId: 'source-session',
            sourceAgentId: 'source-agent',
          },
        },
      }),
      { expectedAccountKey: 'account-a' }
    );
    expect(fake.start).toHaveBeenCalledWith(
      node.id,
      expect.objectContaining({
        task_id: 'default',
        prompt: 'Research today',
        expected_revision: 1,
        connection: expect.objectContaining({ api_key: 'secret-key' }),
      })
    );
    expect(input.onProject).toHaveBeenCalledOnce();
    expect(
      JSON.stringify(
        [...Array(localStorage.length)].map((_, i) =>
          localStorage.getItem(localStorage.key(i)!)
        )
      )
    ).not.toContain('secret-key');
  });

  it('returns null for an unbound trigger without creating a Session or changing legacy behavior', async () => {
    fake.get.mockResolvedValue({
      space_id: 'space-a',
      automation_bindings: [],
    });
    expect(await executeWorkspaceAutomation(task, options())).toBeNull();
    expect(fake.create).not.toHaveBeenCalled();
    expect(fake.start).not.toHaveBeenCalled();
  });

  it('coalesces concurrent delivery of the same execution into one Session and run', async () => {
    const [first, second] = await Promise.all([
      executeWorkspaceAutomation(task, options()),
      executeWorkspaceAutomation(task, options()),
    ]);
    expect(first?.projectId).toBe(second?.projectId);
    expect(fake.create).toHaveBeenCalledOnce();
    expect(fake.instantiate).toHaveBeenCalledOnce();
    expect(fake.start).toHaveBeenCalledOnce();
  });

  it('recovers an already admitted run after unbinding, without resolving a changed model or starting again', async () => {
    const first = await executeWorkspaceAutomation(task, options());
    const body = fake.start.mock.calls[0][1];
    fake.lookup.mockResolvedValue({
      project_id: first?.projectId,
      agent: node,
      created: false,
    });
    fake.get.mockResolvedValue({
      space_id: 'space-a',
      automation_bindings: [],
    });
    fake.runs.mockResolvedValue([
      {
        id: 'run-1',
        request_id: body.request_id,
        agent_id: node.id,
        task_id: 'default',
        status: 'completed',
        output: 'Done',
        finished_at: '2026-11-06T00:00:00Z',
      },
    ]);
    fake.providers.mockRejectedValue(new Error('provider removed'));
    await executeWorkspaceAutomation(task, options());
    expect(fake.create).toHaveBeenCalledOnce();
    expect(fake.start).toHaveBeenCalledOnce();
    expect(fake.status).toHaveBeenLastCalledWith(
      task.executionId,
      expect.objectContaining({ status: 'completed' }),
      expect.objectContaining({ projectId: first?.projectId }),
      'account-a'
    );
  });

  it('stops after an account switch while fetching a binding', async () => {
    fake.get.mockImplementation(async () => {
      fake.account = 'account-b';
      return {
        space_id: 'space-a',
        automation_bindings: [{ trigger_id: '7' }],
      };
    });
    await expect(executeWorkspaceAutomation(task, options())).rejects.toThrow(
      /account/i
    );
    expect(fake.create).not.toHaveBeenCalled();
    expect(fake.start).not.toHaveBeenCalled();
  });

  it('preserves the uncertain run receipt and reconciles completion without redispatching inference', async () => {
    fake.start.mockRejectedValueOnce(new TypeError('network response lost'));
    await expect(executeWorkspaceAutomation(task, options())).rejects.toThrow();
    expect(fake.status).not.toHaveBeenCalledWith(
      task.executionId,
      expect.objectContaining({ status: 'failed' }),
      expect.anything(),
      expect.anything()
    );
    const requestId = fake.start.mock.calls[0][1].request_id;
    fake.runs.mockResolvedValue([
      {
        id: 'run-1',
        request_id: requestId,
        agent_id: node.id,
        task_id: 'default',
        status: 'completed',
        output: 'Done',
        finished_at: '2026-11-06T00:00:00Z',
      },
    ]);
    await reconcileWorkspaceAutomationExecutions();
    expect(fake.start).toHaveBeenCalledOnce();
    expect(fake.status).toHaveBeenLastCalledWith(
      task.executionId,
      expect.objectContaining({ status: 'completed' }),
      expect.anything(),
      'account-a'
    );
  });

  it('fails a missing/changed target without silently running the legacy prompt', async () => {
    fake.instantiate.mockRejectedValue(
      new Error('Automation source no longer exists')
    );
    await expect(executeWorkspaceAutomation(task, options())).rejects.toThrow(
      /source/
    );
    expect(fake.start).not.toHaveBeenCalled();
    expect(fake.status).toHaveBeenLastCalledWith(
      task.executionId,
      expect.objectContaining({ status: 'failed' }),
      expect.anything(),
      'account-a'
    );
  });

  it('reports a deleted model as a terminal preparation failure', async () => {
    fake.providers.mockResolvedValue([]);
    await expect(executeWorkspaceAutomation(task, options())).rejects.toThrow(
      /model/i
    );
    expect(fake.start).not.toHaveBeenCalled();
    expect(fake.status).toHaveBeenLastCalledWith(
      task.executionId,
      expect.objectContaining({ status: 'failed' }),
      expect.anything(),
      'account-a'
    );
    await reconcileWorkspaceAutomationExecutions();
    expect(fake.start).not.toHaveBeenCalled();
  });

  it('reports an explicit reference/revision conflict as failed when the exact run was never admitted', async () => {
    fake.start.mockRejectedValue(
      Object.assign(new Error('Context disabled'), { status: 409 })
    );
    await expect(executeWorkspaceAutomation(task, options())).rejects.toThrow(
      /disabled/
    );
    expect(fake.runs).toHaveBeenCalledTimes(2);
    expect(fake.status).toHaveBeenLastCalledWith(
      task.executionId,
      expect.objectContaining({ status: 'failed' }),
      expect.anything(),
      'account-a'
    );
    await reconcileWorkspaceAutomationExecutions();
    expect(fake.start).toHaveBeenCalledOnce();
  });

  it('retains uncertainty when conflict recovery cannot read the exact run', async () => {
    fake.start.mockRejectedValue(
      Object.assign(new Error('Conflict'), { status: 409 })
    );
    fake.runs
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce(new TypeError('offline'));
    await expect(executeWorkspaceAutomation(task, options())).rejects.toThrow(
      /Conflict/
    );
    expect(fake.status).not.toHaveBeenCalledWith(
      task.executionId,
      expect.objectContaining({ status: 'failed' }),
      expect.anything(),
      expect.anything()
    );
  });

  it('keeps model connections transient and strips credential headers from durable preparation', async () => {
    fake.start.mockRejectedValueOnce(new TypeError('response lost'));
    await expect(
      executeWorkspaceAutomation(
        {
          ...task,
          triggerType: TriggerType.Webhook,
          inputData: {
            method: 'POST',
            headers: {
              Authorization: 'Bearer webhook-secret',
              Cookie: 'session-secret',
              'X-API-Key': 'header-secret',
              'Content-Type': 'application/json',
            },
          },
        },
        options()
      )
    ).rejects.toThrow();
    const persisted = [...Array(localStorage.length)]
      .map((_, i) => localStorage.getItem(localStorage.key(i)!))
      .join('\n');
    expect(persisted).not.toContain('webhook-secret');
    expect(persisted).not.toContain('session-secret');
    expect(persisted).not.toContain('header-secret');
    expect(persisted).not.toContain('secret-key');
    expect(fake.start.mock.calls[0][1].prompt).toContain('application/json');
  });

  it('resolves every Workforce member independently without creating shared task history', async () => {
    const team = {
      ...node,
      workforce: {
        branches: [
          { agent_id: 'member-a', name: 'A', instructions: '', contains: '' },
        ],
        summary: { agent_id: 'member-b', name: 'B', instructions: '' },
        join: 'all_success' as const,
      },
    };
    fake.instantiate.mockImplementation(async (_id, body) => ({
      project_id: body.project_id,
      agent: team,
      created: true,
      execution_path: [team.id],
    }));
    fake.list.mockResolvedValue([
      team,
      { ...node, id: 'member-a' },
      { ...node, id: 'member-b' },
    ]);
    await executeWorkspaceAutomation(task, options());
    expect(fake.start).toHaveBeenCalledWith(
      team.id,
      expect.objectContaining({
        task_id: 'default',
        connection: expect.objectContaining({
          model_type: 'workforce',
          members: {
            'member-a': expect.objectContaining({
              expected_revision: 1,
              connection: expect.objectContaining({ api_key: 'secret-key' }),
            }),
            'member-b': expect.objectContaining({
              expected_revision: 1,
              connection: expect.objectContaining({ api_key: 'secret-key' }),
            }),
          },
        }),
      })
    );
    expect(fake.startTrial).not.toHaveBeenCalled();
  });

  it('resumes preparation after renderer restart while model discovery was pending', async () => {
    fake.providers.mockImplementationOnce(() => new Promise(() => {}));
    void executeWorkspaceAutomation(
      { ...task, executionId: 'restart' },
      options()
    );
    await vi.waitFor(() => expect(fake.providers).toHaveBeenCalledOnce());
    const projectId = fake.create.mock.calls[0][1].id;
    fake.lookup.mockResolvedValue({
      project_id: projectId,
      agent: node,
      execution_path: [node.id],
      created: false,
    });
    vi.resetModules();
    const reloaded = await import('./workspaceAutomationExecution');
    await reloaded.reconcileWorkspaceAutomationExecutions();
    expect(fake.create).toHaveBeenCalledOnce();
    expect(fake.instantiate).toHaveBeenCalledOnce();
    expect(fake.start).toHaveBeenCalledOnce();
    expect(fake.start.mock.calls[0][1].prompt).toBe(task.taskPrompt);
  });

  it('runs a connected A→B path as one idempotent trial with the selected model on each step', async () => {
    fake.sourceList.mockResolvedValue([
      { ...node, id: 'source-agent', outputs: ['source-b'] },
      { ...node, id: 'source-b' },
    ]);
    fake.list.mockResolvedValue([
      { ...node, outputs: ['cloned-b'] },
      { ...node, id: 'cloned-b' },
    ]);
    fake.instantiate.mockImplementation(async (_id, body) => ({
      project_id: body.project_id,
      agent: { ...node, outputs: ['cloned-b'] },
      execution_path: [node.id, 'cloned-b'],
      created: true,
    }));
    const first = await executeWorkspaceAutomation(task, options());
    expect(fake.start).not.toHaveBeenCalled();
    expect(fake.startTrial).toHaveBeenCalledWith(
      expect.objectContaining({
        path: [node.id, 'cloned-b'],
        prompt: task.taskPrompt,
        settings: {
          [node.id]: expect.objectContaining({
            connection: expect.objectContaining({ api_key: 'secret-key' }),
          }),
          'cloned-b': expect.objectContaining({
            connection: expect.objectContaining({ api_key: 'secret-key' }),
          }),
        },
      })
    );
    const body = fake.startTrial.mock.calls[0][0];
    fake.lookup.mockResolvedValue({
      project_id: first!.projectId,
      agent: node,
      execution_path: [node.id, 'cloned-b'],
      created: false,
    });
    fake.trial.mockResolvedValue({
      id: body.id,
      status: 'completed',
      prompt: task.taskPrompt,
      steps: [
        { agent_id: node.id, output: 'A', status: 'completed' },
        { agent_id: 'cloned-b', output: 'B', status: 'completed' },
      ],
    });
    await executeWorkspaceAutomation(task, options());
    expect(fake.startTrial).toHaveBeenCalledOnce();
    expect(fake.status).toHaveBeenLastCalledWith(
      task.executionId,
      expect.objectContaining({
        status: 'completed',
        output_data: expect.objectContaining({ output: 'B' }),
      }),
      expect.anything(),
      'account-a'
    );
  });

  it.each([
    [{ ...node, id: 'source-agent', outputs: ['b', 'c'] }],
    [{ ...node, id: 'source-agent', outputs: ['source-agent'] }],
  ])(
    'rejects an ambiguous or cyclic source before creating a Session',
    async (source) => {
      fake.sourceList.mockResolvedValue([source]);
      await expect(executeWorkspaceAutomation(task, options())).rejects.toThrow(
        /path/i
      );
      expect(fake.create).not.toHaveBeenCalled();
      expect(fake.instantiate).not.toHaveBeenCalled();
    }
  );
});
