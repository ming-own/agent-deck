import {
  TrialAction,
  TrialResult,
} from '@/components/Session/Agents/CanvasTrial';
import { Button } from '@/components/ui/button';
import { DsIcon } from '@/components/ui/ds-icon';
import { DsText } from '@/components/ui/ds-text';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import {
  ArrowUpRight,
  Bot,
  Brain,
  ChevronDown,
  ChevronRight,
  Clock3,
  FileText,
  Folder,
  ListTodo,
  Settings2,
  Sparkles,
  Workflow,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { GraphNode } from './graphModel';
export const kindIcons = {
  session: Folder,
  agent: Bot,
  task: ListTodo,
  automation: Clock3,
  context: FileText,
  memory: Brain,
  settings: Settings2,
};
export function WorkspaceObjectNode({ data, selected }: NodeProps<GraphNode>) {
  const { item, open } = data,
    { t } = useTranslation();
  const a = item.agent;
  if (item.kind === 'agent' && a)
    return (
      <div
        className={`flex h-full flex-col rounded-ds-card border border-x border-y border-solid bg-ds-neutral-subtle-default p-ds-6 ${selected ? 'border-ds-accent-strong-default' : 'border-ds-hairline-default-default'}`}
      >
        <Handle type="target" position={Position.Left} />
        <Handle type="source" position={Position.Right} />
        <div className="flex h-full min-h-0 flex-col gap-ds-8 rounded-ds-field border border-x border-y border-solid border-ds-hairline-default-default p-ds-12">
          <div className="flex items-center justify-between gap-ds-6">
            <DsText role="meta" className="text-ds-ink-muted-default">
              {a.workforce ? 'Workforce' : 'Agent'}
            </DsText>
            <DsIcon
              icon={a.workforce ? Workflow : Sparkles}
              recipe="main-compact"
              className="text-ds-ink-muted-default"
            />
          </div>
          <Button
            variant="text"
            size="sm"
            className="nodrag nopan min-w-0 justify-start"
            onClick={() => open(item)}
            title={a.name}
          >
            <DsText role="body-large" weight="semibold" className="truncate">
              {a.name}
            </DsText>
          </Button>
          <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-ds-field bg-ds-neutral-muted-default">
            <svg
              aria-hidden="true"
              viewBox="0 0 200 100"
              className="absolute h-full w-full text-ds-hairline-default-default"
              fill="none"
              stroke="currentColor"
            >
              <circle cx="100" cy="50" r="38" />
              <circle cx="100" cy="50" r="30" />
              <path d="M100 5 145 50 100 95 55 50Z M8 50H48 M152 50H192 M100 0V12 M100 88V100" />
            </svg>
            <DsText
              role="display"
              weight="semibold"
              className="relative text-ds-ink-muted-default"
            >
              {a.name.trim().slice(0, 1)}
            </DsText>
          </div>
          <DsText
            role="meta"
            className="line-clamp-2"
            title={a.role || a.instructions}
          >
            {a.role || a.instructions || t('chat.session-agents-default-role')}
          </DsText>
          <div className="flex items-center justify-between gap-ds-6 border-x-0 border-t border-b-0 border-solid border-ds-hairline-default-default pt-ds-8">
            <DsText
              role="meta"
              className="min-w-0 truncate text-ds-ink-muted-default"
              title={a.model.name}
            >
              {a.model.name}
            </DsText>
            <DsText role="meta" className="shrink-0 text-ds-ink-muted-default">
              {a.skill_ids.length} Skills
            </DsText>
          </div>
          <div className="flex items-center gap-ds-6">
            <TrialResult
              project={a.projectId}
              agent={a}
              latestRun={item.latestTask?.last_run}
              onLatestRun={() =>
                open({
                  ...item,
                  kind: 'task',
                  id: a.id + ':' + item.latestTask!.id,
                  task: item.latestTask,
                })
              }
            >
              <span className="flex-1" />
            </TrialResult>
            <TrialAction project={a.projectId} agent={a} />
          </div>
        </div>
      </div>
    );
  return (
    <div
      className={`flex h-full flex-col justify-center gap-ds-8 rounded-ds-panel border border-x border-y border-solid bg-ds-neutral-subtle-default p-ds-12 ${selected ? 'border-ds-accent-strong-default' : 'border-ds-hairline-default-default'}`}
    >
      {item.kind !== 'settings' && (
        <Handle type="target" position={Position.Left} />
      )}
      {['context', 'memory', 'automation'].includes(item.kind) && (
        <Handle type="source" position={Position.Right} />
      )}
      <div className="flex items-center gap-ds-control-gap">
        <DsIcon
          icon={kindIcons[item.kind]}
          className="text-ds-ink-muted-default"
        />
        <DsText role="meta" className="text-ds-ink-muted-default">
          {t('chat.workspace-' + item.kind)}
        </DsText>
      </div>
      <Button
        variant="text"
        size="sm"
        className="nodrag nopan min-w-0 justify-start"
        onClick={() => open(item)}
        title={item.name}
      >
        <DsText role="base" weight="semibold" className="truncate">
          {item.kind === 'task' && item.name === 'default'
            ? t('chat.node-task-default')
            : item.name}
        </DsText>
      </Button>
      {item.description && (
        <DsText
          role="meta"
          className="line-clamp-2 text-ds-ink-muted-default"
          title={item.description}
        >
          {item.description}
        </DsText>
      )}
    </div>
  );
}
export function WorkspaceSessionNode({ data }: NodeProps<GraphNode>) {
  const { t } = useTranslation(),
    { item, expanded, toggle, open } = data;
  return (
    <div className="h-full rounded-ds-panel border border-x border-y border-dashed border-ds-hairline-default-default bg-ds-neutral-muted-default">
      <Handle type="target" position={Position.Left} />
      <div className="flex items-center gap-ds-control-gap p-ds-16">
        <Button
          className="nodrag nopan shrink-0"
          size="sm"
          variant="ghost"
          buttonContent="icon-only"
          aria-label={t('chat.workspace-expand') + ' · ' + item.name}
          aria-expanded={expanded}
          onClick={() => toggle?.(item.id)}
        >
          <DsIcon icon={expanded ? ChevronDown : ChevronRight} />
        </Button>
        <DsIcon icon={Folder} />
        <DsText
          role="body-large"
          weight="semibold"
          className="min-w-0 flex-1 truncate"
          title={item.name}
        >
          {item.name}
        </DsText>
        <Button
          className="nodrag nopan"
          size="sm"
          variant="ghost"
          buttonContent="icon-only"
          aria-label={t('chat.workspace-open') + ' · ' + item.name}
          onClick={() => open(item)}
        >
          <DsIcon icon={ArrowUpRight} />
        </Button>
      </div>
    </div>
  );
}
