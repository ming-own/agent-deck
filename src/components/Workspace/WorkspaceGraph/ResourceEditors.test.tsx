import { hasPendingWorkspaceConfigurationChanges } from '@/lib/workspaceConfigurationNavigationGuard';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ReferenceEditor } from './ResourceEditors';
import type { WorkspaceAgent, WorkspaceData } from './useWorkspaceGraph';

vi.mock('@/service/memoryApi', () => ({
  createMemoryEntry: vi.fn(),
  updateMemoryEntry: vi.fn(),
}));

describe('workspace references', () => {
  it('lets the user remove a deleted reference without clearing valid ones', async () => {
    const save = vi.fn().mockResolvedValue({ revision: 4 });
    const data = {
      graph: {
        contexts: [{ id: 'live', name: 'Brief', enabled: true }],
        agent_references: [
          {
            agent_id: 'a',
            context_ids: ['live', 'deleted'],
            memory_ids: [],
            revision: 3,
          },
        ],
      },
      memories: [],
      api: { setAgentReferences: save },
    } as unknown as WorkspaceData;
    render(
      <ReferenceEditor
        data={data}
        agent={{ id: 'a', projectId: 's' } as WorkspaceAgent}
        onSaved={() => {}}
      />
    );
    const boxes = screen.getAllByRole('checkbox');
    expect(boxes).toHaveLength(2);
    expect(boxes[1]).toBeChecked();
    fireEvent.click(boxes[1]);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith('s', 'a', {
        context_ids: ['live'],
        memory_ids: [],
        expected_revision: 3,
      })
    );
  });

  it('uses the returned revision for the next save without remounting', async () => {
    const save = vi
      .fn()
      .mockResolvedValueOnce({ revision: 4 })
      .mockResolvedValueOnce({ revision: 5 });
    const data = {
      graph: {
        contexts: [{ id: 'brief', name: 'Brief', enabled: true }],
        agent_references: [
          { agent_id: 'a', context_ids: [], memory_ids: [], revision: 3 },
        ],
      },
      memories: [],
      api: { setAgentReferences: save },
    } as unknown as WorkspaceData;
    const agent = { id: 'a', projectId: 's' } as WorkspaceAgent;
    render(<ReferenceEditor data={data} agent={agent} onSaved={() => {}} />);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Brief' }));
    expect(hasPendingWorkspaceConfigurationChanges()).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(hasPendingWorkspaceConfigurationChanges()).toBe(false)
    );
    expect(save).toHaveBeenNthCalledWith(1, 's', 'a', {
      context_ids: ['brief'],
      memory_ids: [],
      expected_revision: 3,
    });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Brief' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    expect(save).toHaveBeenNthCalledWith(2, 's', 'a', {
      context_ids: [],
      memory_ids: [],
      expected_revision: 4,
    });
  });

  it('adopts a newer reference snapshot while clean and saves its revision', async () => {
    const save = vi.fn().mockResolvedValue({ revision: 5 });
    const data = {
      graph: {
        contexts: [{ id: 'brief', name: 'Brief', enabled: true }],
        agent_references: [
          { agent_id: 'a', context_ids: [], memory_ids: [], revision: 3 },
        ],
      },
      memories: [],
      api: { setAgentReferences: save },
    } as unknown as WorkspaceData;
    const agent = { id: 'a', projectId: 's' } as WorkspaceAgent;
    const rendered = render(
      <ReferenceEditor data={data} agent={agent} onSaved={() => {}} />
    );
    rendered.rerender(
      <ReferenceEditor
        data={{
          ...data,
          graph: {
            ...data.graph!,
            agent_references: [
              {
                ...data.graph!.agent_references[0],
                context_ids: ['brief'],
                revision: 4,
              },
            ],
          },
        }}
        agent={agent}
        onSaved={() => {}}
      />
    );
    expect(screen.getByRole('checkbox', { name: 'Brief' })).toBeChecked();
    expect(hasPendingWorkspaceConfigurationChanges()).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith('s', 'a', {
        context_ids: ['brief'],
        memory_ids: [],
        expected_revision: 4,
      })
    );
  });

  it('keeps dirty references on their original snapshot when a newer revision arrives', async () => {
    const save = vi.fn().mockRejectedValue(new Error('revision conflict'));
    const done = vi.fn();
    const data = {
      graph: {
        contexts: [
          { id: 'brief', name: 'Brief', enabled: true },
          { id: 'remote', name: 'Remote context', enabled: true },
        ],
        agent_references: [
          { agent_id: 'a', context_ids: [], memory_ids: [], revision: 3 },
        ],
      },
      memories: [],
      api: { setAgentReferences: save },
    } as unknown as WorkspaceData;
    const agent = { id: 'a', projectId: 's' } as WorkspaceAgent;
    const rendered = render(
      <ReferenceEditor data={data} agent={agent} onSaved={done} />
    );
    fireEvent.click(screen.getByRole('checkbox', { name: 'Brief' }));
    rendered.rerender(
      <ReferenceEditor
        data={{
          ...data,
          graph: {
            ...data.graph!,
            agent_references: [
              {
                ...data.graph!.agent_references[0],
                context_ids: ['remote'],
                revision: 4,
              },
            ],
          },
        }}
        agent={agent}
        onSaved={done}
      />
    );
    expect(screen.getByRole('checkbox', { name: 'Brief' })).toBeChecked();
    expect(
      screen.getByRole('checkbox', { name: 'Remote context' })
    ).not.toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByText(
      'Could not save. Reload to check the current configuration and try again.'
    );
    expect(save).toHaveBeenCalledWith('s', 'a', {
      context_ids: ['brief'],
      memory_ids: [],
      expected_revision: 3,
    });
    expect(hasPendingWorkspaceConfigurationChanges()).toBe(true);
    expect(done).not.toHaveBeenCalled();
  });

  it('retains failed reference changes and their revision until a successful retry', async () => {
    const save = vi
      .fn()
      .mockRejectedValueOnce(new Error('network unavailable'))
      .mockResolvedValueOnce({ revision: 4 });
    const done = vi.fn();
    const data = {
      graph: {
        contexts: [{ id: 'brief', name: 'Brief', enabled: true }],
        agent_references: [
          { agent_id: 'a', context_ids: [], memory_ids: [], revision: 3 },
        ],
      },
      memories: [],
      api: { setAgentReferences: save },
    } as unknown as WorkspaceData;
    render(
      <ReferenceEditor
        data={data}
        agent={{ id: 'a', projectId: 's' } as WorkspaceAgent}
        onSaved={done}
      />
    );
    fireEvent.click(screen.getByRole('checkbox', { name: 'Brief' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByText(
      'Could not save. Reload to check the current configuration and try again.'
    );
    expect(screen.getByRole('checkbox', { name: 'Brief' })).toBeChecked();
    expect(hasPendingWorkspaceConfigurationChanges()).toBe(true);
    expect(done).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(done).toHaveBeenCalledOnce());
    expect(save).toHaveBeenNthCalledWith(2, 's', 'a', {
      context_ids: ['brief'],
      memory_ids: [],
      expected_revision: 3,
    });
    expect(hasPendingWorkspaceConfigurationChanges()).toBe(false);
  });
});
