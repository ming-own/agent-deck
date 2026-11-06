import { createHost } from '@/host/createHost';
import { getAccountEnvironmentKey } from '@/lib/authEnvironment';
import {
  fetchConfiguredProviders,
  selectableConfiguredModels,
  type ConfiguredModelChoice,
} from '@/lib/configuredModels';
import { getAuthStore } from '@/store/authStore';
import {
  formatTriggeredTaskMessage,
  type TriggeredTask,
} from '@/store/triggerTaskStore';
import { ExecutionStatus } from '@/types';
import {
  sessionAgentApi,
  type CanvasTrial,
  type SessionAgent,
  type SessionAgentRun,
} from './sessionAgentApi';
import { resolveNodeConnection } from './sessionAgentModels';
import {
  proxyCreateSpaceProject,
  proxyFetchSpaceProjects,
  type ServerProject,
} from './spaceApi';
import { proxyUpdateTriggerExecution } from './triggerApi';
import { workspaceGraphApi, type AutomationBinding } from './workspaceGraphApi';

interface AutomationOptions {
  accountKey: string;
  spaceId: string;
  name: string;
  onProject: (project: ServerProject) => void;
}

interface AutomationPreparation {
  accountKey: string;
  spaceId: string;
  name: string;
  task: TriggeredTask;
  binding?: AutomationBinding;
  failure?: string;
}

interface AdmissionState {
  bound: boolean;
  dispatchMayExist: boolean;
  projectId?: string;
  receipt?: AutomationRunReceipt;
  binding?: AutomationBinding;
}

interface AutomationRunReceipt {
  accountKey: string;
  executionId: string;
  triggerId: number;
  triggerName: string;
  projectId: string;
  agentId: string;
  requestId: string;
  kind: 'agent' | 'path';
  dispatched: boolean;
}

export interface WorkspaceAutomationResult {
  projectId: string;
  agentId: string;
  run: SessionAgentRun | CanvasTrial;
}

// This is a recovery index, not a second queue. Only non-secret identities are
// stored; the existing Agent run record remains the execution authority.
const RECEIPTS_KEY = 'agentdeck.workspace-automation-runs.v1';
const PREPARATIONS_KEY = 'agentdeck.workspace-automation-preparations.v1';
const inFlight = new Map<string, Promise<WorkspaceAutomationResult | null>>();
let reconciling: Promise<void> | undefined;

function assertAccount(accountKey: string) {
  if (getAccountEnvironmentKey(getAuthStore()) !== accountKey)
    throw new Error('Automation account changed before delivery');
}

function preparations(): AutomationPreparation[] {
  const value: unknown = JSON.parse(
    localStorage.getItem(PREPARATIONS_KEY) || '[]'
  );
  if (!Array.isArray(value))
    throw new Error('Invalid automation preparation receipts');
  return value.filter(
    (item): item is AutomationPreparation =>
      item &&
      typeof item.accountKey === 'string' &&
      typeof item.spaceId === 'string' &&
      typeof item.name === 'string' &&
      typeof item.task?.executionId === 'string' &&
      Number.isSafeInteger(item.task?.triggerId) &&
      typeof item.task?.taskPrompt === 'string'
  );
}

function rememberPreparation(task: TriggeredTask, options: AutomationOptions) {
  const records = preparations();
  if (
    records.some(
      (item) =>
        item.accountKey === options.accountKey &&
        item.task.executionId === task.executionId
    )
  )
    return;
  // Persist only the already formatted user message, not raw webhook headers
  // or a model connection. The first delivery's task text stays pinned.
  const headers = task.inputData?.headers;
  const safeTask =
    headers && typeof headers === 'object'
      ? {
          ...task,
          inputData: {
            ...task.inputData,
            headers: Object.fromEntries(
              Object.entries(headers).filter(
                ([name]) =>
                  !/authorization|cookie|api[-_]?key|token|secret/i.test(name)
              )
            ),
          },
        }
      : task;
  records.push({
    accountKey: options.accountKey,
    spaceId: options.spaceId,
    name: options.name,
    task: {
      id: task.id,
      executionId: task.executionId,
      triggerId: task.triggerId,
      triggerName: task.triggerName,
      projectId: task.projectId,
      spaceId: options.spaceId,
      triggerType: task.triggerType,
      timestamp: task.timestamp,
      taskPrompt: formatTriggeredTaskMessage(safeTask),
      inputData: {},
    },
  });
  localStorage.setItem(PREPARATIONS_KEY, JSON.stringify(records));
}

