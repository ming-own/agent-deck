import { Button } from '@/components/ui/button';
import { DsText } from '@/components/ui/ds-text';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useConfiguredModels } from '@/hooks/useConfiguredModels';
import { getAccountEnvironmentKey } from '@/lib/authEnvironment';
import {
  selectableConfiguredModels,
  type ConfiguredModelChoice,
} from '@/lib/configuredModels';
import {
  sessionAgentApi,
  type SessionAgent,
  type SessionAgentRun,
} from '@/service/sessionAgentApi';
import {
  modelReference,
  resolveAgentConnection,
} from '@/service/sessionAgentModels';
import { useAuthStore } from '@/store/authStore';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

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
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [creating, setCreating] = useState(false);
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
  const create = async (name: string, choice: ConfiguredModelChoice) => {
    const node = await api.create(name, modelReference(choice));
    if (!alive.current) return;
    refreshSequence.current++;
    setNodes((previous) => [...previous, node]);
    setSelected(node.id);
    setCreating(false);
  };
  const node = nodes.find((item) => item.id === selected);
  return (
    <section
      aria-label={t('chat.session-agents-title')}
      className="scrollbar-always-visible flex min-h-0 flex-1 flex-col gap-ds-stack-section overflow-y-auto p-ds-panel-inset"
    >
      <div className="flex flex-wrap items-center justify-between gap-ds-control-gap">
        <DsText as="h2" role="title" weight="semibold">
          {t('chat.session-agents-title')}
        </DsText>
        <div className="flex gap-ds-control-gap">
          <Button variant="ghost" onClick={() => void refresh()}>
            {t('chat.session-agents-retry')}
          </Button>
          <Button
            variant="secondary"
            onClick={() => setCreating(true)}
            disabled={loading}
          >
            {t('chat.session-agents-add')}
          </Button>
        </div>
      </div>
      <DsText as="p" role="base" className="text-ds-ink-muted-default">
        {t('chat.session-agents-description')}
      </DsText>
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
      {creating && (
        <AgentForm
          key="create"
          choices={choices}
          onSave={create}
          onCancel={() => setCreating(false)}
        />
      )}
      {!loading && !error && !nodes.length && !creating && (
        <DsText as="p" role="base">
          {t('chat.session-agents-empty')}
        </DsText>
      )}
      <div
        role="group"
        aria-label={t('chat.session-agents-select')}
        className="flex flex-wrap gap-ds-control-gap"
      >
        {nodes.map((item) => (
          <Button
            key={item.id}
            variant={selected === item.id ? 'primary' : 'secondary'}
            aria-pressed={selected === item.id}
            className="max-w-full min-w-0"
            title={item.name}
            onClick={() => setSelected(item.id)}
          >
            <span className="truncate">{item.name}</span>
          </Button>
        ))}
      </div>
      {node && (
        <AgentConversation
          key={node.id}
          node={node}
          choices={choices}
          modelsLoading={inventory.loading || inventory.codexModelsLoading}
          api={api}
          email={email}
          onUpdated={(updated) => {
            refreshSequence.current++;
            setNodes((previous) =>
              previous.map((item) => (item.id === updated.id ? updated : item))
            );
          }}
        />
      )}
    </section>
  );
}

