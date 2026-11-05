import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { DsText } from '@/components/ui/ds-text';
import type { ConfiguredModelChoice } from '@/lib/configuredModels';
import type {
  AgentToolId,
  BatchReceipt,
  SessionAgent,
  sessionAgentApi,
} from '@/service/sessionAgentApi';
import { resolveAgentConnection } from '@/service/sessionAgentModels';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { TurnTools } from './ToolPermissions';

export function BatchActions({
  batch,
  api,
  choices,
  email,
  refresh,
}: {
  batch: BatchReceipt;
  api: ReturnType<typeof sessionAgentApi>;
  choices: ConfiguredModelChoice[];
  email: string;
  refresh: () => void;
}) {
  const { t } = useTranslation();
  const [agents, setAgents] = useState<SessionAgent[] | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [grants, setGrants] = useState<Record<string, AgentToolId[]>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const request = useRef<{ id: string; key: string } | null>(null);
  const attempts = batch.branches.flatMap((run, index) =>
    run && ['interrupted', 'failed'].includes(run.status)
      ? [{ ...run, name: batch.spec.branches[index].name }]
      : []
  );
  const canRecover = ['stopped', 'blocked', 'failed', 'interrupted'].includes(
    batch.state
  );
  const active = ['running', 'waiting'].includes(batch.state);
  if (!active && !canRecover) return null;

  async function act(fn: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError(false);
    try {
      await fn();
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }
  function settings(agentId: string, key: string) {
    const agent = agents?.find((n) => n.id === agentId);
    if (!agent) throw new Error('Agent unavailable');
    return {
      expected_revision: agent.revision,
      email,
      connection: resolveAgentConnection(agent.model, choices),
      approved_tools: grants[key] ?? [],
    };
  }
  function permissions(agentId: string, key: string) {
    const agent = agents?.find((n) => n.id === agentId);
    return (
      agent && (
        <TurnTools
          policy={agent.tool_policy}
          selected={grants[key] ?? []}
          onChange={(ids) => setGrants({ ...grants, [key]: ids })}
          disabled={busy}
        />
      )
    );
  }
  async function recover() {
    const branches = Object.fromEntries(
      attempts
        .filter((a) => selected.includes(a.id))
        .map((a) => [a.id, settings(a.agent_id, a.id)])
    );
    const summary = settings(batch.spec.summary.agent_id, 'summary');
    const key = JSON.stringify([
      batch.generation,
      selected,
      grants,
      agents?.map((n) => n.revision),
    ]);
    if (request.current?.key !== key)
      request.current = { id: crypto.randomUUID(), key };
    await api.recoverBatch(batch.event_id, {
      request_id: request.current.id,
      expected_generation: batch.generation,
      branches,
      summary,
      summary_attempt: batch.summary?.id ?? null,
    });
    setAgents(null);
    refresh();
  }
  return (
    <div className="flex flex-col gap-ds-control-gap">
      {active && (
        <div>
          <Button
            size="xs"
            variant="secondary"
            disabled={busy}
            onClick={() =>
              void act(async () => {
                await api.stopBatch(batch.event_id, batch.generation);
                refresh();
              })
            }
          >
            {t('chat.session-agents-stop')}
          </Button>
        </div>
      )}
      {canRecover && !agents && (
        <div>
          <Button
            size="xs"
            variant="secondary"
            disabled={busy}
            onClick={() =>
              void act(async () => {
                setAgents(await api.list());
                setSelected(batch.summary ? [] : attempts.map((a) => a.id));
                setGrants({});
                request.current = null;
              })
            }
          >
            {t(
              attempts.length && !batch.summary
                ? 'chat.batch-retry'
                : 'chat.batch-resume'
            )}
          </Button>
        </div>
      )}
      {canRecover && agents && (
        <>
          {!batch.summary &&
            attempts.map((a) => (
              <div key={a.id}>
                <label className="flex items-center gap-ds-control-gap">
                  <Checkbox
                    checked={selected.includes(a.id)}
                    disabled={busy}
                    onCheckedChange={(checked) =>
                      setSelected((old) =>
                        checked === true
                          ? [...old, a.id]
                          : old.filter((id) => id !== a.id)
                      )
                    }
                  />
                  <DsText role="base">{a.name}</DsText>
                </label>
                {selected.includes(a.id) && permissions(a.agent_id, a.id)}
              </div>
            ))}
          <DsText role="meta" weight="semibold">
            {batch.spec.summary.name}
          </DsText>
          {permissions(batch.spec.summary.agent_id, 'summary')}
          <div className="flex flex-wrap gap-ds-control-gap">
            <Button
              size="xs"
              disabled={
                busy ||
                (!batch.summary &&
                  attempts.length > 0 &&
                  batch.spec.join === 'all_success' &&
                  !selected.length)
              }
              onClick={() => void act(recover)}
            >
              {t('chat.queue-confirm')}
            </Button>
            <Button
              variant="text"
              size="xs"
              disabled={busy}
              onClick={() => setAgents(null)}
            >
              {t('chat.session-agents-cancel')}
            </Button>
          </div>
        </>
      )}
      {error && (
        <DsText role="meta" aria-live="polite">
          {t('chat.batch-conflict')}
        </DsText>
      )}
    </div>
  );
}