function forgetPreparation(accountKey: string, executionId: string) {
  localStorage.setItem(
    PREPARATIONS_KEY,
    JSON.stringify(
      preparations().filter(
        (item) =>
          item.accountKey !== accountKey ||
          item.task.executionId !== executionId
      )
    )
  );
}

function updatePreparation(
  accountKey: string,
  executionId: string,
  update: Partial<Pick<AutomationPreparation, 'binding' | 'failure'>>
) {
  const records = preparations().map((item) =>
    item.accountKey === accountKey && item.task.executionId === executionId
      ? { ...item, ...update }
      : item
  );
  // Failed deliveries need only a bounded tombstone against late duplicates.
  const failures = records.filter((item) => item.failure).slice(-500);
  localStorage.setItem(
    PREPARATIONS_KEY,
    JSON.stringify(records.filter((item) => !item.failure).concat(failures))
  );
}

function readReceipts(): AutomationRunReceipt[] {
  const value: unknown = JSON.parse(localStorage.getItem(RECEIPTS_KEY) || '[]');
  if (!Array.isArray(value)) throw new Error('Invalid automation run receipts');
  return value.filter(
    (item): item is AutomationRunReceipt =>
      item &&
      Number.isSafeInteger(item.triggerId) &&
      [
        'accountKey',
        'executionId',
        'triggerName',
        'projectId',
        'agentId',
        'requestId',
      ].every((key) => typeof item[key] === 'string' && item[key].length > 0)
  );
}

function saveReceipt(receipt: AutomationRunReceipt, remove = false) {
  const records = readReceipts().filter(
    (record) =>
      record.accountKey !== receipt.accountKey ||
      record.executionId !== receipt.executionId
  );
  if (!remove) records.push(receipt);
  localStorage.setItem(RECEIPTS_KEY, JSON.stringify(records));
}

/** Stable UUIDs make retry safe across remounts, restarts and delivery paths. */
async function executionIdentity(
  account: string,
  space: string,
  execution: string,
  kind: string
) {
  const bytes = new Uint8Array(
    await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(
        JSON.stringify([
          'workspace-automation-v1',
          account,
          space,
          execution,
          kind,
        ])
      )
    )
  ).slice(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x80;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) =>
    byte.toString(16).padStart(2, '0')
  ).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

async function connectedModels(
  nodes: SessionAgent[],
  account: string,
  email: string
): Promise<ConfiguredModelChoice[]> {
  assertAccount(account);
  const leaves = nodes.filter((node) => !node.workforce);
  const records = leaves.some((node) => node.model.id.startsWith('provider:'))
    ? await fetchConfiguredProviders()
    : [];
  assertAccount(account);
  let codexConnected = false;
  let codexModels: Parameters<
    typeof selectableConfiguredModels
  >[0]['codexModels'] = [];
  if (leaves.some((node) => node.model.id.startsWith('codex:'))) {
    const api = createHost().electronAPI;
    const status = await api?.codexSubscriptionStatus?.(email);
    assertAccount(account);
    codexConnected = Boolean(status?.connected);
    const inventory = codexConnected
      ? await api?.codexSubscriptionModels?.(email, false)
      : null;
    assertAccount(account);
    codexModels = inventory?.success ? inventory.models : [];
  }
  return selectableConfiguredModels({
    records,
    cloudModels: [],
    hidden: [],
    cloudAvailable: false,
    codexConnected,
    codexModels,
  });
}

function linearPath(nodes: SessionAgent[], first: string): SessionAgent[] {
  const path: SessionAgent[] = [];
  let id = first;
  while (id) {
    const node = nodes.find((item) => item.id === id);
    if (
      !node ||
      path.some((item) => item.id === id) ||
      path.length >= 32 ||
      (node.outputs?.length ?? 0) > 1
    )
      throw new Error(
        'Automation requires an available linear path without branches or cycles'
      );
    path.push(node);
    id = node.outputs?.[0] || '';
  }
  return path;
}

