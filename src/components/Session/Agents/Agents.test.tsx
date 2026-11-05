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
    list: vi.fn(),
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
  vi.clearAllMocks();
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
    await waitFor(() => expect(mocks.api.runs).toHaveBeenCalledWith('b'));
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
