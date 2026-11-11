import { registerWorkspaceConfigurationNavigationGuard } from '@/lib/workspaceConfigurationNavigationGuard';
import type { CanvasTrial, SessionAgent } from '@/service/sessionAgentApi';
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import {
  CanvasTrials,
  TrialAction,
  TrialPreview,
  TrialResult,
} from './CanvasTrial';

const mocks = vi.hoisted(() => ({
  latest: vi.fn(),
  start: vi.fn(),
  fitView: vi.fn(),
}));
vi.mock('@xyflow/react', () => ({
  useReactFlow: () => ({ fitView: mocks.fitView }),
}));
vi.mock('@/service/sessionAgentApi', () => ({
  sessionAgentApi: () => ({
    latestTrial: mocks.latest,
    startTrial: mocks.start,
  }),
}));
vi.mock('@/service/sessionAgentModels', () => ({
  resolveNodeConnection: () => ({
    model_platform: 'openai',
    model_type: 'test',
  }),
}));
vi.mock('@/components/ChatBox/MessageItem/MarkDown', () => ({
  MarkDown: ({ content }: { content: string }) => <div>{content}</div>,
}));

const a = {
  id: 'a',
  name: 'A',
  revision: 1,
  model: { id: 'model', name: 'Model A' },
  outputs: ['b'],
} as SessionAgent;
const b = { ...a, id: 'b', name: 'B', outputs: [] } as SessionAgent;
const trial: CanvasTrial = {
  id: 'trial',
  prompt: 'Budget task',
  status: 'completed',
  steps: [
    {
      agent_id: 'a',
      name: 'A',
      run_id: 'ar',
      status: 'completed',
      output: 'Budget is 42',
    },
    {
      agent_id: 'b',
      name: 'B',
      run_id: 'br',
      status: 'completed',
      output: 'Remaining 25',
    },
  ],
};
function App({ inspectorOpen = false }: { inspectorOpen?: boolean }) {
  return (
    <CanvasTrials
      account="owner"
      regions={[{ id: 'p', name: 'Session', agents: [a, b] }]}
      choices={[]}
      email="test@example.com"
      inspectorOpen={inspectorOpen}
    >
      <TrialPreview project="p" agent={a} />
      <TrialResult project="p" agent={a}>
        Idle
      </TrialResult>
      <TrialAction project="p" agent={a} />
    </CanvasTrials>
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.latest.mockResolvedValue(trial);
  mocks.start.mockResolvedValue(trial);
});

it('opens results without a modal, switches answers, shows source and restores keyboard focus', async () => {
  render(<App />);
  expect(await screen.findByText('Budget is 42')).toBeInTheDocument();
  const opener = await screen.findByRole('button', {
    name: 'Result · A',
  });
  fireEvent.click(opener);
  const panel = screen.getByRole('complementary', {
    name: 'Result',
  });
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(within(panel).getByText('Budget is 42')).toBeInTheDocument();
  fireEvent.click(within(panel).getByRole('button', { name: 'B' }));
  expect(within(panel).getByText('Remaining 25')).toBeInTheDocument();
  expect(within(panel).getByText('Quoted answer · A')).toBeInTheDocument();
  fireEvent.keyDown(panel, { key: 'Escape' });
  expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
  expect(opener).toHaveFocus();
});

it('opens the result panel after submitting and closes when node configuration takes over', async () => {
  const view = render(<App />);
  await screen.findByText('Budget is 42');
  fireEvent.click(screen.getByRole('button', { name: 'Test run · A' }));
  const panel = screen.getByRole('complementary', {
    name: 'Test run',
  });
  fireEvent.change(within(panel).getByRole('textbox', { name: 'Task input' }), {
    target: { value: 'New task' },
  });
  fireEvent.click(within(panel).getByRole('button', { name: 'Test run' }));
  await waitFor(() => expect(mocks.start).toHaveBeenCalledTimes(1));
  expect(mocks.start.mock.calls[0][0]).toMatchObject({
    prompt: 'New task',
    path: ['a', 'b'],
  });
  expect(
    await screen.findByRole('complementary', { name: 'Result' })
  ).toBeInTheDocument();
  view.rerender(<App inspectorOpen />);
  expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
});

it('keeps the current editor when leaving its draft for a trial is refused', async () => {
  const onInspect = vi.fn();
  const unregister = registerWorkspaceConfigurationNavigationGuard({
    hasPendingChanges: () => true,
    flushSave: async () => false,
  });
  try {
    render(
      <CanvasTrials
        account="owner"
        regions={[{ id: 'p', name: 'Session', agents: [a, b] }]}
        choices={[]}
        email="test@example.com"
        onInspect={onInspect}
      >
        <TrialAction project="p" agent={a} />
      </CanvasTrials>
    );
    fireEvent.click(screen.getByRole('button', { name: 'Test run · A' }));
    await waitFor(() => expect(onInspect).not.toHaveBeenCalled());
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
    expect(mocks.start).not.toHaveBeenCalled();
  } finally {
    unregister();
  }
});