async function reportRun(
  receipt: AutomationRunReceipt,
  run: SessionAgentRun | CanvasTrial
) {
  assertAccount(receipt.accountKey);
  const error =
    'steps' in run ? run.steps.find((step) => step.error)?.error : run.error;
  const output = 'steps' in run ? run.steps.at(-1)?.output || '' : run.output;
  const status =
    run.status === 'completed'
      ? ExecutionStatus.Completed
      : run.status === 'failed'
        ? ExecutionStatus.Failed
        : run.status === 'interrupted'
          ? error === 'cancelled'
            ? ExecutionStatus.Cancelled
            : ExecutionStatus.Failed
          : ExecutionStatus.Running;
  await proxyUpdateTriggerExecution(
    receipt.executionId,
    {
      status,
      ...(status === ExecutionStatus.Running
        ? {}
        : {
            completed_at:
              ('finished_at' in run && run.finished_at) ||
              new Date().toISOString(),
            output_data: {
              project_id: receipt.projectId,
              agent_id: receipt.agentId,
              run_id: run.id,
              output,
            },
            ...(error ? { error_message: error } : {}),
          }),
    },
    {
      triggerId: receipt.triggerId,
      triggerName: receipt.triggerName,
      projectId: receipt.projectId,
    },
    receipt.accountKey
  );
  assertAccount(receipt.accountKey);
  if (status !== ExecutionStatus.Running) saveReceipt(receipt, true);
}

/**
 * Run now and websocket delivery use the same entry point. A null result is an
 * explicitly unbound Automation; lookup/clone/model errors must never silently
 * fall through to a different Agent or to the legacy chat execution path.
 */
export function executeWorkspaceAutomation(
  task: TriggeredTask,
  options: AutomationOptions
): Promise<WorkspaceAutomationResult | null> {
  const key = JSON.stringify([
    options.accountKey,
    options.spaceId,
    task.executionId,
  ]);
  const pending = inFlight.get(key);
  if (pending) return pending;
  const admission: AdmissionState = { bound: false, dispatchMayExist: false };
  const promise = (async () => {
    assertAccount(options.accountKey);
    rememberPreparation(task, options);
    const pinned = preparations().find(
      (item) =>
        item.accountKey === options.accountKey &&
        item.task.executionId === task.executionId
    )!;
    if (pinned.failure) throw new Error(pinned.failure);
    admission.binding = pinned.binding;
    admission.bound = Boolean(pinned.binding);
    try {
      const result = await execute(
        pinned.task,
        { ...options, name: pinned.name },
        admission
      );
      assertAccount(options.accountKey);
      forgetPreparation(options.accountKey, task.executionId);
      return result;
    } catch (error) {
      if (
        getAccountEnvironmentKey(getAuthStore()) === options.accountKey &&
        admission.bound &&
        !admission.dispatchMayExist
      ) {
        const failure =
          error instanceof Error
            ? error.message
            : 'Automation preparation failed';
        updatePreparation(options.accountKey, task.executionId, { failure });
        try {
          await proxyUpdateTriggerExecution(
            task.executionId,
            {
              status: ExecutionStatus.Failed,
              completed_at: new Date().toISOString(),
              error_message: failure,
            },
            {
              triggerId: task.triggerId,
              triggerName: task.triggerName,
              projectId: admission.projectId,
            },
            options.accountKey
          );
        } catch {
          // The existing terminal outbox persists this outcome before delivery.
        }
        assertAccount(options.accountKey);
        if (admission.receipt) saveReceipt(admission.receipt, true);
      }
      throw error;
    }
  })().finally(() => {
    if (inFlight.get(key) === promise) inFlight.delete(key);
  });
  inFlight.set(key, promise);
  return promise;
}

