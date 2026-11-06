import type { workspaceGraphApi } from '@/service/workspaceGraphApi';

/** Serialize edits from one canvas and read the authoritative revision at
 * dispatch time. A slow directory refresh must never gate the next wire. */
export function createResourceConnector(
  api: Pick<
    ReturnType<typeof workspaceGraphApi>,
    'get' | 'setAgentReferences' | 'bindAutomation'
  >
) {
  let pending: Promise<unknown> = Promise.resolve();
  return (
    source: { kind: 'context' | 'memory' | 'automation'; id: string },
    target: { id: string; projectId: string }
  ) => {
    const operation = pending.then(async () => {
      const graph = await api.get();
      if (source.kind === 'automation') {
        const binding = graph.automation_bindings.find(
          (b) => b.trigger_id === source.id
        );
        return {
          kind: 'automation' as const,
          value: await api.bindAutomation(source.id, {
            project_id: target.projectId,
            agent_id: target.id,
            expected_revision: binding?.revision ?? 0,
          }),
        };
      }
      const ref = graph.agent_references.find((r) => r.agent_id === target.id);
      const contexts = ref?.context_ids ?? [],
        memories = ref?.memory_ids ?? [];
      return {
        kind: 'references' as const,
        value: await api.setAgentReferences(target.projectId, target.id, {
          context_ids:
            source.kind === 'context'
              ? [...new Set([...contexts, source.id])]
              : contexts,
          memory_ids:
            source.kind === 'memory'
              ? [...new Set([...memories, source.id])]
              : memories,
          expected_revision: ref?.revision ?? 0,
        }),
      };
    });
    pending = operation.catch(() => undefined);
    return operation;
  };
}
