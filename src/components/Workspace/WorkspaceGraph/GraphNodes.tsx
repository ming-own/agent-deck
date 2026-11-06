// ========= Copyright 2025-2026 @ Eigent.ai All Rights Reserved. =========
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
// ========= Copyright 2025-2026 @ Eigent.ai All Rights Reserved. =========

import {
  TrialAction,
  TrialResult,
} from '@/components/Session/Agents/CanvasTrial';
import { CardFace } from '@/components/Session/Agents/CardFace';
import { Button } from '@/components/ui/button';
import { DsIcon } from '@/components/ui/ds-icon';
import { DsText } from '@/components/ui/ds-text';
import { DS_FOCUS_RING } from '@/components/ui/semanticProps';
import {
  Handle,
  Position,
  useNodeId,
  useUpdateNodeInternals,
  useViewport,
  type NodeProps,
} from '@xyflow/react';
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
} from 'lucide-react';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import './connectionPorts.css';
import type { GraphNode } from './graphModel';

function ConnectionPort({
  type,
  name,
}: {
  type: 'source' | 'target';
  name: string;
}) {
  const { t } = useTranslation(),
    { zoom } = useViewport(),
    nodeId = useNodeId(),
    updateNodeInternals = useUpdateNodeInternals();
  // Keep the hit target in screen pixels, and update React Flow's snap bounds
  // when zoom changes without changing the card's world-space geometry.
  useEffect(() => {
    if (nodeId) updateNodeInternals(nodeId);
  }, [nodeId, zoom, updateNodeInternals]);
  const label =
    t(
      type === 'source'
        ? 'chat.workspace-port-output'
        : 'chat.workspace-port-input'
    ) +
    ' · ' +
    name;
  return (
    <Handle
      type={type}
      position={type === 'source' ? Position.Right : Position.Left}
      className={'workspace-connection-port ' + DS_FOCUS_RING}
      style={{
        transform: `translate(${type === 'source' ? '50%' : '-50%'}, -50%) scale(${1 / zoom})`,
      }}
      role="button"
      tabIndex={0}
      aria-label={label}
      title={label + ' — ' + t('chat.workspace-connect-help')}
      data-port-direction={type}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          event.stopPropagation();
          event.currentTarget.click();
        }
      }}
    >
      <span
        aria-hidden="true"
        className="workspace-connection-dot pointer-events-none rounded-full border border-x border-y border-solid border-ds-ink-muted-default bg-ds-neutral-subtle-default"
      />
    </Handle>
  );
}
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
        className={
          'h-full w-full rounded-ds-field ' +
          (selected ? 'ring-2 ring-ds-ring-focus' : '')
        }
      >
        <CardFace
          design={a.card_design}
          name={a.name}
          description={a.role || a.instructions}
          model={a.model.name}
          skills={a.skill_ids.length}
          workforce={!!a.workforce}
          footer={
            <>
              <Button
                variant="text"
                size="xs"
                className="nodrag nopan"
                onClick={() => open(item)}
                aria-label={t('chat.card-configure') + ' · ' + a.name}
              >
                {t('chat.card-configure')}
              </Button>
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
            </>
          }
        >
          <ConnectionPort type="target" name={a.name} />
          <ConnectionPort type="source" name={a.name} />
        </CardFace>
      </div>
    );
  return (
    <div
      className={`flex h-full flex-col justify-center gap-ds-8 rounded-ds-panel border border-x border-y border-solid bg-ds-neutral-subtle-default p-ds-12 ${selected ? 'border-ds-accent-strong-default' : 'border-ds-hairline-default-default'}`}
    >
      {item.kind === 'task' && (
        <Handle
          type="target"
          position={Position.Left}
          isConnectable={false}
          isConnectableStart={false}
          isConnectableEnd={false}
          aria-hidden="true"
        />
      )}
      {['context', 'memory', 'automation'].includes(item.kind) && (
        <ConnectionPort type="source" name={item.name} />
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
      <Handle
        type="target"
        position={Position.Left}
        isConnectable={false}
        isConnectableStart={false}
        isConnectableEnd={false}
        aria-hidden="true"
      />
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
