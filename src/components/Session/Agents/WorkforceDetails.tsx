import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogContentSection,
  DialogHeader,
} from '@/components/ui/dialog';
import { DsText } from '@/components/ui/ds-text';
import { Textarea } from '@/components/ui/textarea';
import type { ConfiguredModelChoice } from '@/lib/configuredModels';
import type {
  BatchReceipt,
  SessionAgent,
  SessionAgentRun,
  sessionAgentApi,
} from '@/service/sessionAgentApi';
import { resolveNodeConnection } from '@/service/sessionAgentModels';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

export function WorkforceDetails({
  node,
  api,
  epoch,
  choices,
  email,
  edit,
  close,
  save,
}: {
  node: SessionAgent;
  api: ReturnType<typeof sessionAgentApi>;
  epoch: number;
  choices: ConfiguredModelChoice[];
  email: string;
  edit: (node: SessionAgent, button: HTMLButtonElement) => void;
  close: () => void;
  save: () => void;
}) {
  const { t } = useTranslation();
  const [nodes, setNodes] = useState<SessionAgent[]>([]),
    [runs, setRuns] = useState<SessionAgentRun[]>([]),
    [trace, setTrace] = useState<BatchReceipt | null>(null),
    [message, setMessage] = useState(''),
    [error, setError] = useState(false),
    [busy, setBusy] = useState(false),
    [runEpoch, setRunEpoch] = useState(0);
  const request = useRef<{ text: string; id: string } | null>(null);
  useEffect(() => {
    let live = true;
    api
      .list()
      .then((ns) => {
        if (live) setNodes(ns);
      })
      .catch(() => {
        if (live) setError(true);
      });
    return () => {
      live = false;
    };
  }, [api, epoch]);
  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const rs = await api.runs(node.id, 'default');
        const last = rs.at(-1);
        const record = last ? await api.workforceTrace(last.id) : null;
        if (live) {
          setRuns(rs);
          setTrace(record);
          setError(false);
        }
        if (
          last &&
          !['running', 'queued', 'confirmation'].includes(last.status)
        )
          return;
      } catch {
        if (live) setError(true);
      }
      if (live) timer = setTimeout(poll, 1500);
    }
    void poll();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [api, node.id, runEpoch]);
  const route = node.workforce!;
  const latest = runs.at(-1);
  async function send() {
    if (busy || !message.trim()) return;
    setBusy(true);
    setError(false);
    try {
      if (request.current?.text !== message)
        request.current = { text: message, id: crypto.randomUUID() };
      const run = await api.start(node.id, {
        task_id: 'default',
        request_id: request.current.id,
        prompt: message,
        expected_revision: node.revision,
        email,
        queue_if_busy: true,
        connection: resolveNodeConnection(node, choices, nodes, email),
      });
      setRuns((old) => [...old.filter((r) => r.id !== run.id), run]);
      request.current = null;
      setMessage('');
      setTrace(null);
      setRunEpoch((n) => n + 1);
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) close();
      }}
    >
      <DialogContent
        size="md"
        overlayVariant="dimmed"
        aria-describedby={undefined}
      >
        <DialogHeader
          title={node.name}
          subtitle={
            'Workforce' +
            (node.template_version ? ' · v' + node.template_version : '')
          }
        />
        <DialogContentSection>
          <div className="flex flex-col gap-ds-stack-related">
            {[...route.branches, route.summary].map((target, i) => {
              const member = nodes.find((n) => n.id === target.agent_id);
              return (
                <div
                  className="flex items-center justify-between gap-ds-control-gap"
                  key={i}
                >
                  <div>
                    <DsText role="base" weight="semibold">
                      {target.name}
                    </DsText>
                    <DsText role="meta" className="text-ds-ink-muted-default">
                      {member?.name} · {member?.model.name}
                      {'contains' in target && target.contains
                        ? ' · ' + target.contains
                        : ''}
                    </DsText>
                  </div>
                  <Button
                    size="xs"
                    variant="secondary"
                    disabled={!member}
                    onClick={(e) => member && edit(member, e.currentTarget)}
                  >
                    {t('chat.session-agents-edit')}
                  </Button>
                </div>
              );
            })}
            <DsText role="meta">{t('chat.batch-' + route.join)}</DsText>
            <Textarea
              variant="outlined"
              size="sm"
              rows={2}
              title={t('chat.route-body')}
              aria-label={t('chat.route-body')}
              maxLength={32000}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
            />
            <div className="flex justify-between gap-ds-control-gap">
              <Button size="xs" variant="text" onClick={save}>
                {t('chat.workshop-save')}
              </Button>
              <Button
                size="sm"
                disabled={!message.trim() || !nodes.length || busy}
                onClick={() => void send()}
              >
                {t('chat.session-agents-send')}
              </Button>
            </div>
            {latest && (
              <div aria-live="polite">
                <DsText role="meta">
                  {t('chat.session-agents-status-' + latest.status)}
                </DsText>
                <DsText role="base" className="break-words whitespace-pre-wrap">
                  {latest.output ||
                    (latest.error === 'workforce_no_match'
                      ? t('chat.batch-unmatched')
                      : latest.error === 'workforce_branch_failed'
                        ? t('chat.batch-blocked')
                        : '')}
                </DsText>
              </div>
            )}
            {trace && (
              <details className="rounded-ds-field bg-ds-neutral-muted-default px-ds-panel-inset py-ds-8">
                <summary className="cursor-pointer text-ds-text-base text-ds-ink-muted-default focus-visible:ring-2 focus-visible:ring-ds-ring-focus">
                  {t('chat.batch-tab')}
                </summary>
                <div className="flex flex-col gap-ds-stack-related">
                  {trace.spec.branches.map((branch, i) => {
                    const result = trace.branches[i];
                    return (
                      <div key={i}>
                        <DsText role="meta" weight="semibold">
                          {branch.name} ·{' '}
                          {result
                            ? t('chat.session-agents-status-' + result.status)
                            : t('chat.batch-skipped')}
                        </DsText>
                        {result?.output && (
                          <DsText
                            role="base"
                            className="break-words whitespace-pre-wrap"
                          >
                            {result.output}
                          </DsText>
                        )}
                      </div>
                    );
                  })}
                </div>
              </details>
            )}
            {error && (
              <DsText role="base" aria-live="polite">
                {t('chat.session-agents-request-error')}
              </DsText>
            )}
          </div>
        </DialogContentSection>
      </DialogContent>
    </Dialog>
  );
}
