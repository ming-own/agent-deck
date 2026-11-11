import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import WorkspaceGraph from './index';
import type { WorkspaceAgent, WorkspaceData } from './useWorkspaceGraph';

const mocks = vi.hoisted(() => ({
  data: {} as WorkspaceData,
  api: {
    list: vi.fn(),
    tasks: vi.fn(),
    runs: vi.fn(),
    skills: vi.fn(),
    update: vi.fn(),
    start: vi.fn(),
    receipts: vi.fn(),
  },
  flow: {
    fitView: vi.fn(),
    setViewport: vi.fn(),
    zoomIn: vi.fn(),
    zoomOut: vi.fn(),
  },
}));
vi.mock('./useWorkspaceGraph', () => ({ useWorkspaceGraph: () => mocks.data }));
vi.mock('@/service/sessionAgentApi', () => ({
  sessionAgentApi: () => mocks.api,
}));
vi.mock('@/store/authStore', () => ({
  useAuthStore: () => ({ email: 'review@example.com', user_id: 1 }),
  getAuthStore: () => ({
    email: 'review@example.com',
    user_id: 1,
    language: 'en-US',
  }),
}));
vi.mock('@/store/spaceStore', () => {
  const state = {
    activeSpaceId: 'space',
    spaces: { space: { id: 'space', name: 'Review space' } },
    lastVisitedProjectBySpace: { space: 'session' },
    projectsBySpaceId: {},
  };
  return {
    getVisibleProjectMetasForSpace: () => [],
    useSpaceStore: Object.assign(
      (select: (s: typeof state) => unknown) => select(state),
      { getState: () => state, subscribe: () => () => {} }
    ),
  };
});
vi.mock('@/hooks/useConfiguredModels', () => ({
  useConfiguredModels: () => ({
    records: [],
    cloudModels: [],
    hidden: [],
    cloudAvailable: false,
    codexConnected: true,
    codexModels: [{ id: 'model-a', name: 'Model A' }],
  }),
}));
vi.mock('react-router-dom', async (original) => ({
  ...(await original<typeof import('react-router-dom')>()),
  useNavigate: () => vi.fn(),
}));
vi.mock('@xyflow/react', () => ({
  ReactFlowProvider: ({ children }: any) => children,
  ReactFlow: ({
    nodes,
    edges,
    nodeTypes,
    onNodeDoubleClick,
    onEdgeClick,
    children,
  }: any) => (
    <div>
      {nodes.map((node: any) => {
        const Node = nodeTypes[node.type];
        return (
          <div
            key={node.id}
            data-testid={node.id}
            onDoubleClick={(event) => onNodeDoubleClick(event, node)}
          >
            <Node {...node} />
          </div>
        );
      })}
      {edges
        .filter((e: any) => e.data?.relation === 'context')
        .map((edge: any) => (
          <button key={edge.id} onClick={(event) => onEdgeClick(event, edge)}>
            Reference connection
          </button>
        ))}
      {children}
    </div>
  ),
  useReactFlow: () => mocks.flow,
  useStore: (select: any) => select({ width: 900, height: 700 }),
  useViewport: () => ({ zoom: 1 }),
  useNodeId: () => null,
  useUpdateNodeInternals: () => () => {},
  Handle: () => null,
  Panel: ({ children }: any) => <div>{children}</div>,
  Background: () => null,
  BackgroundVariant: { Dots: 'dots' },
  MarkerType: { ArrowClosed: 'arrow' },
  Position: { Left: 'left', Right: 'right' },
}));
vi.mock('@/components/Session/Agents/CanvasTrial', () => ({
  CanvasTrials: ({ children }: any) => children,
  TrialAction: () => null,
  TrialResult: ({ children }: any) => children,
  TrialPreview: () => null,
}));

