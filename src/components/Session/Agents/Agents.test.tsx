import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SessionAgents } from './index';

const mocks = vi.hoisted(() => ({
  api: {
    list: vi.fn(),
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
    fireEvent.click(
      await screen.findByRole('button', { name: 'Writer', exact: true })
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
    await screen.findByRole('button', { name: 'Research', exact: true });
    fireEvent.click(screen.getByRole('button', { name: 'Add Agent' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Agent name' }), {
      target: { value: 'Reviewer' },
    });
    fireEvent.change(screen.getByRole('combobox'), {
      target: { value: 'codex:model-b' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save', exact: true }));
    await waitFor(() =>
      expect(mocks.api.create).toHaveBeenCalledWith('Reviewer', second.model)
    );
    expect(
      await screen.findByRole('button', { name: 'Reviewer', exact: true })
    ).toHaveAttribute('aria-pressed', 'true');
  });

  it('keeps an uncertain send idempotent', async () => {
    mocks.api.start.mockRejectedValue(new Error('lost response'));
    render(<SessionAgents projectId="s" />);
    await screen.findByRole('button', { name: 'Research', exact: true });
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
    fireEvent.click(
      await screen.findByRole('button', { name: 'Writer', exact: true })
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