async function execute(
  task: TriggeredTask,
  options: AutomationOptions,
  admission: AdmissionState
): Promise<WorkspaceAutomationResult | null> {
  const { accountKey, spaceId } = options;
  assertAccount(accountKey);
  if (!task.executionId || (task.spaceId && task.spaceId !== spaceId))
    throw new Error('Automation execution scope is invalid');
  const email = getAuthStore().email;
  const graphApi = workspaceGraphApi(accountKey, spaceId);
  // Recover first: unbinding or editing a template cannot reroute a retry.
  let instance = await graphApi.getAutomationExecution(
    String(task.triggerId),
    task.executionId
  );
  assertAccount(accountKey);
  let binding;
  if (instance) {
    admission.bound = true;
    admission.dispatchMayExist = true;
  }
  if (!instance) {
    const graph = await graphApi.get();
    assertAccount(accountKey);
    if (graph.space_id !== spaceId)
      throw new Error('Automation workspace changed');
    binding = graph.automation_bindings.find(
      (item) => item.trigger_id === String(task.triggerId)
    );
    if (!binding) {
      if (admission.binding)
        throw new Error('Automation source changed during preparation');
      return null;
    }
    admission.bound = true;
    if (
      admission.binding &&
      (admission.binding.revision !== binding.revision ||
        admission.binding.agent_id !== binding.agent_id ||
        admission.binding.project_id !== binding.project_id)
    )
      throw new Error('Automation source changed during preparation');
    updatePreparation(accountKey, task.executionId, { binding });
    const sourceNodes = await sessionAgentApi(
      accountKey,
      binding.project_id
    ).list();
    assertAccount(accountKey);
    // Reject unsupported graph shapes before creating even an empty Session.
    linearPath(sourceNodes, binding.agent_id);
  }
  const projectId =
    instance?.project_id ??
    (await executionIdentity(accountKey, spaceId, task.executionId, 'session'));
  const requestId = await executionIdentity(
    accountKey,
    spaceId,
    task.executionId,
    'run'
  );
  admission.projectId = projectId;
  assertAccount(accountKey);
  const projects = await proxyFetchSpaceProjects(spaceId);
  assertAccount(accountKey);
  let project = projects.find((item) => item.id === projectId);
  if (project) {
    const source = project.metadata?.workspaceAutomation as
      | {
          executionId?: string;
          triggerId?: number;
          sourceProjectId?: string;
          sourceAgentId?: string;
        }
      | undefined;
    if (
      project.space_id !== spaceId ||
      source?.executionId !== task.executionId ||
      source?.triggerId !== task.triggerId
    )
      throw new Error('Automation session belongs to a different execution');
    if (
      !instance &&
      binding &&
      (source.sourceProjectId !== binding.project_id ||
        source.sourceAgentId !== binding.agent_id)
    )
      throw new Error('Automation source changed during preparation');
    if (project.status === 'archived')
      throw new Error('Automation session is archived');
  } else {
    if (instance || !binding)
      throw new Error('Automation session is unavailable');
    project = await proxyCreateSpaceProject(
      spaceId,
      {
        id: projectId,
        name: options.name,
        metadata: {
          agentSession: true,
          spaceModelDefaultPending: false,
          workspaceAutomation: {
            triggerId: task.triggerId,
            executionId: task.executionId,
            sourceProjectId: binding.project_id,
            sourceAgentId: binding.agent_id,
          },
        },
      },
      { expectedAccountKey: accountKey }
    );
    assertAccount(accountKey);
    if (project.id !== projectId || project.space_id !== spaceId)
      throw new Error('Automation session creation returned a different scope');
  }
  options.onProject(project);
  if (!instance) {
    instance = await graphApi.instantiateAutomation(String(task.triggerId), {
      execution_id: task.executionId,
      project_id: projectId,
      expected_binding_revision: binding!.revision,
    });
    assertAccount(accountKey);
  }
  if (instance.project_id !== projectId)
    throw new Error('Automation target session changed');
  const api = sessionAgentApi(accountKey, projectId);
  const receipt: AutomationRunReceipt = {
    accountKey,
    projectId,
    requestId,
    agentId: instance.agent.id,
    triggerId: task.triggerId,
    triggerName: task.triggerName,
    executionId: task.executionId,
    kind: (instance.execution_path?.length ?? 1) > 1 ? 'path' : 'agent',
    dispatched: false,
  };
  admission.receipt = receipt;
  const hadReceipt = readReceipts().some(
    (item) =>
      item.accountKey === accountKey &&
      item.executionId === task.executionId &&
      item.dispatched !== false
  );
  receipt.dispatched = hadReceipt;
  saveReceipt(receipt);
  const existing =
    receipt.kind === 'path'
      ? await api.trial(requestId)
      : (await api.runs(instance.agent.id, 'default')).find(
          (run) => run.request_id === requestId
        );
  assertAccount(accountKey);
  if (existing) {
    admission.dispatchMayExist = true;
    receipt.dispatched = true;
    saveReceipt(receipt);
    await reportRun(receipt, existing);
    return { projectId, agentId: instance.agent.id, run: existing };
  }
  admission.dispatchMayExist = hadReceipt;
  const nodes = await api.list();
  assertAccount(accountKey);
  const node = nodes.find((item) => item.id === instance.agent.id);
  if (!node || node.revision !== instance.agent.revision)
    throw new Error('Automation target changed before execution');
  if (!email) throw new Error('Automation account is unavailable');
  const choices = await connectedModels(nodes, accountKey, email);
  assertAccount(accountKey);
  const path = linearPath(nodes, node.id);
  const expectedPath = instance.execution_path ?? [node.id];
  if (
    path.length !== expectedPath.length ||
    path.some((item, index) => item.id !== expectedPath[index])
  )
    throw new Error('Automation path changed before execution');
  const settings = Object.fromEntries(
    path.map((item) => [
      item.id,
      {
        expected_revision: item.revision,
        approved_tools: [],
        email,
        connection: resolveNodeConnection(item, choices, nodes, email),
      },
    ])
  );
  // Store only references before dispatch so an uncertain response can be
  // reconciled after restart. Credentials exist only in this request body.
  receipt.dispatched = true;
  saveReceipt(receipt);
  admission.dispatchMayExist = true;
  let run: SessionAgentRun | CanvasTrial;
  try {
    run =
      receipt.kind === 'path'
        ? await api.startTrial({
            id: requestId,
            path: path.map((item) => item.id),
            prompt: formatTriggeredTaskMessage(task),
            settings,
          })
        : await api.start(node.id, {
            task_id: 'default',
            request_id: requestId,
            queue_if_busy: true,
            expected_revision: node.revision,
            approved_tools: [],
            prompt: formatTriggeredTaskMessage(task),
            connection: settings[node.id].connection,
            email,
          });
  } catch (error) {
    const status = (error as { status?: number })?.status;
    if (
      status &&
      status >= 400 &&
      status < 500 &&
      ![408, 429].includes(status)
    ) {
      try {
        // A 409 may be a rejected configuration or a concurrent retry whose
        // response was lost. Establish which using the exact durable identity.
        const observed =
          receipt.kind === 'path'
            ? await api.trial(requestId)
            : (await api.runs(node.id, 'default')).find(
                (item) => item.request_id === requestId
              );
        assertAccount(accountKey);
        if (observed) {
          await reportRun(receipt, observed);
          return { projectId, agentId: node.id, run: observed };
        }
        admission.dispatchMayExist = false;
        receipt.dispatched = false;
      } catch {
        // Failed recovery lookup is uncertainty, never proof of rejection.
      }
    }
    throw error;
  }
  assertAccount(accountKey);
  await reportRun(receipt, run);
  return { projectId, agentId: node.id, run };
}

