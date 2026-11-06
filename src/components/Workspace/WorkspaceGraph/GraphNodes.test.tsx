// ========= Copyright 2025-2026 @ Eigent.ai All Rights Reserved. =========
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
// ========= Copyright 2025-2026 @ Eigent.ai All Rights Reserved. =========

import { fireEvent, render, screen } from '@testing-library/react';
import { ReactFlow, ReactFlowProvider } from '@xyflow/react';
import { describe, expect, it, vi } from 'vitest';
import { WorkspaceObjectNode, WorkspaceSessionNode } from './GraphNodes';
import type { GraphItem } from './graphModel';

vi.mock('@/components/Session/Agents/CanvasTrial', () => ({
  TrialResult: ({ children }: { children: React.ReactNode }) => children,
  TrialAction: () => null,
}));

function show(item: GraphItem, extra: Record<string, unknown> = {}) {
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
            data: { item, open: () => {}, ...extra },
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

it('opens the exact task represented by a session result, preserving its Agent identity', () => {
  const open = vi.fn();
  const result = {
    kind: 'agent',
    id: 'a',
    name: 'Reviewer',
    projectId: 's',
    latestTask: { id: 'task-b', last_run: { status: 'completed' } },
  };
  show(
    { kind: 'session', id: 's', name: 'Session' },
    { expanded: true, results: [result], open }
  );
  fireEvent.click(screen.getByRole('button', { name: 'Reviewer · Completed' }));
  expect(open).toHaveBeenCalledWith(
    expect.objectContaining({
      kind: 'task',
      id: 'a:task-b',
      projectId: 's',
      latestTask: result.latestTask,
      task: result.latestTask,
    })
  );
});