const node = (id: string, name: string): WorkspaceAgent => ({
  id,
  name,
  projectId: 'session',
  revision: 1,
  role: '',
  instructions: '',
  harness_id: 'standard',
  tool_policy: {},
  skill_ids: [],
  created_at: '',
  updated_at: '',
  model: {
    id: 'codex:model-a',
    name: 'Model A',
    model_platform: 'openai',
    model_type: 'model-a',
  },
});
const first = node('a', 'Research'),
  second = node('b', 'Writer');
const tab = (name: string) =>
  fireEvent.mouseDown(
    (name === 'Tasks'
      ? within(screen.getByRole('complementary'))
      : screen
    ).getByRole('tab', { name, exact: true }),
    {
      button: 0,
      ctrlKey: false,
    }
  );
const role = () => screen.getByRole('textbox', { name: 'Role (optional)' });

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  mocks.api.list.mockResolvedValue([first, second]);
  mocks.api.tasks.mockResolvedValue([
    { id: 'default', name: '' },
    { id: 'review-task', name: 'Review task' },
  ]);
  mocks.api.runs.mockResolvedValue([]);
  mocks.api.skills.mockResolvedValue([]);
  mocks.api.receipts.mockResolvedValue([]);
  mocks.api.update.mockImplementation(async (agent, name, model, behavior) => ({
    ...agent,
    name,
    model,
    ...behavior,
    revision: agent.revision + 1,
  }));
  mocks.data = {
    agents: [first, second],
    sessions: [{ id: 'session', name: 'Review session' }],
    tasks: [
      {
        id: 'review-task',
        name: 'Review task',
        agent: first,
        last_run: {
          id: 'run',
          status: 'completed',
          output: 'Saved result',
          created_at: '2026-11-11',
        },
      },
    ],
    historyTasks: [],
    automations: [],
    memories: [],
    loading: false,
    errors: [],
    epoch: 0,
    graph: {
      space_id: 'space',
      positions: [],
      automation_bindings: [],
      contexts: [
        {
          id: 'brief',
          name: 'Brief',
          content: 'Research brief',
          enabled: true,
          revision: 1,
        },
      ],
      agent_references: [
        {
          project_id: 'session',
          agent_id: 'a',
          context_ids: ['brief'],
          memory_ids: [],
          revision: 3,
        },
      ],
    },
    api: {
      setAgentReferences: vi.fn().mockResolvedValue({
        agent_id: 'a',
        context_ids: [],
        memory_ids: [],
        revision: 4,
      }),
    },
    refresh: vi.fn(),
    setGraph: vi.fn(),
  } as unknown as WorkspaceData;
});

