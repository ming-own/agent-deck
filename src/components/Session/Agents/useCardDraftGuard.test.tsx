import { runAfterWorkspaceConfigurationSave } from '@/lib/workspaceConfigurationNavigationGuard';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { CardDraftScope, useCardDraftGuard } from './useCardDraftGuard';

function Draft({
  name,
  busy = false,
  changeTask,
}: {
  name: string;
  busy?: boolean;
  changeTask?: () => void;
}) {
  const [value, setValue] = useState('');
  const guard = useCardDraftGuard(value, { busy });
  return (
    <div>
      <input
        aria-label={name}
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
      <button onClick={() => guard.markSaved()}>{'Save ' + name}</button>
      {changeTask && (
        <button onClick={() => guard.confirmSelf() && changeTask()}>
          Change task
        </button>
      )}
    </div>
  );
}
afterEach(() => vi.restoreAllMocks());

it('protects every draft and clears only the independently saved baseline', async () => {
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
  const leave = vi.fn();
  render(
    <CardDraftScope>
      <Draft name="Configuration" />
      <Draft name="References" />
    </CardDraftScope>
  );
  fireEvent.change(screen.getByRole('textbox', { name: 'Configuration' }), {
    target: { value: 'Reviewer' },
  });
  fireEvent.change(screen.getByRole('textbox', { name: 'References' }), {
    target: { value: 'Context' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save References' }));
  await act(async () => {
    await runAfterWorkspaceConfigurationSave(leave);
  });
  expect(leave).not.toHaveBeenCalled();
  expect(confirm).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole('button', { name: 'Save Configuration' }));
  await act(async () => {
    await runAfterWorkspaceConfigurationSave(leave);
  });
  expect(leave).toHaveBeenCalledOnce();
  expect(confirm).toHaveBeenCalledOnce();
});

it('confirms only the departing task draft but blocks while sibling configuration saves', () => {
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
  const changeTask = vi.fn();
  const content = (busy: boolean) => (
    <CardDraftScope>
      <Draft name="Configuration" busy={busy} />
      <Draft name="Message" changeTask={changeTask} />
    </CardDraftScope>
  );
  const view = render(content(false));
  fireEvent.change(screen.getByRole('textbox', { name: 'Configuration' }), {
    target: { value: 'Unsaved role' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Change task' }));
  expect(changeTask).toHaveBeenCalledOnce();
  expect(confirm).not.toHaveBeenCalled();
  fireEvent.change(screen.getByRole('textbox', { name: 'Message' }), {
    target: { value: 'Unsent message' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Change task' }));
  expect(changeTask).toHaveBeenCalledOnce();
  expect(confirm).toHaveBeenCalledOnce();
  view.rerender(content(true));
  confirm.mockReturnValue(true);
  fireEvent.click(screen.getByRole('button', { name: 'Change task' }));
  expect(changeTask).toHaveBeenCalledOnce();
  expect(confirm).toHaveBeenCalledOnce();
  view.rerender(content(false));
  fireEvent.click(screen.getByRole('button', { name: 'Change task' }));
  expect(changeTask).toHaveBeenCalledTimes(2);
  expect(confirm).toHaveBeenCalledTimes(2);
  expect(screen.getByRole('textbox', { name: 'Configuration' })).toHaveValue(
    'Unsaved role'
  );
});

it('blocks leaving while any child is saving and confirms once for several dirty drafts', async () => {
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
  const leave = vi.fn();
  const view = render(
    <CardDraftScope>
      <Draft name="Configuration" />
      <Draft name="References" busy />
    </CardDraftScope>
  );
  fireEvent.change(screen.getByRole('textbox', { name: 'Configuration' }), {
    target: { value: 'Reviewer' },
  });
  await act(async () => {
    await runAfterWorkspaceConfigurationSave(leave);
  });
  expect(leave).not.toHaveBeenCalled();
  expect(confirm).not.toHaveBeenCalled();
  view.rerender(
    <CardDraftScope>
      <Draft name="Configuration" />
      <Draft name="References" />
    </CardDraftScope>
  );
  fireEvent.change(screen.getByRole('textbox', { name: 'References' }), {
    target: { value: 'Context' },
  });
  await act(async () => {
    await runAfterWorkspaceConfigurationSave(leave);
  });
  expect(leave).toHaveBeenCalledOnce();
  expect(confirm).toHaveBeenCalledOnce();
  view.unmount();
  await runAfterWorkspaceConfigurationSave(leave);
  expect(leave).toHaveBeenCalledTimes(2);
  expect(confirm).toHaveBeenCalledOnce();
});
