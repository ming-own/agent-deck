import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { SessionAgent } from '@/service/sessionAgentApi';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
import { AgentForm } from './index';
import { NodeInspector } from './NodeInspector';

const agent: SessionAgent = {
  id: 'a',
  name: 'Reviewer',
  revision: 1,
  role: 'Original role',
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
};
const choices = [
  {
    id: 'codex:model-a',
    name: 'Model A',
    group: 'codex-subscription' as const,
    codexModelType: 'model-a',
  },
];
const props = {
  docked: true,
  inline: true,
  node: agent,
  choices,
  loadSkills: async () => [],
  restoreFocus: vi.fn(),
  onCancel: vi.fn(),
  onSave: vi.fn(async () => {}),
};
function MessageDraft() {
  const [message, setMessage] = useState('');
  return (
    <input
      aria-label="Task message"
      value={message}
      onChange={(e) => setMessage(e.target.value)}
    />
  );
}
const tab = (name: string) =>
  fireEvent.mouseDown(screen.getByRole('tab', { name, exact: true }), {
    button: 0,
    ctrlKey: false,
  });
beforeEach(() => vi.clearAllMocks());

it('keeps configuration and task drafts when switching through references in the same inspector', async () => {
  render(
    <AgentForm
      {...props}
      conversation={<MessageDraft />}
      references={<p>Reference controls</p>}
    />
  );
  fireEvent.change(screen.getByRole('textbox', { name: 'Role (optional)' }), {
    target: { value: 'Draft role' },
  });
  tab('References');
  await waitFor(() =>
    expect(screen.getByText('Reference controls')).toBeVisible()
  );
  expect(
    screen.queryByRole('textbox', { name: 'Role (optional)' })
  ).not.toBeInTheDocument();
  tab('Tasks');
  fireEvent.change(screen.getByRole('textbox', { name: 'Task message' }), {
    target: { value: 'Unsaved prompt' },
  });
  tab('General');
  expect(screen.getByRole('textbox', { name: 'Role (optional)' })).toHaveValue(
    'Draft role'
  );
  expect(
    screen.queryByRole('textbox', { name: 'Task message' })
  ).not.toBeInTheDocument();
  tab('Tasks');
  expect(screen.getByRole('textbox', { name: 'Task message' })).toHaveValue(
    'Unsaved prompt'
  );
  expect(props.onSave).not.toHaveBeenCalled();
});

it('does not move focus out of an inspector when closing is refused', () => {
  const restoreFocus = vi.fn();
  render(
    <NodeInspector
      docked
      title="Reviewer"
      busy={false}
      close={() => false}
      restoreFocus={restoreFocus}
    >
      <input aria-label="Draft" />
    </NodeInspector>
  );
  fireEvent.click(screen.getByRole('button', { name: 'Close', exact: true }));
  expect(restoreFocus).not.toHaveBeenCalled();
  expect(screen.getByRole('textbox', { name: 'Draft' })).toBeVisible();
});

it.each(['keyboard', 'pointer'])(
  'dismisses the task dropdown opened by %s with Escape before closing its inspector',
  async (method) => {
    const user = userEvent.setup();
    if (!Element.prototype.scrollIntoView)
      Element.prototype.scrollIntoView = vi.fn();
    if (!Element.prototype.hasPointerCapture)
      Element.prototype.hasPointerCapture = vi.fn(() => false);
    function Editor() {
      const [open, setOpen] = useState(true);
      return open ? (
        <NodeInspector
          docked
          title="Reviewer"
          busy={false}
          close={() => setOpen(false)}
        >
          <Select defaultValue="default">
            <SelectTrigger aria-label="Select task">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="default">Default task</SelectItem>
              <SelectItem value="review">Review task</SelectItem>
            </SelectContent>
          </Select>
        </NodeInspector>
      ) : null;
    }
    render(<Editor />);
    const trigger = screen.getByRole('combobox', { name: 'Select task' });
    if (method === 'keyboard') fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    else await user.click(trigger);
    expect(screen.getByRole('listbox')).toBeVisible();
    await user.keyboard('{Escape}');
    await waitFor(() =>
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    );
    expect(
      screen.getByRole('complementary', { name: 'Reviewer' })
    ).toBeVisible();
    expect(trigger).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
  }
);