describe('canvas node inspector entry points', () => {
  it('opens editable fields on double click, keeps drafts across references, and saves consecutive revisions without closing', async () => {
    render(<WorkspaceGraph onConversation={() => {}} />);
    fireEvent.doubleClick(screen.getByTestId('agent:a'));
    expect(
      await screen.findByRole('textbox', { name: 'Role (optional)' })
    ).toHaveValue('');
    fireEvent.change(role(), { target: { value: 'Draft reviewer' } });
    tab('References');
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Brief' }));
    tab('General');
    expect(role()).toHaveValue('Draft reviewer');
    fireEvent.click(screen.getByRole('button', { name: 'Save', exact: true }));
    await waitFor(() => expect(mocks.api.update).toHaveBeenCalledTimes(1));
    expect(role()).toHaveValue('Draft reviewer');
    fireEvent.change(role(), { target: { value: 'Second revision' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save', exact: true }));
    await waitFor(() => expect(mocks.api.update).toHaveBeenCalledTimes(2));
    expect(mocks.api.update.mock.calls[1][0].revision).toBe(2);
    tab('References');
    expect(screen.getByRole('checkbox', { name: 'Brief' })).not.toBeChecked();
    expect(mocks.data.api.setAgentReferences).not.toHaveBeenCalled();
  });

  it('uses reference-edge and task-result entries for the same inspector and preserves the selected task', async () => {
    render(<WorkspaceGraph onConversation={() => {}} />);
    fireEvent.click(
      screen.getByRole('button', { name: 'Reference connection' })
    );
    expect(
      await screen.findByRole('tab', { name: 'References' })
    ).toHaveAttribute('data-state', 'active');
    tab('General');
    expect(role()).toHaveValue('');
    fireEvent.click(
      screen.getByRole('button', { name: 'Research · Completed' })
    );
    await waitFor(() =>
      expect(mocks.api.runs).toHaveBeenCalledWith('a', 'review-task')
    );
    const inspector = screen.getByRole('complementary', { name: 'Research' });
    expect(
      within(inspector).getByRole('tab', { name: 'Tasks', exact: true })
    ).toHaveAttribute('data-state', 'active');
    expect(
      within(inspector).getByRole('tab', { name: 'Capabilities' })
    ).toBeVisible();
    expect(screen.getAllByRole('complementary')).toHaveLength(1);
  });

  it('keeps both drafts when declining a node switch and resets them only after confirmation', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<WorkspaceGraph onConversation={() => {}} />);
    fireEvent.click(
      screen.getByRole('button', { name: 'Configure · Research' })
    );
    fireEvent.change(
      await screen.findByRole('textbox', { name: 'Role (optional)' }),
      { target: { value: 'Unsaved role' } }
    );
    tab('References');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Brief' }));
    await act(async () => fireEvent.doubleClick(screen.getByTestId('agent:b')));
    await waitFor(() => expect(confirm).toHaveBeenCalledOnce());
    expect(
      screen.getByRole('complementary', { name: 'Research' })
    ).toBeVisible();
    expect(screen.getByRole('checkbox', { name: 'Brief' })).not.toBeChecked();
    await act(async () => tab('Context'));
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(
      screen.getByRole('complementary', { name: 'Research' })
    ).toBeVisible();
    confirm.mockReturnValue(true);
    await act(async () => fireEvent.doubleClick(screen.getByTestId('agent:b')));
    await screen.findByRole('complementary', { name: 'Writer' });
    expect(role()).toHaveValue('');
    await act(async () => fireEvent.doubleClick(screen.getByTestId('agent:a')));
    await screen.findByRole('complementary', { name: 'Research' });
    expect(role()).toHaveValue('');
    confirm.mockRestore();
  });

  it('protects an unsent task message when a different result of the same Agent is opened', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<WorkspaceGraph onConversation={() => {}} />);
    fireEvent.doubleClick(screen.getByTestId('agent:a'));
    fireEvent.change(
      await screen.findByRole('textbox', { name: 'Role (optional)' }),
      {
        target: { value: 'Keep configuration draft' },
      }
    );
    tab('Tasks');
    const message = await screen.findByRole('textbox', {
      name: 'Message this Agent',
    });
    fireEvent.change(message, { target: { value: 'Keep this task draft' } });
    tab('References');
    tab('Tasks');
    expect(confirm).not.toHaveBeenCalled();
    expect(message).toHaveValue('Keep this task draft');
    await act(async () =>
      fireEvent.click(
        screen.getByRole('button', { name: 'Research · Completed' })
      )
    );
    expect(confirm).toHaveBeenCalledOnce();
    expect(
      screen.getByRole('textbox', { name: 'Message this Agent' })
    ).toHaveValue('Keep this task draft');
    expect(mocks.api.runs).not.toHaveBeenCalledWith('a', 'review-task');
    confirm.mockReturnValue(true);
    await act(async () =>
      fireEvent.click(
        screen.getByRole('button', { name: 'Research · Completed' })
      )
    );
    await waitFor(() =>
      expect(mocks.api.runs).toHaveBeenCalledWith('a', 'review-task')
    );
    expect(
      screen.getByRole('textbox', { name: 'Message this Agent' })
    ).toHaveValue('');
    tab('General');
    expect(role()).toHaveValue('Keep configuration draft');
    expect(confirm).toHaveBeenCalledTimes(2);
    confirm.mockRestore();
  });
});
