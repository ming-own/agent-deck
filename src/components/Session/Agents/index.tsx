import { MarkDown } from '@/components/ChatBox/MessageItem/MarkDown';
import { UserMessageCard } from '@/components/ChatBox/MessageItem/UserMessageCard';
import ContentHeader from '@/components/Layout/ContentHeader';
import { Button } from '@/components/ui/button';
import { DsIcon } from '@/components/ui/ds-icon';
import { DsText } from '@/components/ui/ds-text';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { useConfiguredModels } from '@/hooks/useConfiguredModels';
import { getAccountEnvironmentKey } from '@/lib/authEnvironment';
import {
  selectableConfiguredModels,
  type ConfiguredModelChoice,
} from '@/lib/configuredModels';
import {
  sessionAgentApi,
  type AgentBehavior,
  type AgentToolId,
  type AgentToolPolicy,
  type SessionAgent,
  type SessionAgentRun,
} from '@/service/sessionAgentApi';
import {
  modelReference,
  resolveNodeConnection,
} from '@/service/sessionAgentModels';
import { useAuthStore } from '@/store/authStore';
import {
  ArrowUp,
  Bot,
  ChevronDown,
  Forward,
  LayoutGrid,
  ListChecks,
  MessageSquare,
  Plus,
  RotateCw,
  Settings2,
  Square,
} from 'lucide-react';
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useTranslation } from 'react-i18next';
import { AgentCanvas } from './AgentCanvas';
import { AgentTasks } from './AgentTasks';
import { AnswerHandoff, AnswerReference } from './AnswerHandoff';
import { markSessionAgents } from './Launcher';
import { NodeInspector } from './NodeInspector';
import { SkillPicker } from './SkillPicker';
import { TaskRouter, type RouterLocation } from './TaskRouter';
import { ToolPermissions, TurnTools, nodeTools } from './ToolPermissions';
import { WorkforceDetails } from './WorkforceDetails';
import { Workshop } from './Workshop';

const harnessLabels: Record<string, string> = {
  standard: 'chat.node-harness-standard',
  plan_execute: 'chat.node-harness-plan-execute',
};

export function SessionAgents({ projectId }: { projectId: string }) {
  const auth = useAuthStore();
  const account = getAccountEnvironmentKey(auth);
  // Remount every account/Session boundary: pending results never enter another scope.
  return (
    <AgentInstances
      key={`${account}:${projectId}`}
      account={account}
      projectId={projectId}
      email={auth.email ?? ''}
    />
  );
}

