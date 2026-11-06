import { fetchDelete, fetchGet, fetchPost, fetchPut } from '@/api/http';
import type { SessionAgent } from './sessionAgentApi';

export type WorkspaceNodeKind =
  | 'session'
  | 'agent'
  | 'task'
  | 'automation'
  | 'context'
  | 'memory'
  | 'settings';

export interface ContextDocument {
  id: string;
  name: string;
  content: string;
  enabled: boolean;
  revision: number;
  created_at: string;
  updated_at: string;
}

export interface GraphPosition {
  kind: WorkspaceNodeKind;
  object_id: string;
  x: number;
  y: number;
  revision: number;
}

export interface AgentReferences {
  project_id: string;
  agent_id: string;
  context_ids: string[];
  memory_ids: string[];
  revision: number;
}

export interface AutomationBinding {
  trigger_id: string;
  project_id: string;
  agent_id: string;
  revision: number;
}

export interface WorkspaceGraph {
  space_id: string;
  session_ids: string[];
  contexts: ContextDocument[];
  positions: GraphPosition[];
  agent_references: AgentReferences[];
  automation_bindings: AutomationBinding[];
}

export interface ResourceReferenceSnapshot {
  kind: 'context' | 'memory';
  id: string;
  name: string;
  space_id: string;
  version: number;
  content: string;
}

export interface AutomationInstantiation {
  project_id: string;
  agent: SessionAgent;
  created: boolean;
  source_project_id: string;
  source_agent_id: string;
  execution_path: string[];
}

export function workspaceGraphApi(account: string, spaceId: string) {
  const root = `/workspace-graph/${encodeURIComponent(spaceId)}`;
  const headers = { 'X-AgentDeck-Account': account };
  const options = { expectedAccountKey: account };
  const encoded = encodeURIComponent;
  return {
    get: (): Promise<WorkspaceGraph> =>
      fetchGet(root, undefined, headers, options),
    registerSessions: (sessionIds: string[]): Promise<WorkspaceGraph> =>
      fetchPost(
        `${root}/sessions`,
        { session_ids: sessionIds },
        headers,
        options
      ),
    createContext: (
      body: Pick<ContextDocument, 'name' | 'content'> & { enabled?: boolean }
    ): Promise<ContextDocument> =>
      fetchPost(`${root}/contexts`, body, headers, options),
    updateContext: (
      id: string,
      body: Pick<ContextDocument, 'name' | 'content' | 'enabled'> & {
        expected_revision: number;
      }
    ): Promise<ContextDocument> =>
      fetchPut(`${root}/contexts/${encoded(id)}`, body, headers, options),
    deleteContext: (
      id: string,
      expectedRevision: number
    ): Promise<{ ok: boolean }> =>
      fetchDelete(
        `${root}/contexts/${encoded(id)}?expected_revision=${expectedRevision}`,
        undefined,
        headers,
        options
      ),
    move: (
      body: Omit<GraphPosition, 'revision'> & { expected_revision: number }
    ): Promise<GraphPosition> =>
      fetchPut(`${root}/positions`, body, headers, options),
    setAgentReferences: (
      projectId: string,
      agentId: string,
      body: Pick<AgentReferences, 'context_ids' | 'memory_ids'> & {
        expected_revision: number;
      }
    ): Promise<AgentReferences> =>
      fetchPut(
        `${root}/agents/${encoded(projectId)}/${encoded(agentId)}/references`,
        body,
        headers,
        options
      ),
    bindAutomation: (
      triggerId: string,
      body: Pick<AutomationBinding, 'project_id' | 'agent_id'> & {
        expected_revision: number;
      }
    ): Promise<AutomationBinding> =>
      fetchPut(
        `${root}/automations/${encoded(triggerId)}`,
        body,
        headers,
        options
      ),
    unbindAutomation: (
      triggerId: string,
      expectedRevision: number
    ): Promise<{ ok: boolean }> =>
      fetchDelete(
        `${root}/automations/${encoded(triggerId)}?expected_revision=${expectedRevision}`,
        undefined,
        headers,
        options
      ),
    getAutomationExecution: (
      triggerId: string,
      executionId: string
    ): Promise<AutomationInstantiation | null> =>
      fetchGet(
        `${root}/automations/${encoded(triggerId)}/executions/${encoded(executionId)}`,
        undefined,
        headers,
        options
      ),
    instantiateAutomation: (
      triggerId: string,
      body: {
        execution_id: string;
        project_id: string;
        expected_binding_revision?: number;
      }
    ): Promise<AutomationInstantiation> =>
      fetchPost(
        `${root}/automations/${encoded(triggerId)}/instantiate`,
        body,
        headers,
        options
      ),
  };
}
