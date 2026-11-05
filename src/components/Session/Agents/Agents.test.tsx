import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SessionAgents } from './index';

const mocks = vi.hoisted(() => ({
  api: {
    receipts: vi.fn(),
    route: vi.fn(),
    list: vi.fn(),
    tasks: vi.fn(),
    createTask: vi.fn(),
    skills: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    runs: vi.fn(),
    start: vi.fn(),
    cancel: vi.fn(),
  },
}));
vi.mock('@/service/sessionAgentApi', () => ({
  sessionAgentApi: () => mocks.api,
}));
vi.mock('@/store/authStore', () => ({
  useAuthStore: () => ({ email: 'test@example.com', user_id: 1 }),
  getAuthStore: () => ({
    email: 'test@example.com',
    user_id: 1,
    language: 'en-US',
  }),
}));
vi.mock('@/hooks/useConfiguredModels', () => ({
  useConfiguredModels: () => ({
    records: [],
    cloudModels: [],
    hidden: [],
    cloudAvailable: false,
    codexConnected: true,
    codexModels: [
      { id: 'model-a', name: 'Model A' },
      { id: 'model-b', name: 'Model B' },
    ],
  }),
}));
vi.mock('@/components/ui/select', () => ({
  Select: ({ children, value, onValueChange, disabled }: any) => (
    <select
      aria-label={children[0].props['aria-label']}
      value={value}
      disabled={disabled}
      onChange={(event) => onValueChange(event.target.value)}
    >
      <option value="" />
      {children}
    </select>
  ),
  SelectTrigger: () => null,
  SelectValue: () => null,
  SelectContent: ({ children }: any) => <>{children}</>,
  SelectItem: ({ children, value }: any) => (
    <option value={value}>{children}</option>
  ),
}));
const node = (id: string, name: string, model: string) => ({
  id,
  name,
  revision: 1,
  role: '',
  instructions: '',
  model: {
    id: `codex:${model}`,
    name: model === 'model-a' ? 'Model A' : 'Model B',
    model_platform: 'openai',
    model_type: model,
  },
});
const first = node('a', 'Research', 'model-a');
const second = node('b', 'Writer', 'model-b');

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  mocks.api.tasks.mockResolvedValue([{ id: 'default', name: '' }]);
  mocks.api.skills.mockResolvedValue([{ id: 'audit-package', name: 'Audit' }]);
  mocks.api.list.mockResolvedValue([first, second]);
  mocks.api.runs.mockResolvedValue([]);
  mocks.api.start.mockImplementation(async (id, body) => ({
    id: 'run',
    agent_id: id,
    agent: id === 'a' ? first : second,
    prompt: body.prompt,
    status: 'running',
    output: '',
  }));
});

