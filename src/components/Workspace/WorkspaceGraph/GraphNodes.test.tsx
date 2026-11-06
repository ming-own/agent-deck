import { render, screen } from '@testing-library/react';
import { ReactFlow, ReactFlowProvider } from '@xyflow/react';
import { describe, expect, it, vi } from 'vitest';
import { WorkspaceObjectNode, WorkspaceSessionNode } from './GraphNodes';
import type { GraphItem } from './graphModel';

vi.mock('@/components/Session/Agents/CanvasTrial', () => ({
  TrialResult: ({ children }: { children: React.ReactNode }) => children,
  TrialAction: () => null,
}));

function show(item: GraphItem) {
  return render(
    <ReactFlowProvider>
      <ReactFlow
        width={900}
        height={600}
        nodes={[
          {
            id: item.id,
            type: item.kind === 'session' ? 'session' : 'object',
            position: { x: 0, y: 0 },
            width: 244,
            height: 288,
            measured: { width: 244, height: 288 },
            data: { item, open: () => {} },
          },
        ]}
        nodeTypes={{
          object: WorkspaceObjectNode,
          session: WorkspaceSessionNode,
        }}
      />
    </ReactFlowProvider>
  );
}

describe('workspace connection affordances', () => {
  it.each(['context', 'memory', 'automation'] as const)(
    '%s exposes only an outgoing, named connection port',
    (kind) => {
      const { container } = show({ kind, id: 'resource', name: 'Brief' });
      expect(
        screen.getByRole('button', { name: /Connect to Agent.*Brief/ })
      ).toHaveAttribute('data-port-direction', 'source');
      expect(container.querySelector('.react-flow__handle.target')).toBeNull();
    }
  );
  it('keeps session relationship anchors out of user connection gestures', () => {
    const { container } = show({ kind: 'session', id: 's', name: 'Session' });
    const handle = container.querySelector('.react-flow__handle');
    expect(handle).not.toHaveClass('connectablestart');
    expect(handle).not.toHaveClass('connectableend');
  });
});
