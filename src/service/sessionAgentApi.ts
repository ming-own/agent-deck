import { fetchGet, fetchPost, fetchPut } from '@/api/http';
import type { AgentModelReference } from './sessionAgentModels';

export interface SkillOption {
  id: string;
  name: string;
}

export type AgentToolId = 'calculate' | 'utc_time' | 'read_skill_reference';
export type AgentToolPolicy = Partial<Record<AgentToolId, 'turn' | 'allow'>>;

export interface AgentBehavior {
  tool_policy: AgentToolPolicy;
  skill_ids: string[];
  role: string;
  instructions: string;
}

export interface SessionAgent extends AgentBehavior {
  id: string;
  name: string;
  model: AgentModelReference;
  revision: number;
  created_at: string;
  updated_at: string;
}
export interface SessionAgentRun {
  id: string;
  agent_id: string;
  request_id: string;
  agent: SessionAgent & {
    granted_tools?: AgentToolId[];
    tool_calls?: Partial<Record<AgentToolId, number>>;
    skill_versions?: (SkillOption & { sha256: string })[];
  };
  prompt: string;
  output: string;
  status: 'running' | 'completed' | 'failed' | 'interrupted';
  error: string | null;
  created_at: string;
  finished_at: string | null;
}

/** Capture scope at render/gesture time; fetch also fences account switches. */
export function sessionAgentApi(account: string, projectId: string) {
  const root = `/session-agents/${encodeURIComponent(projectId)}`;
  const headers = { 'X-AgentDeck-Account': account };
  const options = { expectedAccountKey: account };
  return {
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
    runs: (id: string): Promise<SessionAgentRun[]> =>
      fetchGet(`${root}/${id}/runs`, undefined, headers, options),
    start: (id: string, body: unknown): Promise<SessionAgentRun> =>
      fetchPost(`${root}/${id}/runs`, body, headers, options),
    cancel: (id: string, runId: string) =>
      fetchPost(`${root}/${id}/runs/${runId}/cancel`, {}, headers, options),
  };
}
