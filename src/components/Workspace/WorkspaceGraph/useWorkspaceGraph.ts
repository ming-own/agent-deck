import { withoutTriggerPlaceholderTasks } from '@/lib/projectRuntimeHydration';
import { fetchGroupedHistoryProjects } from '@/service/historyApi';
import { listMemoryEntries, type MemoryEntry } from '@/service/memoryApi';
import {
  sessionAgentApi,
  type AgentTask,
  type SessionAgent,
} from '@/service/sessionAgentApi';
import { proxyFetchSpaceTriggers } from '@/service/triggerApi';
import {
  workspaceGraphApi,
  type WorkspaceGraph,
} from '@/service/workspaceGraphApi';
import {
  getVisibleProjectMetasForSpace,
  useSpaceStore,
} from '@/store/spaceStore';
import type { Trigger } from '@/types';
import { useCallback, useEffect, useMemo, useState } from 'react';
export type WorkspaceAgent = SessionAgent & { projectId: string };
export type WorkspaceTask = AgentTask & { agent: WorkspaceAgent };
export type WorkspaceHistoryTask = {
  id: string;
  name: string;
  projectId: string;
  status: number;
};
export function useWorkspaceGraph(account: string, spaceId: string) {
  const projects = useSpaceStore((s) => s.projectsBySpaceId);
  const sessions = useMemo(
    () => getVisibleProjectMetasForSpace(projects, spaceId),
    [projects, spaceId]
  );
  const api = useMemo(
    () => workspaceGraphApi(account, spaceId),
    [account, spaceId]
  );
  const [historyTasks, setHistoryTasks] = useState<WorkspaceHistoryTask[]>([]);
  const [graph, setGraph] = useState<WorkspaceGraph | null>(null),
    [agents, setAgents] = useState<WorkspaceAgent[]>([]),
    [tasks, setTasks] = useState<WorkspaceTask[]>([]),
    [memories, setMemories] = useState<MemoryEntry[]>([]),
    [automations, setAutomations] = useState<Trigger[]>([]);
  const [errors, setErrors] = useState<string[]>([]),
    [loading, setLoading] = useState(true),
    [epoch, setEpoch] = useState(0);
  const refresh = useCallback(() => setEpoch((e) => e + 1), []);
  const ids = JSON.stringify(sessions.map((s) => s.id).sort());
  useEffect(() => {
    let live = true;
    setLoading(true);
    const sessionIds: string[] = JSON.parse(ids);
    void (async () => {
      const result = await Promise.allSettled([
        api.registerSessions(sessionIds),
        Promise.all(
          sessionIds.map(async (id) =>
            (await sessionAgentApi(account, id).list()).map((a) => ({
              ...a,
              projectId: id,
            }))
          )
        ),
        listMemoryEntries('space', spaceId, false, account),
        proxyFetchSpaceTriggers(spaceId),
        fetchGroupedHistoryProjects({ spaceId, includeTasks: true }),
      ] as const);
      if (!live) return;
      const failed: string[] = [];
      if (result[0].status === 'fulfilled') setGraph(result[0].value);
      else failed.push('graph');
      if (result[1].status === 'fulfilled') {
        const nodes = result[1].value.flat();
        setAgents(nodes);
        const taskResults = await Promise.allSettled(
          nodes.map(async (agent) =>
            (
              await sessionAgentApi(account, agent.projectId).tasks(agent.id)
            ).map((task) => ({ ...task, agent }))
          )
        );
        if (!live) return;
        setTasks(
          taskResults.flatMap((r) => (r.status === 'fulfilled' ? r.value : []))
        );
        if (taskResults.some((r) => r.status === 'rejected'))
          failed.push('task');
      } else failed.push('agent');
      if (result[2].status === 'fulfilled') setMemories(result[2].value.items);
      else failed.push('memory');
      if (result[3].status === 'fulfilled')
        setAutomations(result[3].value.items);
      else failed.push('automation');
      if (result[4].status === 'fulfilled' && result[4].value)
        setHistoryTasks(
          result[4].value
            .filter((p) => sessionIds.includes(p.project_id))
            .flatMap((p) =>
              withoutTriggerPlaceholderTasks(p.tasks, p.project_id).map(
                (task) => ({
                  id: task.task_id,
                  name: task.question,
                  projectId: p.project_id,
                  status: task.status,
                })
              )
            )
        );
      else failed.push('task');
      setErrors(failed);
      setLoading(false);
    })();
    return () => {
      live = false;
    };
  }, [api, account, spaceId, ids, epoch]);
  useEffect(() => {
    let live = true,
      busy = false;
    const timer = window.setInterval(async () => {
      if (busy || document.visibilityState === 'hidden' || !agents.length)
        return;
      busy = true;
      try {
        const lists = await Promise.all(
          agents.map(async (agent) =>
            (
              await sessionAgentApi(account, agent.projectId).tasks(agent.id)
            ).map((task) => ({ ...task, agent }))
          )
        );
        if (live) setTasks(lists.flat());
      } catch {
        /* Keep last known state; explicit refresh surfaces connection errors. */
      } finally {
        busy = false;
      }
    }, 5000);
    return () => {
      live = false;
      window.clearInterval(timer);
    };
  }, [account, agents]);
  return {
    api,
    graph,
    setGraph,
    agents,
    tasks,
    historyTasks,
    memories,
    automations,
    sessions,
    errors,
    loading,
    refresh,
    epoch,
  };
}
export type WorkspaceData = ReturnType<typeof useWorkspaceGraph>;