/** Resume pinned preparations and poll admitted runs under the original account. */
export function reconcileWorkspaceAutomationExecutions(
  onProject: (project: ServerProject) => void = () => {},
  onUnbound: (task: TriggeredTask) => Promise<void> = async () => {}
): Promise<void> {
  if (reconciling) return reconciling;
  const account = getAccountEnvironmentKey(getAuthStore());
  reconciling = (async () => {
    for (const prepared of preparations().filter(
      (item) => item.accountKey === account && !item.failure
    )) {
      assertAccount(account);
      if (
        inFlight.has(
          JSON.stringify([account, prepared.spaceId, prepared.task.executionId])
        )
      )
        continue;
      try {
        const result = await executeWorkspaceAutomation(prepared.task, {
          accountKey: account,
          spaceId: prepared.spaceId,
          name: prepared.name,
          onProject,
        });
        assertAccount(account);
        if (!result) await onUnbound(prepared.task);
      } catch {
        // Definite failures use the terminal outbox. Uncertain deliveries retain
        // their immutable preparation and retry the same request identity.
      }
    }
    for (const receipt of readReceipts().filter(
      (record) => record.accountKey === account
    )) {
      assertAccount(account);
      try {
        const api = sessionAgentApi(account, receipt.projectId);
        const run =
          receipt.kind === 'path'
            ? await api.trial(receipt.requestId)
            : (await api.runs(receipt.agentId, 'default')).find(
                (item) => item.request_id === receipt.requestId
              );
        assertAccount(account);
        if (run) await reportRun(receipt, run);
      } catch {
        // A temporary outage cannot turn an uncertain dispatch into a second
        // inference or a false failure. Keep its receipt for the next pass.
      }
    }
  })().finally(() => {
    reconciling = undefined;
  });
  return reconciling;
}
