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
import type { ConfiguredModelChoice } from '@/lib/configuredModels';
import type {
  AgentToolId,
  BatchReceipt,
  BatchSpec,
  BatchTarget,
  SessionAgent,
  sessionAgentApi,
} from '@/service/sessionAgentApi';
import { resolveNodeConnection } from '@/service/sessionAgentModels';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BatchActions } from './BatchActions';
import { TurnTools } from './ToolPermissions';

type Props = {
  api: ReturnType<typeof sessionAgentApi>;
  agents: SessionAgent[];
  choices: ConfiguredModelChoice[];
  email: string;
  sending: boolean;
  setSending: (value: boolean) => void;
  onTaskCreated: () => void;
};

function Picker({
  label,
  value,
  items,
  change,
}: {
  label: string;
  value: string;
  items: { id: string; name: string }[];
  change: (id: string) => void;
}) {
  return (
    <Select value={value} onValueChange={change}>
      <SelectTrigger
        size="sm"
        title={label}
        aria-label={label}
        wrapperClassName="min-w-0"
      >
        <SelectValue placeholder={label} />
      </SelectTrigger>
      <SelectContent>
        {items.map((i) => (
          <SelectItem key={i.id} value={i.id}>
            {i.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function BatchRecord({
  batch,
  children,
}: {
  batch: BatchReceipt;
  children: React.ReactNode;
}) {
  const { t } = useTranslation();
  const status = (s: string) =>
    t(
      ['waiting', 'blocked', 'unmatched', 'skipped', 'stopped'].includes(s)
        ? 'chat.batch-' + s
        : 'chat.session-agents-status-' + s
    );
  return (
    <article className="flex flex-col gap-ds-stack-related rounded-ds-field bg-ds-neutral-muted-default p-ds-panel-inset">
      <div>
        <DsText role="base" weight="semibold" className="break-words">
          {batch.spec.message}
        </DsText>
        <DsText role="meta" className="text-ds-ink-muted-default">
          {status(batch.state)} · {new Date(batch.created_at).toLocaleString()}
        </DsText>
      </div>
      {batch.spec.branches.map((branch, i) => (
        <details key={i} className="text-ds-text-base">
          <summary className="cursor-pointer break-words">
            {branch.name} · {status(batch.branches[i]?.status ?? 'skipped')}
          </summary>
          <DsText role="base" className="break-words whitespace-pre-wrap">
            {branch.instructions}
          </DsText>
          <DsText role="base" className="break-words whitespace-pre-wrap">
            {batch.branches[i]?.output}
          </DsText>
        </details>
      ))}
      {batch.summary && (
        <div>
          <DsText role="meta" weight="semibold">
            {batch.spec.summary.name} · {status(batch.summary.status)}
          </DsText>
          <DsText role="base" className="break-words whitespace-pre-wrap">
            {batch.summary.output}
          </DsText>
        </div>
      )}
      {children}
    </article>
  );
}

export function BranchRouter(props: Props) {
  const { api, agents, choices, email, sending, setSending, onTaskCreated } =
    props;
  const { t } = useTranslation();
  const [records, setRecords] = useState<BatchReceipt[] | null>(null);
  const [grants, setGrants] = useState<Record<string, AgentToolId[]>>({});
  const [templateName, setTemplateName] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<BatchSpec | null>(null);
  const [err, setErr] = useState('');
  const [epoch, refresh] = useState(0);
  const lock = useRef(false);
  const saveGesture = useRef<{ key: string; id: string } | null>(null);
  const pending = useRef<{ id: string; key: string } | null>(null);
  const branch = (i: number) => ({
    agent_id: agents[i % agents.length]?.id ?? '',
    name: t('chat.batch-branch', { n: i + 1 }),
    instructions: '',
    contains: '',
  });
  function edit(last?: BatchSpec) {
    setDraft(
      last
        ? { ...last, message: '' }
        : {
            message: '',
            branches: [branch(0), branch(1)],
            join: 'all_success',
            summary: {
              agent_id: agents[0]?.id ?? '',
              name: t('chat.batch-summary'),
              instructions: '',
            },
          }
    );
    setGrants({});
    setTemplateName(null);
    setEditing(true);
    setErr('');
    pending.current = null;
  }
  useEffect(() => {
    let current = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const rows = await api.batches();
        if (!current) return;
        setRecords(rows);
        setErr('');
        if (rows.some((r) => ['running', 'waiting'].includes(r.state)))
          timer = setTimeout(poll, 1200);
      } catch {
        if (current) setErr('chat.session-agents-load-error');
      }
    };
    if (!editing) void poll();
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [api, epoch, editing]);
  async function submit() {
    if (!draft || lock.current) return;
    lock.current = true;
    setSending(true);
    setErr('');
    try {
      const settings: Record<string, unknown> = {};
      const revisions: Record<string, number> = {};
      for (const id of new Set([
        ...draft.branches.map((b) => b.agent_id),
        draft.summary.agent_id,
      ])) {
        const a = agents.find((item) => item.id === id);
        if (!a) throw new Error('unavailable');
        try {
          settings[id] = {
            connection: resolveNodeConnection(a, choices, agents, email),
            email,
            expected_revision: a.revision,
            approved_tools:
              id === draft.summary.agent_id ? (grants.summary ?? []) : [],
          };
          revisions[id] = a.revision;
        } catch {
          /* A skipped branch does not need credentials. */
        }
      }
      const key = JSON.stringify([draft, revisions, grants]);
      if (pending.current?.key !== key)
        pending.current = { key, id: crypto.randomUUID() };
      const row = await api.dispatchBatch({
        ...draft,
        settings,
        branch_tools: draft.branches.map((_, i) => grants[i] ?? []),
        event_id: pending.current.id,
      });
      setRecords((old) => [
        row,
        ...(old ?? []).filter((r) => r.event_id !== row.event_id),
      ]);
      setEditing(false);
      onTaskCreated();
      refresh((n) => n + 1);
    } catch (e) {
      setErr(
        (e as { status?: number }).status === 409
          ? 'chat.batch-conflict'
          : 'chat.session-agents-request-error'
      );
    } finally {
      lock.current = false;
      setSending(false);
    }
  }
  if (!editing || !draft)
    return (
      <div className="flex flex-col gap-ds-stack-related">
        {records && (
          <div className="flex items-center justify-between gap-ds-control-gap">
            <DsText role="base" className="text-ds-ink-muted-default">
              {t(records.length ? 'chat.route-log' : 'chat.batch-help')}
            </DsText>
            <Button
              size="sm"
              disabled={!agents.length}
              onClick={() => edit(records[0]?.spec)}
            >
              {t('chat.batch-new')}
            </Button>
          </div>
        )}
        {!agents.length && (
          <DsText role="base">{t('chat.session-agents-empty')}</DsText>
        )}
        {err ? (
          <Button
            variant="text"
            size="xs"
            onClick={() => refresh((n) => n + 1)}
          >
            {t(err)} · {t('chat.session-agents-retry')}
          </Button>
        ) : (
          !records && (
            <DsText role="base">{t('chat.session-agents-loading')}</DsText>
          )
        )}
        {records?.map((batch) => (
          <BatchRecord key={batch.event_id} batch={batch}>
            <BatchActions
              key={batch.generation}
              batch={batch}
              api={api}
              email={email}
              choices={choices}
              refresh={() => refresh((n) => n + 1)}
            />
          </BatchRecord>
        ))}
      </div>
    );
  const update = (patch: Partial<BatchSpec>) => {
    if (
      (patch.branches &&
        (patch.branches.length !== draft.branches.length ||
          patch.branches.some(
            (b, i) => b.agent_id !== draft.branches[i]?.agent_id
          ))) ||
      (patch.summary && patch.summary.agent_id !== draft.summary.agent_id)
    )
      setGrants({});
    setDraft({ ...draft, ...patch });
  };
  const patchBranch = (
    i: number,
    patch: Partial<BatchSpec['branches'][number]>
  ) =>
    update({
      branches: draft.branches.map((b, j) =>
        i === j ? { ...b, ...patch } : b
      ),
    });
  const input = (
    label: string,
    value: string,
    onChange: (v: string) => void,
    maxLength: number
  ) => (
    <Input
      title={label}
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      maxLength={maxLength}
    />
  );
  const permissions = (agentId: string, key: string) => (
    <TurnTools
      policy={agents.find((a) => a.id === agentId)?.tool_policy ?? {}}
      selected={grants[key] ?? []}
      onChange={(ids) => setGrants({ ...grants, [key]: ids })}
      disabled={sending}
    />
  );
  const targetFields = (
    target: BatchTarget,
    patch: (p: Partial<BatchTarget>) => void
  ) => (
    <>
      <div className="grid grid-cols-1 gap-ds-control-gap sm:grid-cols-2">
        <Picker
          label={t('chat.handoff-agent')}
          value={target.agent_id}
          items={agents}
          change={(agent_id) => patch({ agent_id })}
        />
        {input(
          t('chat.node-task-name'),
          target.name,
          (name) => patch({ name }),
          100
        )}
      </div>
      {input(
        t('chat.session-agents-instructions-label'),
        target.instructions,
        (instructions) => patch({ instructions }),
        4000
      )}
    </>
  );
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <fieldset
        disabled={sending}
        className="flex min-w-0 flex-col gap-ds-stack-related"
      >
        <Textarea
          title={t('chat.route-body')}
          aria-label={t('chat.route-body')}
          size="sm"
          variant="outlined"
          rows={2}
          value={draft.message}
          maxLength={16000}
          onChange={(e) => update({ message: e.target.value })}
        />
        {draft.branches.map((b, i) => (
          <section key={i} className="flex flex-col gap-ds-control-gap">
            <div className="flex items-center justify-between">
              <DsText role="base" weight="semibold">
                {t('chat.batch-branch', { n: i + 1 })}
              </DsText>
              {draft.branches.length > 1 && (
                <Button
                  type="button"
                  size="xs"
                  variant="text"
                  onClick={() =>
                    update({
                      branches: draft.branches.filter((_, j) => j !== i),
                    })
                  }
                >
                  {t('chat.batch-remove')}
                </Button>
              )}
            </div>
            {targetFields(b, (patch) => patchBranch(i, patch))}
            {permissions(b.agent_id, String(i))}
            {input(
              t('chat.batch-contains'),
              b.contains,
              (contains) => patchBranch(i, { contains }),
              200
            )}
          </section>
        ))}
        {draft.branches.length < 8 && (
          <div>
            <Button
              type="button"
              size="xs"
              variant="secondary"
              onClick={() =>
                update({
                  branches: [...draft.branches, branch(draft.branches.length)],
                })
              }
            >
              {t('chat.batch-add')}
            </Button>
          </div>
        )}
        <section className="flex flex-col gap-ds-control-gap">
          <DsText role="base" weight="semibold">
            {t('chat.batch-summary')}
          </DsText>
          <Picker
            value={draft.join}
            label={t('chat.batch-rule')}
            items={(['all_success', 'all_finished'] as const).map((id) => ({
              id,
              name: t('chat.batch-' + id),
            }))}
            change={(id) => update({ join: id as BatchSpec['join'] })}
          />
          {targetFields(draft.summary, (patch) =>
            update({ summary: { ...draft.summary, ...patch } })
          )}
          {permissions(draft.summary.agent_id, 'summary')}
        </section>
        {templateName !== null &&
          input(t('chat.workshop-name'), templateName, setTemplateName, 100)}
        <div>
          <Button
            type="button"
            size="xs"
            variant="text"
            disabled={
              sending || (templateName !== null && !templateName.trim())
            }
            onClick={async () => {
              if (templateName === null) {
                setTemplateName('');
                return;
              }
              if (lock.current) return;
              lock.current = true;
              setSending(true);
              try {
                const key = JSON.stringify([
                  templateName,
                  draft.branches,
                  draft.summary,
                  draft.join,
                ]);
                if (saveGesture.current?.key !== key)
                  saveGesture.current = { key, id: crypto.randomUUID() };
                await api.saveTemplate({
                  request_id: saveGesture.current.id,
                  name: templateName.trim(),
                  route: {
                    branches: draft.branches,
                    summary: draft.summary,
                    join: draft.join,
                  },
                });
                saveGesture.current = null;
                setTemplateName(null);
                setErr('chat.workshop-saved');
              } catch {
                setErr('chat.session-agents-save-error');
              } finally {
                lock.current = false;
                setSending(false);
              }
            }}
          >
            {t('chat.workshop-save')}
          </Button>
        </div>
        {err && (
          <DsText role="base" aria-live="assertive">
            {t(err)}
          </DsText>
        )}
        <div className="flex justify-end gap-ds-control-gap">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => {
              setEditing(false);
              setErr('');
            }}
          >
            {t('chat.session-agents-cancel')}
          </Button>
          <Button
            type="submit"
            size="sm"
            disabled={
              sending ||
              !draft.message.trim() ||
              [...draft.branches, draft.summary].some(
                (b) =>
                  !b.name.trim() || !agents.some((a) => a.id === b.agent_id)
              )
            }
          >
            {t('chat.batch-run')}
          </Button>
        </div>
      </fieldset>
    </form>
  );
}
