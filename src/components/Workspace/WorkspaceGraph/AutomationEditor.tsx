import { Button } from '@/components/ui/button';
import { DsText } from '@/components/ui/ds-text';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { startRequestedExecution } from '@/lib/triggerExecutionRequests';
import { proxyRunTriggerNow } from '@/service/triggerApi';
import { usePageTabStore } from '@/store/pageTabStore';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { WorkspaceData } from './useWorkspaceGraph';
export function AutomationEditor({
  data,
  triggerId,
  done,
}: {
  data: WorkspaceData;
  triggerId: string;
  done: () => void;
}) {
  const { t } = useTranslation(),
    trigger = data.automations.find((a) => String(a.id) === triggerId),
    binding = data.graph?.automation_bindings.find(
      (b) => b.trigger_id === triggerId
    );
  const [target, setTarget] = useState(binding?.agent_id ?? 'none'),
    [busy, setBusy] = useState(false),
    [failed, setFailed] = useState(false);
  const perform = async (fn: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    setFailed(false);
    try {
      await fn();
      done();
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };
  if (!trigger) return null;
  return (
    <div className="flex flex-col gap-ds-16">
      <DsText role="base" className="whitespace-pre-wrap">
        {trigger.task_prompt || trigger.description}
      </DsText>
      <DsText role="meta" className="text-ds-ink-muted-default">
        {t('triggers.status.' + trigger.status)} ·{' '}
        {trigger.custom_cron_expression || trigger.trigger_type}
        {trigger.next_run_at
          ? ' · ' + new Date(trigger.next_run_at).toLocaleString()
          : ''}
      </DsText>
      <label className="flex flex-col gap-ds-8">
        <DsText role="base" weight="semibold">
          {t('chat.workspace-executor')}
        </DsText>
        <Select value={target} onValueChange={setTarget} disabled={busy}>
          <SelectTrigger size="sm" aria-label={t('chat.workspace-executor')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent fitTrigger>
            <SelectItem value="none">
              {t('chat.workspace-default-executor')}
            </SelectItem>
            {data.agents
              .filter((a) => !a.workforce_member)
              .map((a) => (
                <SelectItem key={a.id} value={a.id}>
                  {a.name} ·{' '}
                  {data.sessions.find((s) => s.id === a.projectId)?.name}
                </SelectItem>
              ))}
          </SelectContent>
        </Select>
      </label>
      <DsText role="base" className="text-ds-ink-muted-default">
        {t('chat.workspace-automation-help')}
      </DsText>
      {failed && (
        <DsText role="base" as="p" aria-live="assertive">
          {t('chat.workspace-save-error')}
        </DsText>
      )}
      <Button
        size="sm"
        disabled={busy}
        onClick={() =>
          void perform(async () => {
            if (target === 'none') {
              if (binding)
                await data.api.unbindAutomation(triggerId, binding.revision);
            } else {
              const agent = data.agents.find((a) => a.id === target);
              if (!agent) throw Error('Agent unavailable');
              await data.api.bindAutomation(triggerId, {
                project_id: agent.projectId,
                agent_id: target,
                expected_revision: binding?.revision ?? 0,
              });
            }
          })
        }
      >
        {t('layout.save')}
      </Button>
      <Button
        size="sm"
        variant="secondary"
        disabled={busy || target !== (binding?.agent_id ?? 'none')}
        onClick={() =>
          void perform(async () => {
            const execution = await proxyRunTriggerNow(trigger.id);
            startRequestedExecution(trigger, execution.execution_id);
          })
        }
      >
        {t('chat.workspace-run-now')}
      </Button>
      <Button
        size="sm"
        variant="ghost"
        onClick={() => {
          usePageTabStore.getState().setActiveWorkspaceTab('triggers');
          usePageTabStore.getState().requestSelectTrigger(trigger.id);
        }}
      >
        {t('chat.workspace-edit-automation')}
      </Button>
    </div>
  );
}
