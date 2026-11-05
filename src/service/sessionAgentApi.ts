import { fetchGet, fetchPost, fetchPut } from '@/api/http';
import type { AgentModelReference } from './sessionAgentModels';

export interface SkillOption {
  id: string;
  name: string;
}

export type AgentToolId = 'calculate' | 'utc_time' | 'read_skill_reference';
export type AgentToolPolicy = Partial<Record<AgentToolId, 'turn' | 'allow'>>;

export interface AgentBehavior {
  harness_id: string;
  tool_policy: AgentToolPolicy;
  skill_ids: string[];
  role: string;
  instructions: string;
}

export interface CanvasPosition {
  x: number;
  y: number;
  revision: number;
}

export interface SessionAgent extends AgentBehavior {
  id: string;
  name: string;
  model: AgentModelReference;
  revision: number;
  position?: CanvasPosition | null;
  created_at: string;
  updated_at: string;
}
export interface AgentTask {
  id: string;
  name: string;
}

export interface SourceAnswer {
  id: string;
  agent_id: string;
  agent_name: string;
  task_id: string;
  task_name: string | null;
  finished_at: string;
  output: string;
}

export interface SessionAgentRun {
  returned_results?: {
    event_id: string;
    run_id: string;
    agent_name: string;
    task_name: string | null;
    message: string;
    output: string;
  }[];
  source_answer?: SourceAnswer | null;
  task_id: string;
  id: string;
  agent_id: string;
  request_id: string;
  agent: Omit<SessionAgent, 'harness_id'> & {
    harness_id?: string;
    harness_version?: string;
    granted_tools?: AgentToolId[];
    tool_calls?: Partial<Record<AgentToolId, number>>;
    skill_versions?: (SkillOption & { sha256: string })[];
  };
  prompt: string;
  output: string;
  plan?: string | null;
  status: 'running' | 'completed' | 'failed' | 'interrupted';
  error: string | null;
  created_at: string;
  finished_at: string | null;
}

export interface RouteOrigin {
  agentId: string;
  taskId: string;
}

export interface RouteReceipt {
  event_id: string;
  reply_to: string | null;
  run_id: string;
  origin_agent_id: string | null;
  origin_task_id: string | null;
  origin_name: string | null;
  origin_task_name: string | null;
  target_agent_id: string;
  target_task_id: string;
  target_name: string;
  target_task_name: string | null;
  message: string;
  output: string;
  status: SessionAgentRun['status'];
  created_at: string;
  finished_at: string | null;
}

export interface BatchTarget {
  agent_id: string;
  name: string;
  instructions: string;
}
export interface BatchSpec {
  branches: (BatchTarget & { contains: string })[];
  summary: BatchTarget;
  message: string;
  join: 'all_success' | 'all_finished';
}
type BatchResult = Pick<
  SessionAgentRun,
  | 'id'
  | 'agent_id'
  | 'task_id'
  | 'status'
  | 'output'
  | 'error'
  | 'created_at'
  | 'finished_at'
>;
export interface BatchReceipt {
  event_id: string;
  created_at: string;
  state: SessionAgentRun['status'] | 'waiting' | 'blocked' | 'unmatched';
  spec: BatchSpec;
  branches: (BatchResult | null)[];
  summary: BatchResult | null;
}

/** Capture scope at render/gesture time; fetch also fences account switches. */
export function sessionAgentApi(account: string, projectId: string) {
  const root = `/session-agents/${encodeURIComponent(projectId)}`;
  const headers = { 'X-AgentDeck-Account': account };
  const options = { expectedAccountKey: account };
  return {
    batches: (): Promise<BatchReceipt[]> =>
      fetchGet(`${root}/router/batches`, undefined, headers, options),
    dispatchBatch: (body: unknown): Promise<BatchReceipt> =>
      fetchPost(`${root}/router/batches`, body, headers, options),
    route: (body: unknown): Promise<RouteReceipt> =>
      fetchPost(`${root}/router/messages`, body, headers, options),
    receipts: (origin?: RouteOrigin): Promise<RouteReceipt[]> =>
      fetchGet(
        `${root}/router/messages`,
        origin
          ? { origin_agent_id: origin.agentId, origin_task_id: origin.taskId }
          : undefined,
        headers,
        options
      ),
    skills: (): Promise<SkillOption[]> =>
      fetchGet(`${root}/skill-catalog`, undefined, headers, options),
    list: (): Promise<SessionAgent[]> =>
      fetchGet(root, undefined, headers, options),
    create: (
      name: string,
      model: AgentModelReference,
      behavior: AgentBehavior
    ): Promise<SessionAgent> =>
      fetchPost(root, { name, model, ...behavior }, headers, options),
    update: (
      node: SessionAgent,
      name: string,
      model: AgentModelReference,
      behavior: AgentBehavior
    ): Promise<SessionAgent> =>
      fetchPut(
        `${root}/${node.id}`,
        { name, model, ...behavior, expected_revision: node.revision },
        headers,
        options
      ),
    move: (
      id: string,
      x: number,
      y: number,
      expectedRevision: number
    ): Promise<CanvasPosition> =>
      fetchPut(
        `${root}/${encodeURIComponent(id)}/position`,
        { x, y, expected_revision: expectedRevision },
        headers,
        options
      ),
    tasks: (id: string): Promise<AgentTask[]> =>
      fetchGet(`${root}/${id}/tasks`, undefined, headers, options),
    createTask: (
      id: string,
      taskId: string,
      name: string
    ): Promise<AgentTask> =>
      fetchPost(`${root}/${id}/tasks`, { id: taskId, name }, headers, options),
    runs: (id: string, taskId: string): Promise<SessionAgentRun[]> =>
      fetchGet(
        `${root}/${id}/runs?task_id=${encodeURIComponent(taskId)}`,
        undefined,
        headers,
        options
      ),
    start: (id: string, body: unknown): Promise<SessionAgentRun> =>
      fetchPost(`${root}/${id}/runs`, body, headers, options),
    cancel: (id: string, runId: string, taskId: string) =>
      fetchPost(
        `${root}/${id}/runs/${runId}/cancel?task_id=${encodeURIComponent(taskId)}`,
        {},
        headers,
        options
      ),
  };
}