describe('Session Agent instances', () => {
  it('replies through the original route and reuses the same event on an uncertain response', async () => {
    const original = {
      event_id: 'original',
      origin_agent_id: 'a',
      origin_task_id: 'default',
      origin_name: 'Research',
      target_agent_id: 'b',
      target_task_id: 'A',
      target_task_name: 'Budget A',
      target_name: 'Writer',
      status: 'completed',
      message: 'Review',
      output: 'Result',
      created_at: '2026-11-05T00:00:00Z',
    };
    mocks.api.receipts.mockResolvedValue([original]);
    mocks.api.route
      .mockRejectedValueOnce(new Error('response lost'))
      .mockResolvedValue({
        ...original,
        event_id: 'follow',
        reply_to: 'original',
      });
    render(<SessionAgents projectId="s" />);
    const launcher = await screen.findByRole('button', {
      name: 'Route messages',
    });
    await waitFor(() => expect(launcher).toBeEnabled());
    fireEvent.click(launcher);
    const dialog = within(screen.getByRole('dialog'));
    fireEvent.click(await dialog.findByRole('button', { name: 'Follow up' }));
    fireEvent.change(dialog.getByRole('textbox', { name: 'Follow up' }), {
      target: { value: 'Add 5' },
    });
    fireEvent.click(dialog.getByRole('button', { name: 'Send message' }));
    await waitFor(() => expect(mocks.api.route).toHaveBeenCalledTimes(1));
    const body = mocks.api.route.mock.calls[0][0];
    expect(body).toMatchObject({
      reply_to: 'original',
      origin_agent_id: 'a',
      origin_task_id: 'default',
      target_agent_id: 'b',
      message: 'Add 5',
      approved_tools: [],
    });
    expect(body).not.toHaveProperty('task_id');
    await waitFor(() =>
      expect(dialog.getByRole('button', { name: 'Send message' })).toBeEnabled()
    );
    fireEvent.click(dialog.getByRole('button', { name: 'Send message' }));
    await waitFor(() => expect(mocks.api.route).toHaveBeenCalledTimes(2));
    expect(mocks.api.route.mock.calls[1][0].event_id).toBe(body.event_id);
    expect(mocks.api.receipts).toHaveBeenCalledWith({
      agentId: 'a',
      taskId: 'default',
    });
  });
  it('forwards the selected answer only after confirmation and opens its destination task', async () => {
    const source = {
      id: 'source-1',
      task_id: 'default',
      agent_id: 'a',
      agent: first,
      prompt: 'Report',
      output: 'First cost 120',
      status: 'completed',
    };
    mocks.api.runs.mockImplementation(async (agent) =>
      agent === 'a' ? [source] : []
    );
    mocks.api.tasks.mockImplementation(async (agent) =>
      agent === 'b'
        ? [
            { id: 'default', name: '' },
            { id: 'cost', name: 'Cost review' },
          ]
        : [{ id: 'default', name: '' }]
    );
    render(<SessionAgents projectId="one" />);
    fireEvent.click(
      await screen.findByRole('button', { name: 'Forward answer' })
    );
    let dialog = within(screen.getByRole('dialog'));
    expect(
      dialog.getByRole('button', { name: 'Confirm and run' })
    ).toBeDisabled();
    fireEvent.click(dialog.getByRole('button', { name: 'Cancel' }));
    expect(mocks.api.start).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Forward answer' }));
    dialog = within(screen.getByRole('dialog'));
    fireEvent.change(
      dialog.getByRole('combobox', { name: 'Receiving Agent' }),
      { target: { value: 'b' } }
    );
    await dialog.findByRole('option', { name: 'Cost review' });
    fireEvent.change(dialog.getByRole('combobox', { name: 'Receiving task' }), {
      target: { value: 'cost' },
    });
    fireEvent.change(
      dialog.getByRole('textbox', {
        name: 'Additional instructions (optional)',
      }),
      { target: { value: 'Only cost' } }
    );
    expect(mocks.api.start).not.toHaveBeenCalled();
    fireEvent.click(dialog.getByRole('button', { name: 'Confirm and run' }));
    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: 'Select task' })).toHaveValue(
        'cost'
      )
    );
    expect(mocks.api.start).toHaveBeenCalledTimes(1);
    expect(mocks.api.start).toHaveBeenCalledWith(
      'b',
      expect.objectContaining({
        source_run_id: 'source-1',
        task_id: 'cost',
        prompt: 'Only cost',
        approved_tools: [],
        connection: expect.objectContaining({ model_type: 'model-b' }),
      })
    );
  });
  it('sends with the selected instance model rather than a session default', async () => {
    render(<SessionAgents projectId="session-one" />);
    fireEvent.change(
      await screen.findByRole('combobox', { name: 'Select Agent' }),
      { target: { value: 'b' } }
    );
    fireEvent.change(
      screen.getByRole('textbox', { name: 'Message this Agent' }),
      { target: { value: 'Hello' } }
    );
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Send', exact: true })
      ).toBeEnabled()
    );
    fireEvent.click(screen.getByRole('button', { name: 'Send', exact: true }));
    await waitFor(() =>
      expect(mocks.api.start).toHaveBeenCalledWith(
        'b',
        expect.objectContaining({
          expected_revision: 1,
          connection: expect.objectContaining({
            model_type: 'model-b',
            auth_source: 'codex_subscription',
          }),
        })
      )
    );
  });

  it('adds an explicit model reference without copying account credentials', async () => {
    mocks.api.create.mockResolvedValue(node('c', 'Reviewer', 'model-b'));
    render(<SessionAgents projectId="s" />);
    await screen.findByRole('combobox', { name: 'Select Agent' });
    fireEvent.click(screen.getByRole('button', { name: 'Add Agent' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Agent name' }), {
      target: { value: 'Reviewer' },
    });
    fireEvent.change(screen.getByRole('combobox', { name: 'Model' }), {
      target: { value: 'codex:model-b' },
    });
    fireEvent.change(
      screen.getByRole('combobox', { name: 'Execution harness' }),
      { target: { value: 'plan_execute' } }
    );
    fireEvent.change(screen.getByRole('textbox', { name: 'Role (optional)' }), {
      target: { value: 'Reviewer' },
    });
    fireEvent.change(
      screen.getByRole('textbox', { name: 'Instructions (optional)' }),
      { target: { value: 'List risks first.' } }
    );
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Capabilities' }), {
      button: 0,
    });
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Audit' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Calculator' }), {
      target: { value: 'turn' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save', exact: true }));
    await waitFor(() =>
      expect(mocks.api.create).toHaveBeenCalledWith('Reviewer', second.model, {
        role: 'Reviewer',
        instructions: 'List risks first.',
        skill_ids: ['audit-package'],
        harness_id: 'plan_execute',
        tool_policy: { calculate: 'turn' },
      })
    );
    expect(
      await screen.findByRole('combobox', { name: 'Select Agent' })
    ).toHaveValue('c');
  });

  it('keeps an uncertain send idempotent', async () => {
    mocks.api.start.mockRejectedValue(new Error('lost response'));
    render(<SessionAgents projectId="s" />);
    await screen.findByRole('combobox', { name: 'Select Agent' });
    fireEvent.change(
      screen.getByRole('textbox', { name: 'Message this Agent' }),
      { target: { value: 'Hello' } }
    );
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Send', exact: true })
      ).toBeEnabled()
    );
    fireEvent.click(screen.getByRole('button', { name: 'Send', exact: true }));
    await waitFor(() => expect(mocks.api.start).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Send', exact: true })
      ).toBeEnabled()
    );
    fireEvent.click(screen.getByRole('button', { name: 'Send', exact: true }));
    await waitFor(() => expect(mocks.api.start).toHaveBeenCalledTimes(2));
    expect(mocks.api.start.mock.calls[0][1].request_id).toBe(
      mocks.api.start.mock.calls[1][1].request_id
    );
  });

  it('opens the last task again and discards a late history response from the previous task', async () => {
    mocks.api.tasks.mockResolvedValue([
      { id: 'default', name: '' },
      { id: 'b', name: 'Budget' },
    ]);
    let finishDefault!: (rows: unknown[]) => void;
    mocks.api.runs.mockImplementation((_node, task) =>
      task === 'default'
        ? new Promise((resolve) => {
            finishDefault = resolve;
          })
        : Promise.resolve([
            {
              id: 'budget-run',
              task_id: 'b',
              agent: first,
              prompt: 'Budget only',
              status: 'completed',
              output: '',
            },
          ])
    );
    const view = render(<SessionAgents projectId="one" />);
    const selector = await screen.findByRole('combobox', {
      name: 'Select task',
    });
    await waitFor(() => expect(selector).toBeEnabled());
    fireEvent.change(selector, { target: { value: 'b' } });
    await screen.findByText('Budget only');
    await act(async () =>
      finishDefault([
        {
          id: 'older',
          agent: first,
          prompt: 'Legacy only',
          status: 'completed',
          output: '',
        },
      ])
    );
    expect(screen.queryByText('Legacy only')).not.toBeInTheDocument();
    view.unmount();
    render(<SessionAgents projectId="one" />);
    await screen.findByText('Budget only');
    expect(screen.getByRole('combobox', { name: 'Select task' })).toHaveValue(
      'b'
    );
  });

  it('does not show a previous node history after switching', async () => {
    let deliver: (value: unknown) => void = () => {};
    mocks.api.runs.mockImplementation((id) =>
      id === 'a'
        ? new Promise((resolve) => {
            deliver = resolve;
          })
        : Promise.resolve([])
    );
    render(<SessionAgents projectId="s" />);
    fireEvent.change(
      await screen.findByRole('combobox', { name: 'Select Agent' }),
      { target: { value: 'b' } }
    );
    deliver([
      {
        id: 'old',
        agent: first,
        prompt: 'Private old history',
        output: '',
        status: 'completed',
      },
    ]);
    await waitFor(() =>
      expect(mocks.api.runs).toHaveBeenCalledWith('b', 'default')
    );
    expect(screen.queryByText('Private old history')).not.toBeInTheDocument();
  });
});

