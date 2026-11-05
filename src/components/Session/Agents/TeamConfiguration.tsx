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
import { Textarea } from '@/components/ui/textarea';
import type {
  BatchTarget,
  SessionAgent,
  sessionAgentApi,
} from '@/service/sessionAgentApi';
import {
  ChevronRight,
  GitBranch,
  GitMerge,
  Plus,
  Settings2,
} from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

export function TeamConfiguration({
  node,
  nodes,
  api,
  edit,
  updated,
  save,
  working,
}: {
  node: SessionAgent;
  nodes: SessionAgent[];
  api: ReturnType<typeof sessionAgentApi>;
  edit: (n: SessionAgent, el: HTMLButtonElement) => void;
  updated: (n: SessionAgent) => void;
  save: () => void;
  working: (busy: boolean) => void;
}) {
  const { t } = useTranslation();
  const [route, setRoute] = useState(node.workforce!),
    [name, setName] = useState(node.name);
  const [error, setError] = useState(false),
    [busy, setBusy] = useState(false);
  const dirty =
    JSON.stringify(route) !== JSON.stringify(node.workforce) ||
    name !== node.name;
  const candidates = nodes.filter(
    (n) =>
      n.id !== node.id &&
      (!n.workforce_member ||
        [...node.workforce!.branches, node.workforce!.summary].some(
          (b) => b.agent_id === n.id
        ))
  );
  const write = async () => {
    if (busy) return;
    setBusy(true);
    working(true);
    setError(false);
    try {
      updated(await api.updateWorkforce(node, name.trim(), route));
    } catch {
      setError(true);
    } finally {
      setBusy(false);
      working(false);
    }
  };
  function fields(
    target: BatchTarget & { contains?: string },
    i: number,
    isSummary: boolean
  ) {
    const member = nodes.find((n) => n.id === target.agent_id);
    const patch = (v: Partial<typeof target>) =>
      setRoute((r) =>
        isSummary
          ? { ...r, summary: { ...r.summary, ...v } }
          : {
              ...r,
              branches: r.branches.map((b, k) =>
                k === i ? { ...b, ...v } : b
              ),
            }
      );
    return (
      <details
        key={isSummary ? 'summary' : i}
        className="group border-x-0 border-t-0 border-b border-solid border-ds-hairline-subtle-default"
      >
        <summary className="flex cursor-pointer list-none items-center gap-ds-control-gap rounded-ds-field py-ds-8 focus-visible:ring-2 focus-visible:ring-ds-ring-focus">
          <DsIcon icon={isSummary ? GitMerge : GitBranch} />
          <div className="flex min-w-0 flex-1 flex-col">
            <DsText
              as="span"
              role="base"
              weight="semibold"
              className="break-words"
            >
              {target.name}
            </DsText>
            <DsText
              role="meta"
              className="break-words text-ds-ink-muted-default"
            >
              {member?.name} · {member?.model.name}
              {target.contains
                ? ' · ' + t('chat.team-match', { word: target.contains })
                : ''}
            </DsText>
          </div>
          <DsIcon icon={ChevronRight} className="group-open:rotate-90" />
        </summary>
        <div className="flex min-w-0 flex-col gap-ds-control-gap pb-ds-12">
          <Select
            value={target.agent_id}
            onValueChange={(agent_id) => patch({ agent_id })}
          >
            <SelectTrigger
              size="sm"
              title={t('chat.session-agents-select')}
              aria-label={t('chat.session-agents-select')}
              wrapperClassName="min-w-0"
              className="w-full"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent fitTrigger>
              {candidates.map((n) => (
                <SelectItem key={n.id} value={n.id}>
                  {n.name} · {n.model.name}
                  {n.template_version ? ' · v' + n.template_version : ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            size="sm"
            title={t('chat.node-task-name')}
            aria-label={t('chat.node-task-name')}
            value={target.name}
            maxLength={100}
            onChange={(e) => patch({ name: e.target.value })}
          />
          {!isSummary && (
            <Input
              size="sm"
              title={t('chat.batch-contains')}
              aria-label={t('chat.batch-contains')}
              value={target.contains}
              maxLength={200}
              onChange={(e) => patch({ contains: e.target.value })}
            />
          )}
          <Textarea
            size="sm"
            variant="outlined"
            title={t('chat.session-agents-instructions')}
            aria-label={t('chat.session-agents-instructions')}
            rows={2}
            maxLength={4000}
            value={target.instructions}
            onChange={(e) => patch({ instructions: e.target.value })}
          />
          <div className="flex flex-wrap items-center justify-between gap-ds-control-gap">
            <Button
              size="sm"
              variant="secondary"
              disabled={!member}
              onClick={(e) => member && edit(member, e.currentTarget)}
            >
              <DsIcon icon={Settings2} />
              {t('chat.session-agents-edit')}
            </Button>
            {!isSummary && (
              <Button
                size="sm"
                variant="text"
                disabled={route.branches.length <= 1}
                onClick={() =>
                  setRoute((r) => ({
                    ...r,
                    branches: r.branches.filter((_, k) => i !== k),
                  }))
                }
              >
                {t('chat.batch-remove')}
              </Button>
            )}
          </div>
        </div>
      </details>
    );
  }
  return (
    <fieldset
      disabled={busy}
      className="m-0 flex min-w-0 flex-col gap-ds-stack-related border-x-0 border-y-0 p-0"
    >
      <Input
        size="sm"
        title={t('chat.session-agents-name')}
        aria-label={t('chat.session-agents-name')}
        value={name}
        onChange={(e) => setName(e.target.value)}
        maxLength={100}
      />
      <section>
        <div className="flex flex-wrap items-center justify-between gap-ds-control-gap">
          <DsText as="h3" role="base" weight="semibold">
            {t('chat.batch-tab')}
          </DsText>
          <Button
            size="xs"
            variant="ghost"
            disabled={route.branches.length >= 8 || !candidates.length}
            onClick={() =>
              setRoute((r) => ({
                ...r,
                branches: [
                  ...r.branches,
                  {
                    agent_id: candidates[0].id,
                    name: t('chat.batch-branch', { n: r.branches.length + 1 }),
                    instructions: '',
                    contains: '',
                  },
                ],
              }))
            }
          >
            <DsIcon icon={Plus} recipe="main-compact" />
            {t('chat.batch-add')}
          </Button>
        </div>
        {route.branches.map((b, i) => fields(b, i, false))}
      </section>
      <section>
        <DsText as="h3" role="base" weight="semibold">
          {t('chat.batch-summary')}
        </DsText>
        {fields(route.summary, -1, true)}
      </section>
      <Select
        value={route.join}
        onValueChange={(v: typeof route.join) =>
          setRoute((r) => ({ ...r, join: v }))
        }
      >
        <SelectTrigger
          size="sm"
          title={t('chat.batch-rule')}
          aria-label={t('chat.batch-rule')}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent fitTrigger>
          {(['all_success', 'all_finished'] as const).map((v) => (
            <SelectItem key={v} value={v}>
              {t('chat.batch-' + v)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {error && <div role="alert">{t('chat.batch-conflict')}</div>}
      <div className="flex flex-wrap items-center justify-between gap-ds-control-gap">
        <Button size="sm" variant="text" disabled={dirty} onClick={save}>
          {t('chat.workshop-save')}
        </Button>
        <Button
          size="sm"
          disabled={
            !dirty ||
            !name.trim() ||
            [...route.branches, route.summary].some((b) => !b.name.trim())
          }
          onClick={() => void write()}
        >
          {t('chat.session-agents-save')}
        </Button>
      </div>
    </fieldset>
  );
}