function AgentForm({
  node,
  choices,
  onSave,
  onCancel,
}: {
  node?: SessionAgent;
  choices: ConfiguredModelChoice[];
  onSave: (name: string, choice: ConfiguredModelChoice) => Promise<void>;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState(node?.name ?? '');
  const [model, setModel] = useState(node?.model.id ?? '');
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const savingRef = useRef(false);
  const choice = choices.find((item) => item.id === model);
  return (
    <form
      className="flex flex-col gap-ds-stack-related rounded-ds-card bg-ds-neutral-subtle-default p-ds-card-inset"
      onSubmit={async (event) => {
        event.preventDefault();
        if (!choice || !name.trim() || savingRef.current) return;
        savingRef.current = true;
        setSaving(true);
        setFailed(false);
        try {
          await onSave(name.trim(), choice);
        } catch {
          setFailed(true);
        } finally {
          savingRef.current = false;
          setSaving(false);
        }
      }}
    >
      <Input
        title={t('chat.session-agents-name')}
        aria-label={t('chat.session-agents-name')}
        value={name}
        maxLength={100}
        onChange={(event) => setName(event.target.value)}
        disabled={saving}
      />
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
          <SelectValue placeholder={t('chat.session-agents-select-model')} />
        </SelectTrigger>
        <SelectContent fitTrigger>
          {choices.map((item) => (
            <SelectItem key={item.id} value={item.id}>
              {item.name} · {item.group}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {!choices.length && (
        <DsText role="base">{t('chat.session-agents-no-models')}</DsText>
      )}
      {failed && (
        <DsText role="base" aria-live="assertive">
          {t('chat.session-agents-save-error')}
        </DsText>
      )}
      <div className="flex flex-wrap gap-ds-control-gap">
        <Button type="submit" disabled={!name.trim() || !choice || saving}>
          {t('chat.session-agents-save')}
        </Button>
        <Button
          type="button"
          variant="ghost"
          disabled={saving}
          onClick={onCancel}
        >
          {t('chat.session-agents-cancel')}
        </Button>
      </div>
    </form>
  );
}

function AgentConversation({
  node,
  choices,
  modelsLoading,
  api,
  email,
  onUpdated,
}: {
  node: SessionAgent;
  choices: ConfiguredModelChoice[];
  modelsLoading: boolean;
  api: ReturnType<typeof sessionAgentApi>;
  email: string;
  onUpdated: (node: SessionAgent) => void;
}) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [runs, setRuns] = useState<SessionAgentRun[]>([]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState(false);
  const [sending, setSending] = useState(false);
  const [prompt, setPrompt] = useState('');
  const busy = useRef(false);
  const alive = useRef(true);
  const request = useRef<{
    id: string;
    prompt: string;
    revision: number;
  } | null>(null);
  const running = runs.find((run) => run.status === 'running');
  let available = true;
  try {
    resolveAgentConnection(node.model, choices);
  } catch {
    available = false;
  }
  useEffect(() => {
    alive.current = true;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const result = await api.runs(node.id);
        if (cancelled) return;
        setRuns(result);
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
  }, [api, node.id]);
  const send = async () => {
    const text = prompt.trim();
    if (!text || busy.current || running || !ready) return;
    busy.current = true;
    setSending(true);
    setError(false);
    // Reuse the id on an uncertain response; the server never repeats inference.
    if (
      !request.current ||
      request.current.prompt !== text ||
      request.current.revision !== node.revision
    )
      request.current = {
        id: crypto.randomUUID(),
        prompt: text,
        revision: node.revision,
      };
    try {
      const connection = resolveAgentConnection(node.model, choices);
      const result = await api.start(node.id, {
        request_id: request.current.id,
        expected_revision: node.revision,
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
      setPrompt((current) => (current.trim() === text ? '' : current));
      request.current = null;
    } catch {
      if (alive.current) setError(true);
    } finally {
      busy.current = false;
      if (alive.current) setSending(false);
    }
  };
  return (
    <div className="flex flex-col gap-ds-stack-related">
      <div className="flex flex-wrap items-center justify-between gap-ds-control-gap">
        <DsText role="body-large" weight="semibold">
          {node.name} · {node.model.name}
        </DsText>
        <Button variant="secondary" onClick={() => setEditing(true)}>
          {t('chat.session-agents-edit')}
        </Button>
      </div>
      {!available && (
        <DsText role="base" aria-live="polite">
          {t(
            modelsLoading
              ? 'chat.session-agents-models-loading'
              : 'chat.session-agents-unavailable'
          )}
        </DsText>
      )}
      {editing && (
        <AgentForm
          key={node.revision}
          node={node}
          choices={choices}
          onCancel={() => setEditing(false)}
          onSave={async (name, choice) => {
            const updated = await api.update(
              node,
              name,
              modelReference(choice)
            );
            if (alive.current) {
              onUpdated(updated);
              setEditing(false);
            }
          }}
        />
      )}
      <div
        aria-label={t('chat.session-agents-history')}
        className="flex flex-col gap-ds-stack-related"
      >
        {runs.map((run) => (
          <article
            key={run.id}
            className="flex flex-col gap-ds-stack-related rounded-ds-card bg-ds-neutral-subtle-default p-ds-card-inset"
          >
            <DsText role="meta" className="text-ds-ink-muted-default">
              {run.agent.name} · {run.agent.model.name} ·{' '}
              {t(`chat.session-agents-status-${run.status}`)}
            </DsText>
            <DsText
              as="p"
              role="base"
              className="break-words whitespace-pre-wrap"
            >
              {run.prompt}
            </DsText>
            {run.output && (
              <DsText
                as="p"
                role="base"
                className="break-words whitespace-pre-wrap"
              >
                {run.output}
              </DsText>
            )}
            {run.status === 'failed' && (
              <DsText role="base">{t('chat.session-agents-run-error')}</DsText>
            )}
            {run.status === 'interrupted' && (
              <DsText role="base">
                {t('chat.session-agents-interrupted')}
              </DsText>
            )}
          </article>
        ))}
      </div>
      {error && (
        <DsText role="base" aria-live="assertive">
          {t('chat.session-agents-request-error')}
        </DsText>
      )}
      <Textarea
        aria-label={t('chat.session-agents-message')}
        placeholder={t('chat.session-agents-message')}
        value={prompt}
        maxLength={32000}
        onChange={(event) => setPrompt(event.target.value)}
      />
      <div className="flex flex-wrap gap-ds-control-gap">
        <Button
          onClick={() => void send()}
          disabled={
            !ready ||
            !available ||
            !prompt.trim() ||
            Boolean(running) ||
            sending
          }
        >
          {t('chat.session-agents-send')}
        </Button>
        {running && (
          <Button
            variant="secondary"
            onClick={() =>
              void api.cancel(node.id, running.id).catch(() => {
                if (alive.current) setError(true);
              })
            }
          >
            {t('chat.session-agents-stop')}
          </Button>
        )}
      </div>
    </div>
  );
}