it('edits node instructions while keeping the previous run configuration visible', async () => {
  const configured = {
    ...first,
    harness_id: 'plan_execute',
    role: 'Researcher',
    instructions: 'Cite sources.',
  };
  mocks.api.list.mockResolvedValue([configured, second]);
  mocks.api.runs.mockResolvedValue([
    {
      id: 'old-run',
      agent: { ...configured, harness_version: '1.0.0' },
      plan: 'Check sources for each claim.',
      prompt: 'Question',
      output: 'Answer',
      status: 'completed',
    },
  ]);
  mocks.api.update.mockResolvedValue({
    ...configured,
    revision: 2,
    harness_id: 'standard',
    role: 'Reviewer',
    instructions: 'List risks.',
  });
  render(<SessionAgents projectId="s" />);
  fireEvent.click(await screen.findByRole('button', { name: 'Edit Agent' }));
  expect(screen.getByRole('textbox', { name: 'Role (optional)' })).toHaveValue(
    'Researcher'
  );
  expect(
    screen.getByRole('textbox', { name: 'Instructions (optional)' })
  ).toHaveValue('Cite sources.');
  const harness = screen.getByRole('combobox', { name: 'Execution harness' });
  expect(harness).toHaveValue('plan_execute');
  fireEvent.change(harness, { target: { value: 'standard' } });
  fireEvent.change(screen.getByRole('textbox', { name: 'Role (optional)' }), {
    target: { value: 'Reviewer' },
  });
  fireEvent.change(
    screen.getByRole('textbox', { name: 'Instructions (optional)' }),
    { target: { value: 'List risks.' } }
  );
  fireEvent.click(screen.getByRole('button', { name: 'Save', exact: true }));
  await waitFor(() =>
    expect(mocks.api.update).toHaveBeenCalledWith(
      configured,
      'Research',
      first.model,
      {
        role: 'Reviewer',
        instructions: 'List risks.',
        skill_ids: [],
        tool_policy: {},
        harness_id: 'standard',
      }
    )
  );
  fireEvent.click(
    await screen.findByRole('button', { name: 'Run configuration' })
  );
  expect(screen.getByText('Plan then execute · v1.0.0')).toBeVisible();
  fireEvent.click(screen.getByText('Plan', { selector: 'summary' }));
  await waitFor(() =>
    expect(screen.getByText('Check sources for each claim.')).toBeVisible()
  );
  expect(screen.getByText('Cite sources.')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Edit Agent' }));
  expect(
    screen.getByRole('textbox', { name: 'Instructions (optional)' })
  ).toHaveValue('List risks.');
});

it('keeps unsaved instructions in the form after a failed save and cancels without changing the node', async () => {
  mocks.api.update.mockRejectedValue(new Error('conflict'));
  render(<SessionAgents projectId="s" />);
  fireEvent.click(await screen.findByRole('button', { name: 'Edit Agent' }));
  fireEvent.change(
    screen.getByRole('textbox', { name: 'Instructions (optional)' }),
    { target: { value: 'Unsaved draft' } }
  );
  fireEvent.click(screen.getByRole('button', { name: 'Save', exact: true }));
  await screen.findByText('Could not save. Refresh the Agents and try again.');
  expect(
    screen.getByRole('textbox', { name: 'Instructions (optional)' })
  ).toHaveValue('Unsaved draft');
  fireEvent.click(screen.getByRole('button', { name: 'Cancel', exact: true }));
  fireEvent.click(screen.getByRole('button', { name: 'Edit Agent' }));
  expect(
    screen.getByRole('textbox', { name: 'Instructions (optional)' })
  ).toHaveValue('');
});

it('preserves a missing skill across a catalog failure and lets the user remove it', async () => {
  const configured = { ...first, skill_ids: ['retired'] };
  mocks.api.list.mockResolvedValue([configured]);
  mocks.api.skills.mockRejectedValueOnce(new Error('offline'));
  mocks.api.update.mockResolvedValue({
    ...configured,
    skill_ids: [],
    revision: 2,
  });
  render(<SessionAgents projectId="s" />);
  fireEvent.click(await screen.findByRole('button', { name: 'Edit Agent' }));
  fireEvent.mouseDown(screen.getByRole('tab', { name: 'Capabilities' }), {
    button: 0,
  });
  const alert = await screen.findByRole('alert');
  expect(screen.getByRole('checkbox', { name: 'retired' })).toBeChecked();
  fireEvent.click(within(alert).getByRole('button', { name: 'Refresh' }));
  fireEvent.click(
    await screen.findByRole('checkbox', { name: 'retired (unavailable)' })
  );
  fireEvent.click(screen.getByRole('button', { name: 'Save', exact: true }));
  await waitFor(() =>
    expect(mocks.api.update).toHaveBeenCalledWith(
      configured,
      'Research',
      first.model,
      expect.objectContaining({ skill_ids: [] })
    )
  );
});

it('limits optional tool consent to the submitted turn', async () => {
  const configured = { ...first, tool_policy: { utc_time: 'turn' } };
  mocks.api.list.mockResolvedValue([configured, second]);
  render(<SessionAgents projectId="s" />);
  const grant = await screen.findByRole('checkbox', {
    name: 'Current UTC time',
  });
  expect(grant).not.toBeChecked();
  fireEvent.click(grant);
  fireEvent.change(
    screen.getByRole('textbox', { name: 'Message this Agent' }),
    { target: { value: 'Time?' } }
  );
  fireEvent.click(screen.getByRole('button', { name: 'Send', exact: true }));
  await waitFor(() =>
    expect(mocks.api.start).toHaveBeenCalledWith(
      'a',
      expect.objectContaining({ approved_tools: ['utc_time'] })
    )
  );
  await waitFor(() => expect(grant).not.toBeChecked());
  await act(async () => {
    fireEvent.change(screen.getByRole('combobox', { name: 'Select Agent' }), {
      target: { value: 'b' },
    });
  });
  expect(
    screen.queryByRole('checkbox', { name: 'Current UTC time' })
  ).not.toBeInTheDocument();
});

it('requires a fresh per-turn grant after an uncertain send and a changed prompt', async () => {
  mocks.api.start.mockRejectedValue(new Error('lost response'));
  mocks.api.list.mockResolvedValue([
    { ...first, tool_policy: { calculate: 'turn' } },
  ]);
  render(<SessionAgents projectId="s" />);
  const check = await screen.findByRole('checkbox', { name: 'Calculator' });
  const message = screen.getByRole('textbox', { name: 'Message this Agent' });
  fireEvent.click(check);
  fireEvent.change(message, { target: { value: 'First question' } });
  const send = screen.getByRole('button', { name: 'Send', exact: true });
  fireEvent.click(send);
  await waitFor(() => expect(send).toBeEnabled());
  expect(mocks.api.start.mock.calls[0][1].approved_tools).toEqual([
    'calculate',
  ]);
  fireEvent.change(message, { target: { value: 'Another question' } });
  expect(check).not.toBeChecked();
  fireEvent.click(send);
  await waitFor(() => expect(mocks.api.start).toHaveBeenCalledTimes(2));
  expect(mocks.api.start.mock.calls[1][1].approved_tools).toEqual([]);
});