function AgentInstances({
  account,
  projectId,
  email,
}: {
  account: string;
  projectId: string;
  email: string;
}) {
  const { t } = useTranslation();
  const api = useMemo(
    () => sessionAgentApi(account, projectId),
    [account, projectId]
  );
  const inventory = useConfiguredModels();
  const choices = selectableConfiguredModels(inventory);
  const [nodes, setNodes] = useState<SessionAgent[]>([]);
  const [destination, setDestination] = useState<{
    agentId: string;
    taskId: string;
  } | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const modeKey =
    'agentdeck:agent-view:' + JSON.stringify([account, projectId]);
  const [canvas, setCanvas] = useState(() => {
    try {
      return localStorage.getItem(modeKey) === 'canvas';
    } catch {
      return false;
    }
  });
  const [taskEpoch, setTaskEpoch] = useState(0);
  const [router, setRouter] = useState<RouterLocation | null>(null);
  const openCanvasRouter = useCallback(
    (
      project: string,
      name: string,
      agents: SessionAgent[],
      opener: HTMLButtonElement
    ) => setRouter({ project, name, agents, opener }),
    []
  );
  const [canvasEpoch, setCanvasEpoch] = useState(0);
  const [editor, setEditor] = useState<{
    project: string;
    node?: SessionAgent;
  } | null>(null);
  const [workshop, setWorkshop] = useState<{
    project: string;
    node?: SessionAgent;
  } | null>(null);
  const [team, setTeam] = useState<{
    project: string;
    node: SessionAgent;
  } | null>(null);
  const workshopApi = useMemo(
    () => sessionAgentApi(account, workshop?.project ?? projectId),
    [account, workshop?.project, projectId]
  );
  const teamApi = useMemo(
    () => sessionAgentApi(account, team?.project ?? projectId),
    [account, team?.project, projectId]
  );
  const editorProject = editor?.project ?? projectId;
  const editorApi = useMemo(
    () => sessionAgentApi(account, editorProject),
    [account, editorProject]
  );
  const opener = useRef<HTMLButtonElement | null>(null);
  const alive = useRef(true);
  const refreshSequence = useRef(0);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const refresh = useCallback(async () => {
    const sequence = ++refreshSequence.current;
    try {
      const result = await api.list();
      if (!alive.current || sequence !== refreshSequence.current) return;
      setNodes(result);
      setError(false);
      setSelected((previous) =>
        result.some((node) => node.id === previous)
          ? previous
          : (result[0]?.id ?? null)
      );
    } catch {
      if (alive.current) setError(true);
    } finally {
      if (alive.current) setLoading(false);
    }
  }, [api]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  const openEditor = useCallback(
    (project: string, button: HTMLButtonElement, node?: SessionAgent) => {
      opener.current = button;
      if (node?.workforce) setTeam({ project, node });
      else setEditor({ project, node });
    },
    []
  );
  const editCanvasNode = useCallback(
    (project: string, button: HTMLButtonElement, item?: SessionAgent) => {
      setTeam(null);
      setEditor(null);
      openEditor(project, button, item);
    },
    [openEditor]
  );
  const saveEditor = async (
    name: string,
    choice: ConfiguredModelChoice,
    behavior: AgentBehavior
  ) => {
    if (!editor) return;
    if (!editor.node && editor.project !== projectId)
      await markSessionAgents(editor.project, account, 'canvasAgents');
    const updated = editor.node
      ? await editorApi.update(
          editor.node,
          name,
          modelReference(choice),
          behavior
        )
      : await editorApi.create(name, modelReference(choice), behavior);
    if (!alive.current) return;
    if (editor.project === projectId) {
      refreshSequence.current++;
      setNodes((old) =>
        editor.node
          ? old.map((item) => (item.id === updated.id ? updated : item))
          : [...old, updated]
      );
      setSelected((current) => (canvas ? (current ?? updated.id) : updated.id));
    }
    setCanvasEpoch((v) => v + 1);
    setEditor(null);
  };
  const node = nodes.find((item) => item.id === selected);
  return (
    <section
      aria-label={t('chat.session-agents-title')}
      className="relative flex min-h-0 min-w-0 flex-1 flex-col bg-ds-neutral-subtle-default"
    >
      <ContentHeader
        leading={
          <DsIcon
            icon={canvas ? LayoutGrid : Bot}
            className="text-ds-ink-muted-default"
          />
        }
        title={
          canvas
            ? t('chat.canvas-title')
            : !node
              ? t('chat.session-agents-title')
              : undefined
        }
        actions={
          <>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setWorkshop({ project: projectId })}
            >
              {t('chat.workshop')}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              aria-pressed={canvas}
              onClick={() => {
                const next = !canvas;
                setCanvas(next);
                try {
                  localStorage.setItem(modeKey, next ? 'canvas' : 'chat');
                } catch {
                  /* optional view preference */
                }
              }}
            >
              <DsIcon icon={canvas ? MessageSquare : LayoutGrid} />
              {t(canvas ? 'chat.canvas-chat' : 'chat.canvas-title')}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              buttonContent="icon-only"
              aria-label={t('chat.session-agents-retry')}
              title={t('chat.session-agents-retry')}
              onClick={() => {
                void refresh();
                setCanvasEpoch((v) => v + 1);
              }}
            >
              <DsIcon icon={RotateCw} />
            </Button>
            {node && !canvas && (
              <Button
                size="sm"
                variant="ghost"
                buttonContent="icon-only"
                aria-label={t('chat.session-agents-edit')}
                title={t('chat.session-agents-edit')}
                onClick={(e) => {
                  openEditor(projectId, e.currentTarget, node);
                }}
              >
                <DsIcon icon={Settings2} />
              </Button>
            )}
            {!canvas && (
              <Button
                size="sm"
                variant="secondary"
                disabled={loading}
                onClick={(e) => {
                  openEditor(projectId, e.currentTarget);
                }}
              >
                <DsIcon icon={Plus} />
                {t('chat.session-agents-add')}
              </Button>
            )}
          </>
        }
      >
        {node && !canvas && (
          <Select
            value={node.id}
            onValueChange={(id) => {
              setDestination(null);
              setSelected(id);
            }}
          >
            <SelectTrigger
              aria-label={t('chat.session-agents-select')}
              size="xs"
              variant="secondary"
              wrapperClassName="min-w-0"
              className="max-w-full"
            >
              <SelectValue>{node.name}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {nodes.map((item) => (
                <SelectItem key={item.id} value={item.id}>
                  {item.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </ContentHeader>
      {loading && (
        <DsText role="base" aria-live="polite">
          {t('chat.session-agents-loading')}
        </DsText>
      )}
      {error && (
        <div role="alert">
          <DsText role="base">{t('chat.session-agents-load-error')}</DsText>
          <Button variant="text" onClick={() => void refresh()}>
            {t('chat.session-agents-retry')}
          </Button>
        </div>
      )}
      {inventory.error || inventory.codexModelsError ? (
        <div role="alert">
          <DsText role="base">{t('chat.session-agents-model-error')}</DsText>
          <Button
            variant="text"
            onClick={() => {
              void inventory.refresh();
              void inventory.refreshCodexModels();
            }}
          >
            {t('chat.session-agents-retry')}
          </Button>
        </div>
      ) : null}
      {team && (
        <WorkforceDetails
          docked={canvas}
          key={team.node.id}
          node={team.node}
          api={teamApi}
          choices={choices}
          epoch={canvasEpoch}
          email={email}
          close={() => setTeam(null)}
          edit={(child, button) => openEditor(team.project, button, child)}
          updated={(next) => {
            setTeam({ ...team, node: next });
            setCanvasEpoch((n) => n + 1);
            if (team.project === projectId) void refresh();
          }}
          save={() => setWorkshop(team)}
        />
      )}
      {workshop && (
        <Workshop
          key={workshop.project}
          api={workshopApi}
          projectId={workshop.project}
          choices={choices}
          initialNode={workshop.node}
          onClose={() => setWorkshop(null)}
          beforeInstall={async () => {
            if (workshop.project !== projectId)
              await markSessionAgents(
                workshop.project,
                account,
                'canvasAgents'
              );
          }}
          onInstalled={(installed) => {
            if (workshop.project === projectId) {
              void refresh().then(() => setSelected(installed.id));
            }
            setCanvasEpoch((v) => v + 1);
            setTaskEpoch((v) => v + 1);
          }}
        />
      )}
      {editor && (
        <AgentForm
          docked={canvas}
          conversation={
            canvas && editor.node ? (
              <CanvasNodeTasks
                key={editor.node.id}
                node={editor.node}
                api={editorApi}
                choices={choices}
                email={email}
                account={account}
                project={editor.project}
                modelsLoading={
                  inventory.loading || inventory.codexModelsLoading
                }
                openRouter={setRouter}
              />
            ) : undefined
          }
          key={editor.node ? `edit-${editor.node.id}` : 'create'}
          node={editor.node}
          loadSkills={editorApi.skills}
          choices={choices}
          restoreFocus={() => opener.current?.focus()}
          onCancel={() => setEditor(null)}
          onSave={saveEditor}
        />
      )}
      {router && (
        <TaskRouter
          openWorkshop={() => {
            setWorkshop({ project: router.project });
            setRouter(null);
          }}
          location={router}
          onTaskCreated={() => setTaskEpoch((n) => n + 1)}
          account={account}
          choices={choices}
          email={email}
          close={() => setRouter(null)}
        />
      )}
      {canvas && (
        <AgentCanvas
          choices={choices}
          email={email}
          openRouter={openCanvasRouter}
          account={account}
          projectId={projectId}
          refreshKey={canvasEpoch}
          edit={editCanvasNode}
        />
      )}
      {!canvas && !loading && !error && !nodes.length && (
        <div className="flex flex-1 flex-col items-center justify-center gap-ds-stack-related p-ds-panel-inset text-center">
          <DsIcon
            icon={Bot}
            recipe="illustration"
            illustrationSize={32}
            className="text-ds-ink-muted-default"
          />
          <DsText role="body-large">{t('chat.session-agents-empty')}</DsText>
        </div>
      )}
      {node && (
        <div className={canvas ? 'hidden' : 'contents'}>
          <AgentTasks
            key={node.id}
            agentId={node.id}
            refreshKey={taskEpoch}
            openRouter={(taskId, name, opener) =>
              setRouter({
                project: projectId,
                name: node.name + ' / ' + name,
                agents: nodes,
                origin: { agentId: node.id, taskId },
                opener,
              })
            }
            initialTaskId={
              destination?.agentId === node.id ? destination.taskId : undefined
            }
            api={api}
            storageKey={
              'agentdeck:agent-task:' +
              JSON.stringify([account, projectId, node.id])
            }
          >
            {(taskId) => (
              <AgentConversation
                key={taskId}
                taskId={taskId}
                targets={nodes.filter((other) => other.id !== node.id)}
                delivered={(agentId, taskId) => {
                  setDestination({ agentId, taskId });
                  setSelected(agentId);
                }}
                node={node}
                choices={choices}
                modelsLoading={
                  inventory.loading || inventory.codexModelsLoading
                }
                api={api}
                email={email}
              />
            )}
          </AgentTasks>
        </div>
      )}
    </section>
  );
}

function CanvasNodeTasks({
  node,
  api,
  choices,
  email,
  account,
  project,
  modelsLoading,
  openRouter,
}: {
  node: SessionAgent;
  api: ReturnType<typeof sessionAgentApi>;
  choices: ConfiguredModelChoice[];
  email: string;
  account: string;
  project: string;
  modelsLoading: boolean;
  openRouter: (r: RouterLocation) => void;
}) {
  const { t } = useTranslation();
  const [all, setAll] = useState<SessionAgent[]>([]),
    [failed, setFailed] = useState(false),
    [epoch, retry] = useState(0);
  useEffect(() => {
    let live = true;
    api
      .list()
      .then((rows) => {
        if (live) {
          setAll(rows);
          setFailed(false);
        }
      })
      .catch(() => {
        if (live) setFailed(true);
      });
    return () => {
      live = false;
    };
  }, [api, epoch]);
  const current = all.find((n) => n.id === node.id);
  if (failed)
    return (
      <Button size="sm" variant="text" onClick={() => retry((v) => v + 1)}>
        {t('chat.session-agents-load-error')} · {t('chat.session-agents-retry')}
      </Button>
    );
  if (!current)
    return <DsText role="base">{t('chat.session-agents-loading')}</DsText>;
  return (
    <AgentTasks
      key={current.id}
      agentId={current.id}
      api={api}
      storageKey={
        'agentdeck:agent-task:' + JSON.stringify([account, project, current.id])
      }
      refreshKey={epoch}
      openRouter={(taskId, name, opener) =>
        openRouter({
          project,
          name: current.name + ' / ' + name,
          agents: all,
          origin: { agentId: current.id, taskId },
          opener,
        })
      }
    >
      {(taskId) => (
        <AgentConversation
          key={taskId}
          taskId={taskId}
          node={current}
          targets={all.filter((n) => n.id !== current.id)}
          choices={choices}
          modelsLoading={modelsLoading}
          api={api}
          email={email}
          delivered={() => retry((v) => v + 1)}
        />
      )}
    </AgentTasks>
  );
}

function AgentForm({
  docked,
  conversation,
  restoreFocus,
  loadSkills,
  node,
  choices,
  onSave,
  onCancel,
}: {
  docked?: boolean;
  conversation?: ReactNode;
  restoreFocus: () => void;
  node?: SessionAgent;
  loadSkills: ReturnType<typeof sessionAgentApi>['skills'];
  choices: ConfiguredModelChoice[];
  onSave: (
    name: string,
    choice: ConfiguredModelChoice,
    behavior: AgentBehavior
  ) => Promise<void>;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const [view, setView] = useState('general');
  const [harnessId, setHarnessId] = useState(node?.harness_id ?? 'standard');
  const [name, setName] = useState(node?.name ?? '');
  const [model, setModel] = useState(node?.model.id ?? '');
  const [role, setRole] = useState(node?.role ?? '');
  const [instructions, setInstructions] = useState(node?.instructions ?? '');
  const [toolPolicy, setToolPolicy] = useState<AgentToolPolicy>(
    node?.tool_policy ?? {}
  );
  const [skillIds, setSkillIds] = useState(node?.skill_ids ?? []);
  const helpId = useId();
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const savingRef = useRef(false);
  const choice = choices.find((item) => item.id === model);
  return (
    <NodeInspector
      docked={docked}
      title={
        docked && node
          ? node.name
          : t(node ? 'chat.session-agents-edit' : 'chat.session-agents-add')
      }
      subtitle={docked && node ? node.model.name : undefined}
      busy={saving}
      close={onCancel}
      restoreFocus={restoreFocus}
    >
      <Tabs
        value={view}
        onValueChange={setView}
        className="flex min-h-0 flex-1 flex-col"
      >
        <div className="shrink-0 px-ds-panel-inset">
          <TabsList
            appearance={docked ? 'border' : 'outline'}
            aria-label={t(
              node ? 'chat.session-agents-edit' : 'chat.session-agents-add'
            )}
          >
            {conversation && (
              <TabsTrigger value="conversation">
                {t('chat.canvas-chat')}
              </TabsTrigger>
            )}
            <TabsTrigger value="general">{t('layout.general')}</TabsTrigger>
            <TabsTrigger value="capabilities">
              {t('layout.capabilities')}
            </TabsTrigger>
          </TabsList>
        </div>
        {conversation && (
          <TabsContent
            value="conversation"
            className="m-0 flex min-h-0 flex-1 flex-col data-[state=inactive]:hidden"
          >
            {conversation}
          </TabsContent>
        )}
        {view !== 'conversation' && (
          <form
            className="flex min-h-0 flex-col"
            onSubmit={async (event) => {
              event.preventDefault();
              if (!choice || !name.trim() || savingRef.current) return;
              savingRef.current = true;
              setSaving(true);
              setFailed(false);
              try {
                await onSave(name.trim(), choice, {
                  harness_id: harnessId,
                  tool_policy: toolPolicy,
                  skill_ids: skillIds,
                  role: role.trim(),
                  instructions: instructions.trim(),
                });
              } catch {
                setFailed(true);
              } finally {
                savingRef.current = false;
                setSaving(false);
              }
            }}
          >
            <div className="scrollbar-always-visible min-h-0 overflow-y-auto p-ds-panel-inset">
              <TabsContent value="general" className="m-0">
                <Input
                  title={t('chat.session-agents-name')}
                  aria-label={t('chat.session-agents-name')}
                  value={name}
                  maxLength={100}
                  onChange={(event) => setName(event.target.value)}
                  disabled={saving}
                />
                <div
                  className={
                    docked
                      ? 'grid grid-cols-1 gap-ds-control-gap'
                      : 'grid grid-cols-1 gap-ds-control-gap sm:grid-cols-2'
                  }
                >
                  <Select
                    value={model}
                    onValueChange={setModel}
                    disabled={saving || !choices.length}
                  >
                    <SelectTrigger
                      title={t('chat.session-agents-model')}
                      aria-label={t('chat.session-agents-model')}
                      wrapperClassName="w-full"
                    >
                      <SelectValue
                        placeholder={t('chat.session-agents-select-model')}
                      />
                    </SelectTrigger>
                    <SelectContent fitTrigger>
                      {choices.map((item) => (
                        <SelectItem key={item.id} value={item.id}>
                          {item.name} · {item.group}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select
                    value={harnessId}
                    onValueChange={setHarnessId}
                    disabled={saving}
                  >
                    <SelectTrigger
                      title={t('chat.node-harness')}
                      aria-label={t('chat.node-harness')}
                      wrapperClassName="w-full"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent fitTrigger>
                      {Object.entries(harnessLabels).map(([id, label]) => (
                        <SelectItem key={id} value={id}>
                          {t(label)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {!choices.length && (
                  <DsText role="base">
                    {t('chat.session-agents-no-models')}
                  </DsText>
                )}
                <Input
                  title={t('chat.session-agents-role-label')}
                  aria-label={t('chat.session-agents-role-label')}
                  placeholder={t('chat.session-agents-role-placeholder')}
                  value={role}
                  maxLength={200}
                  onChange={(event) => setRole(event.target.value)}
                  disabled={saving}
                />
                <Textarea
                  variant="outlined"
                  title={t('chat.session-agents-instructions-label')}
                  aria-label={t('chat.session-agents-instructions-label')}
                  aria-describedby={helpId}
                  placeholder={t(
                    'chat.session-agents-instructions-placeholder'
                  )}
                  value={instructions}
                  rows={3}
                  maxLength={12000}
                  onChange={(event) => setInstructions(event.target.value)}
                  disabled={saving}
                />
                <DsText
                  as="p"
                  id={helpId}
                  role="meta"
                  className="text-ds-ink-muted-default"
                >
                  {t('chat.session-agents-instructions-help')}
                </DsText>
              </TabsContent>
              <TabsContent value="capabilities" className="m-0">
                <SkillPicker
                  load={loadSkills}
                  selected={skillIds}
                  onChange={setSkillIds}
                  disabled={saving}
                />
                <ToolPermissions
                  policy={toolPolicy}
                  onChange={setToolPolicy}
                  disabled={saving}
                />
              </TabsContent>
            </div>
            {failed && (
              <DsText role="base" aria-live="assertive">
                {t('chat.session-agents-save-error')}
              </DsText>
            )}
            <div className="flex shrink-0 items-center justify-end gap-ds-control-gap border-x-0 border-t border-b-0 border-solid border-ds-hairline-subtle-default px-ds-panel-inset py-ds-12">
              <Button
                type="button"
                variant="ghost"
                disabled={saving}
                onClick={onCancel}
              >
                {t('chat.session-agents-cancel')}
              </Button>
              <Button
                type="submit"
                disabled={!name.trim() || !choice || saving}
              >
                {t('chat.session-agents-save')}
              </Button>
            </div>
          </form>
        )}
      </Tabs>
    </NodeInspector>
  );
}

function AgentBehaviorDetails({
  agent,
  label,
  action,
}: {
  action?: ReactNode;
  agent: SessionAgentRun['agent'];
  label: string;
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const detailsId = useId();
  return (
    <div className="flex min-w-0 flex-col items-start gap-ds-stack-related">
      <div className="flex flex-wrap items-center gap-ds-control-gap">
        <Button
          variant="ghost"
          size="xs"
          aria-expanded={expanded}
          aria-controls={detailsId}
          onClick={() => setExpanded(!expanded)}
        >
          <DsIcon icon={Settings2} recipe="main-compact" />
          {label}
          <DsIcon
            icon={ChevronDown}
            recipe="main-compact"
            className={expanded ? 'rotate-180' : undefined}
          />
        </Button>
        {action}
      </div>
      <div id={detailsId} hidden={!expanded} className="w-full min-w-0">
        <dl className="grid gap-ds-12 rounded-ds-field bg-ds-neutral-muted-default p-ds-panel-inset sm:grid-cols-2">
          <div>
            <DsText as="dt" role="meta" className="text-ds-ink-muted-default">
              {t('chat.node-harness')}
            </DsText>
            <DsText as="dd" role="base">
              {agent.harness_id
                ? harnessLabels[agent.harness_id]
                  ? t(harnessLabels[agent.harness_id])
                  : agent.harness_id
                : t('chat.node-harness-unrecorded')}
              {agent.harness_version && ` · v${agent.harness_version}`}
            </DsText>
          </div>
          <div>
            <DsText as="dt" role="meta" className="text-ds-ink-muted-default">
              {t('chat.session-agents-role')}
            </DsText>
            <DsText
              as="dd"
              role="base"
              className="break-words whitespace-pre-wrap"
            >
              {agent.role || t('chat.session-agents-default-role')}
            </DsText>
          </div>
          <div>
            <DsText as="dt" role="meta" className="text-ds-ink-muted-default">
              {t('chat.session-agents-instructions')}
            </DsText>
            <DsText
              as="dd"
              role="base"
              className="break-words whitespace-pre-wrap"
            >
              {agent.instructions || t('chat.session-agents-no-instructions')}
            </DsText>
          </div>
          {!!agent.skill_ids?.length && (
            <div>
              <DsText as="dt" role="meta" className="text-ds-ink-muted-default">
                {t('chat.session-agents-skills')}
              </DsText>
              <DsText as="dd" role="base" className="break-words">
                {agent.skill_versions
                  ?.map(
                    (skill) => `${skill.name} · ${skill.sha256.slice(0, 8)}`
                  )
                  .join(', ') ?? agent.skill_ids.join(', ')}
              </DsText>
            </div>
          )}
          {nodeTools
            .filter((id) => agent.tool_policy?.[id])
            .map((id) => (
              <div key={id}>
                <DsText
                  as="dt"
                  role="meta"
                  className="text-ds-ink-muted-default"
                >
                  {t('chat.node-tool-' + id)}
                </DsText>
                <DsText as="dd" role="base">
                  {t('chat.node-tool-' + agent.tool_policy[id])}
                  {agent.granted_tools &&
                    ' · ' +
                      (agent.granted_tools.includes(id)
                        ? t('chat.node-tool-used', {
                            count: agent.tool_calls?.[id] ?? 0,
                          })
                        : t('chat.node-tool-withheld'))}
                </DsText>
              </div>
            ))}
        </dl>
      </div>
    </div>
  );
}

function AgentConversation({
  targets,
  delivered,
  taskId,
  node,
  choices,
  modelsLoading,
  api,
  email,
}: {
  targets: SessionAgent[];
  delivered: (agentId: string, taskId: string) => void;
  taskId: string;
  node: SessionAgent;
  choices: ConfiguredModelChoice[];
  modelsLoading: boolean;
  api: ReturnType<typeof sessionAgentApi>;
  email: string;
}) {
  const { t } = useTranslation();
  const [handoff, setHandoff] = useState<{
    source: SessionAgentRun;
    opener: HTMLButtonElement;
  } | null>(null);
  const [runs, setRuns] = useState<SessionAgentRun[]>([]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState(false);
  const [sending, setSending] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [consent, setConsent] = useState<{
    revision: number;
    ids: AgentToolId[];
  }>({ revision: node.revision, ids: [] });
  const selectedTools = consent.revision === node.revision ? consent.ids : [];
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const followEnd = useRef(true);
  useEffect(() => {
    const frame = scrollRef.current,
      content = contentRef.current;
    if (!frame || !content || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      if (followEnd.current) frame.scrollTop = frame.scrollHeight;
    });
    observer.observe(content);
    return () => observer.disconnect();
  }, []);
  const busy = useRef(false);
  const alive = useRef(true);
  const request = useRef<{
    id: string;
    prompt: string;
    revision: number;
    permissions: string;
  } | null>(null);
  const acknowledge = useCallback((id: string) => {
    const pending = request.current;
    if (pending?.id !== id) return;
    setError(false);
    request.current = null;
    setPrompt((current) => (current.trim() === pending.prompt ? '' : current));
    setConsent({ revision: pending.revision, ids: [] });
  }, []);
  const running = runs.find((run) => run.status === 'running');
  let available = true;
  try {
    resolveNodeConnection(node, choices, targets, email);
  } catch {
    available = false;
  }
  useEffect(() => {
    alive.current = true;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const result = await api.runs(node.id, taskId);
        if (cancelled) return;
        setRuns(result);
        const pendingId = request.current?.id;
        if (pendingId && result.some((run) => run.request_id === pendingId))
          acknowledge(pendingId);
        setReady(true);
      } catch {
        if (!cancelled) setError(true);
      }
      if (!cancelled) timer = setTimeout(poll, 1500);
    };
    void poll();
    return () => {
      cancelled = true;
      alive.current = false;
      clearTimeout(timer);
    };
  }, [api, node.id, taskId, acknowledge]);
  const send = async () => {
    const text = prompt.trim();
    if (!text || busy.current || !ready) return;
    followEnd.current = true;
    busy.current = true;
    setSending(true);
    setError(false);
    const permissions = [...selectedTools].sort().join(',');
    // Reuse the id on an uncertain response; the server never repeats inference.
    if (
      !request.current ||
      request.current.prompt !== text ||
      request.current.permissions !== permissions ||
      request.current.revision !== node.revision
    )
      request.current = {
        id: crypto.randomUUID(),
        prompt: text,
        revision: node.revision,
        permissions,
      };
    const submissionId = request.current.id;
    try {
      const connection = resolveNodeConnection(node, choices, targets, email);
      const result = await api.start(node.id, {
        task_id: taskId,
        request_id: submissionId,
        queue_if_busy: true,
        expected_revision: node.revision,
        approved_tools: selectedTools,
        prompt: text,
        connection,
        email,
      });
      if (!alive.current) return;
      setRuns((previous) =>
        previous.some((run) => run.id === result.id)
          ? previous
          : [...previous, result]
      );
      acknowledge(submissionId);
    } catch {
      if (alive.current && request.current?.id === submissionId) setError(true);
    } finally {
      busy.current = false;
      if (alive.current) setSending(false);
    }
  };
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      {handoff && (
        <AnswerHandoff
          {...handoff}
          allNodes={[node, ...targets]}
          targets={targets}
          choices={choices}
          api={api}
          email={email}
          close={() => setHandoff(null)}
          delivered={(id, task) => {
            setHandoff(null);
            delivered(id, task);
          }}
        />
      )}
      {!available && (
        <DsText role="base" aria-live="polite">
          {t(
            modelsLoading
              ? 'chat.session-agents-models-loading'
              : 'chat.session-agents-unavailable'
          )}
        </DsText>
      )}
      <div
        ref={scrollRef}
        aria-label={t('chat.session-agents-history')}
        onScroll={(e) => {
          const el = e.currentTarget;
          followEnd.current =
            el.scrollHeight - el.clientHeight - el.scrollTop < 48;
        }}
        className="scrollbar-always-visible min-h-0 min-w-0 flex-1 overflow-y-auto"
      >
        <div
          ref={contentRef}
          className="mx-auto flex min-h-full w-full max-w-[736px] flex-col gap-ds-stack-section px-ds-panel-inset py-ds-16"
        >
          {ready && !runs.length && (
            <div className="flex flex-1 flex-col items-center justify-center gap-ds-stack-related text-center">
              <DsIcon
                icon={Bot}
                recipe="illustration"
                illustrationSize={32}
                className="text-ds-ink-muted-default"
              />
              <DsText
                role="title"
                weight="semibold"
                className="max-w-full break-words"
              >
                {node.name}
              </DsText>
            </div>
          )}
          {runs.map((run) => (
            <article
              key={run.id}
              className="flex min-w-0 flex-col gap-ds-stack-related"
            >
              {!!run.returned_results?.length && (
                <details className="rounded-ds-field bg-ds-neutral-muted-default px-ds-panel-inset py-ds-8">
                  <summary className="cursor-pointer text-ds-text-base">
                    {t('chat.route-messages')} · {run.returned_results.length}
                  </summary>
                  {run.returned_results.map((item) => (
                    <div key={item.event_id} className="pt-ds-8">
                      <DsText role="meta" weight="semibold">
                        {item.agent_name} /{' '}
                        {item.task_name || t('chat.node-task-default')}
                      </DsText>
                      <DsText
                        role="base"
                        className="break-words whitespace-pre-wrap"
                      >
                        {item.output}
                      </DsText>
                    </div>
                  ))}
                </details>
              )}
              {run.source_answer && (
                <AnswerReference source={run.source_answer} />
              )}
              {run.prompt && (
                <UserMessageCard
                  embedded
                  id={run.id}
                  content={run.prompt}
                  createdAt={run.created_at}
                />
              )}
              <div className="flex flex-wrap items-center gap-ds-control-gap">
                <DsIcon icon={Bot} className="text-ds-ink-muted-default" />
                <DsText
                  role="base"
                  weight="semibold"
                  className="min-w-0 break-words"
                >
                  {run.agent.name}
                </DsText>
                <DsText role="meta" className="text-ds-ink-muted-default">
                  {run.agent.model.name} ·{' '}
                  {run.status === 'running' &&
                  run.agent.harness_id === 'plan_execute'
                    ? t(
                        run.plan
                          ? 'chat.node-phase-executing'
                          : 'chat.node-phase-planning'
                      )
                    : t(`chat.session-agents-status-${run.status}`)}
                </DsText>
              </div>
              {(run.status === 'queued' ||
                run.status === 'confirmation' ||
                run.can_resume) && (
                <div className="flex flex-wrap items-center gap-ds-control-gap">
                  {!running &&
                    (run.can_resume ||
                      (run.status === 'confirmation' &&
                        runs.find(
                          (r) =>
                            r.status === 'confirmation' || r.status === 'queued'
                        )?.id === run.id)) && (
                      <QueueConfirmation
                        key={run.id + node.revision}
                        node={node}
                        disabled={!available}
                        confirm={async (tools) => {
                          await api.confirmQueued(node.id, taskId, run.id, {
                            expected_revision: node.revision,
                            connection: resolveNodeConnection(
                              node,
                              choices,
                              targets,
                              email
                            ),
                            email,
                            approved_tools: tools,
                          });
                          if (alive.current)
                            setRuns(await api.runs(node.id, taskId));
                        }}
                      />
                    )}
                  {!run.can_resume && (
                    <Button
                      variant="text"
                      size="xs"
                      onClick={() =>
                        void api
                          .cancel(node.id, run.id, taskId)
                          .catch(() => setError(true))
                      }
                    >
                      {t('chat.session-agents-cancel')}
                    </Button>
                  )}
                </div>
              )}
              {run.plan && (
                <details
                  className="group rounded-ds-field bg-ds-neutral-muted-default px-ds-panel-inset py-ds-8"
                  open={run.status === 'running' || undefined}
                >
                  <summary className="flex cursor-pointer list-none items-center gap-ds-control-gap text-ds-text-base text-ds-ink-muted-default focus-visible:ring-2 focus-visible:ring-ds-ring-focus">
                    <DsIcon icon={ListChecks} />
                    {t('chat.node-run-plan')}
                    <DsIcon
                      icon={ChevronDown}
                      recipe="main-compact"
                      className="ml-auto group-open:rotate-180"
                    />
                  </summary>
                  <MarkDown
                    content={run.plan}
                    enableTypewriter={false}
                    profile="compact"
                    className="pt-ds-8"
                  />
                </details>
              )}
              {run.output && (
                <MarkDown
                  content={run.output}
                  enableTypewriter={false}
                  profile="conversation"
                />
              )}
              {run.status === 'failed' && (
                <DsText role="base">
                  {t(
                    run.error === 'invalid_plan'
                      ? 'chat.node-invalid-plan'
                      : run.error === 'skill_unavailable'
                        ? 'chat.session-agents-skill-unavailable'
                        : run.error === 'skill_limit'
                          ? 'chat.session-agents-skill-limit'
                          : 'chat.session-agents-run-error'
                  )}
                </DsText>
              )}
              {run.status === 'interrupted' && (
                <DsText role="base">
                  {t('chat.session-agents-interrupted')}
                </DsText>
              )}
              <AgentBehaviorDetails
                action={
                  run.status === 'completed' &&
                  run.output &&
                  targets.length > 0 && (
                    <Button
                      variant="ghost"
                      size="xs"
                      onClick={(e) =>
                        setHandoff({ source: run, opener: e.currentTarget })
                      }
                    >
                      <DsIcon icon={Forward} recipe="main-compact" />
                      {t('chat.handoff-action')}
                    </Button>
                  )
                }
                agent={run.agent}
                label={t('chat.session-agents-run-config')}
              />
            </article>
          ))}
        </div>
      </div>
      <div className="mx-auto w-full max-w-[736px] shrink-0 px-ds-panel-inset pt-ds-4 pb-ds-12">
        {error && (
          <DsText role="base" aria-live="assertive">
            {t('chat.session-agents-request-error')}
          </DsText>
        )}
        <div className="flex flex-col gap-ds-control-gap rounded-ds-24 border border-x border-y border-solid border-ds-hairline-default-default bg-ds-neutral-subtle-default px-ds-panel-inset py-ds-12 shadow-ds-elevation-card">
          <TurnTools
            policy={node.tool_policy ?? {}}
            selected={selectedTools}
            onChange={(ids) => setConsent({ revision: node.revision, ids })}
            disabled={sending}
          />
          <Textarea
            className="resize-none"
            variant="plain"
            size="sm"
            rows={2}
            onKeyDown={(event) => {
              if (
                event.key === 'Enter' &&
                !event.shiftKey &&
                !event.nativeEvent.isComposing &&
                event.keyCode !== 229
              ) {
                event.preventDefault();
                if (available) void send();
              }
            }}
            aria-label={t('chat.session-agents-message')}
            placeholder={t('chat.session-agents-message')}
            value={prompt}
            maxLength={32000}
            onChange={(event) => {
              if (
                request.current &&
                request.current.prompt !== event.target.value.trim()
              ) {
                request.current = null;
                setConsent({ revision: node.revision, ids: [] });
              }
              setPrompt(event.target.value);
            }}
          />
          <div className="flex items-center justify-between gap-ds-control-gap">
            <DsText
              role="meta"
              className="min-w-0 truncate text-ds-ink-muted-default"
              title={node.model.name}
            >
              {node.model.name}
            </DsText>
            {(!running || prompt.trim()) && (
              <Button
                size="sm"
                buttonContent="icon-only"
                aria-label={t(
                  running ? 'chat.queue-add' : 'chat.session-agents-send'
                )}
                title={t(
                  running ? 'chat.queue-add' : 'chat.session-agents-send'
                )}
                onClick={() => void send()}
                disabled={!ready || !available || !prompt.trim() || sending}
              >
                <DsIcon icon={ArrowUp} />
              </Button>
            )}
            {running && (
              <Button
                variant="secondary"
                size="sm"
                buttonContent="icon-only"
                aria-label={t('chat.session-agents-stop')}
                title={t('chat.session-agents-stop')}
                onClick={() =>
                  void api.cancel(node.id, running.id, taskId).catch(() => {
                    if (alive.current) setError(true);
                  })
                }
              >
                <DsIcon icon={Square} />
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function QueueConfirmation({
  node,
  disabled,
  confirm,
}: {
  node: SessionAgent;
  disabled: boolean;
  confirm: (tools: AgentToolId[]) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [tools, setTools] = useState<AgentToolId[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  return (
    <div className="flex flex-wrap items-center gap-ds-control-gap">
      <TurnTools
        policy={node.tool_policy}
        selected={tools}
        onChange={setTools}
        disabled={busy}
      />
      <Button
        size="xs"
        variant="secondary"
        disabled={busy || disabled}
        onClick={async () => {
          setBusy(true);
          setError(false);
          try {
            await confirm(tools);
          } catch {
            setError(true);
          } finally {
            setBusy(false);
          }
        }}
      >
        {t('chat.queue-confirm')}
      </Button>
      {error && (
        <DsText role="meta" aria-live="polite">
          {t('chat.session-agents-request-error')}
        </DsText>
      )}
    </div>
  );
}
