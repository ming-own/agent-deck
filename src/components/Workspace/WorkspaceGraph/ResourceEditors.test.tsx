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
    const save = vi.fn().mockResolvedValue({});
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
});
