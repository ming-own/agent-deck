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

import { Button } from '@/components/ui/button';
import { DsIcon } from '@/components/ui/ds-icon';
import { DsText } from '@/components/ui/ds-text';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import type { ConfiguredModelChoice } from '@/lib/configuredModels';
import { defaultCardDesign } from '@/service/cardDesign';
import type {
  CardAgentConfig,
  SessionAgent,
  WorkshopTemplate,
  WorkshopTemplateDetail,
  sessionAgentApi,
} from '@/service/sessionAgentApi';
import { modelReference } from '@/service/sessionAgentModels';
import { ArrowLeft, Check } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CardAppearanceFields, CardPicker } from './CardAppearanceFields';
import { CardFace } from './CardFace';
import { SkillPicker } from './SkillPicker';
import { ToolPermissions } from './ToolPermissions';

export function CardDesigner({
  api,
  choices,
  template,
  sourceNode,
  onClose,
  onSaved,
  onBusyChange,
}: {
  api: ReturnType<typeof sessionAgentApi>;
  choices: ConfiguredModelChoice[];
  template?: WorkshopTemplateDetail;
  sourceNode?: SessionAgent;
  onClose: () => void;
  onSaved: (template: WorkshopTemplate) => void;
  onBusyChange?: (busy: boolean) => void;
}) {
  const { t } = useTranslation();
  const initial = sourceNode || template?.config;
  const [name, setName] = useState(
    template?.name || sourceNode?.name || t('chat.card-new-name')
  );
  const [design, setDesign] = useState(() =>
    defaultCardDesign(sourceNode?.card_design || template?.appearance)
  );
  const [config, setConfig] = useState<CardAgentConfig>(() => ({
    name: initial?.name || t('chat.card-new-name'),
    model: initial?.model || null,
    role: initial?.role || '',
    instructions: initial?.instructions || '',
    skill_ids: initial?.skill_ids || [],
    tool_policy: initial?.tool_policy || {},
    harness_id: initial?.harness_id || 'standard',
  }));
  const workforce = !!sourceNode?.workforce || template?.kind === 'workforce';
  const [tab, setTab] = useState('appearance'),
    [uploading, setUploading] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(false);
  const [saveMode, setSaveMode] = useState(
    template && !template.family.startsWith('builtin-') ? 'version' : 'fork'
  );
  const lock = useRef(false),
    gesture = useRef<{ key: string; id: string } | null>(null);
  const modelId = config.model?.id || 'later';
  const canVersion = !!template && !template.family.startsWith('builtin-');
  useEffect(() => {
    onBusyChange?.(busy || uploading);
    return () => onBusyChange?.(false);
  }, [busy, uploading, onBusyChange]);
  async function save() {
    if (lock.current || uploading || !name.trim() || !config.name.trim())
      return;
    lock.current = true;
    setBusy(true);
    setError(false);
    const body = {
      name: name.trim(),
      appearance: { ...design, title: design.title || name.trim() },
      ...(workforce
        ? sourceNode
          ? { node_id: sourceNode.id }
          : { copy_base: true }
        : { config }),
      ...(template
        ? { base_family: template.family, base_version: template.version }
        : {}),
      new_version: canVersion && saveMode === 'version',
    };
    const key = JSON.stringify(body);
    if (gesture.current?.key !== key)
      gesture.current = { key, id: crypto.randomUUID() };
    try {
      onSaved(
        await api.saveTemplate({ ...body, request_id: gesture.current.id })
      );
    } catch {
      setError(true);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  const update = (patch: Partial<CardAgentConfig>) =>
    setConfig((old) => ({ ...old, ...patch }));
  return (
    <Tabs
      value={tab}
      onValueChange={setTab}
      className="card-workshop card-workshop--designer"
    >
      <div className="flex shrink-0 items-center gap-ds-8 border-x-0 border-t-0 border-b border-solid border-ds-hairline-default-default p-ds-16">
        <Button
          variant="ghost"
          size="sm"
          buttonContent="icon-only"
          aria-label={t('chat.card-back-library')}
          onClick={onClose}
          disabled={busy}
        >
          <DsIcon icon={ArrowLeft} />
        </Button>
        <DsText
          as="h2"
          role="title"
          weight="semibold"
          className="min-w-0 flex-1 truncate"
        >
          {name}
        </DsText>
        <Button
          size="sm"
          onClick={() => void save()}
          disabled={busy || uploading || !name.trim() || !config.name.trim()}
        >
          <DsIcon icon={Check} />
          {t(busy ? 'chat.card-saving' : 'chat.card-save')}
        </Button>
      </div>
      <div className="shrink-0 px-ds-24">
        <TabsList appearance="border" aria-label={t('chat.card-designer')}>
          <TabsTrigger value="appearance" disabled={busy}>
            {t('chat.card-appearance')}
          </TabsTrigger>
          <TabsTrigger value="capability" disabled={busy}>
            {t('chat.card-capability')}
          </TabsTrigger>
        </TabsList>
      </div>
      <div className="card-workshop-body">
        <div className="card-design-stage scrollbar-always-visible">
          <DsText
            role="meta"
            className="card-design-caption text-ds-ink-muted-default"
          >
            {t('chat.card-same-face')}
          </DsText>
          <div className="card-design-preview">
            <CardFace
              design={design}
              name={name}
              description={config.role || config.instructions}
              model={config.model?.name}
              skills={config.skill_ids.length}
              workforce={workforce}
            />
          </div>
          <DsText
            role="meta"
            className="card-design-note text-ds-ink-muted-default"
          >
            {t('chat.card-appearance-independent')}
          </DsText>
        </div>
        <div className="card-design-properties scrollbar-always-visible">
          <TabsContent
            value="appearance"
            className="mt-0 flex flex-col gap-ds-16"
          >
            <Input
              title={t('chat.workshop-name')}
              aria-label={t('chat.workshop-name')}
              value={name}
              disabled={busy}
              maxLength={100}
              onChange={(e) => setName(e.target.value)}
            />
            <CardAppearanceFields
              onUploadingChange={setUploading}
              value={design}
              onChange={setDesign}
              disabled={busy}
            />
            {canVersion && (
              <CardPicker
                label={t('chat.card-save-as')}
                value={saveMode}
                disabled={busy}
                onChange={setSaveMode}
                items={[
                  { id: 'version', name: t('chat.workshop-version') },
                  { id: 'fork', name: t('chat.workshop-fork') },
                ]}
              />
            )}
          </TabsContent>
          <TabsContent value="capability" className="mt-0">
            {workforce ? (
              <DsText role="base">{t('chat.card-team-edit-help')}</DsText>
            ) : (
              <fieldset
                disabled={busy}
                className="m-0 flex min-w-0 flex-col gap-ds-16 border-0 border-x-0 border-y-0 p-0"
              >
                <Input
                  title={t('chat.session-agents-name')}
                  aria-label={t('chat.session-agents-name')}
                  value={config.name}
                  maxLength={100}
                  onChange={(e) => update({ name: e.target.value })}
                />
                <CardPicker
                  label={t('chat.session-agents-model')}
                  value={modelId}
                  items={[
                    { id: 'later', name: t('chat.card-model-later') },
                    ...(!choices.some((c) => c.id === modelId) && config.model
                      ? [
                          {
                            id: modelId,
                            name:
                              config.model.name +
                              ' · ' +
                              t('chat.card-model-unavailable'),
                          },
                        ]
                      : []),
                    ...choices.map((c) => ({
                      id: c.id,
                      name: c.name + ' · ' + c.group,
                    })),
                  ]}
                  onChange={(id) =>
                    update({
                      model: choices.find((c) => c.id === id)
                        ? modelReference(choices.find((c) => c.id === id)!)
                        : null,
                    })
                  }
                />
                <CardPicker
                  label={t('chat.node-harness')}
                  value={config.harness_id}
                  items={['standard', 'plan_execute'].map((id) => ({
                    id,
                    name: t('chat.node-harness-' + id.replace('_', '-')),
                  }))}
                  onChange={(harness_id) => update({ harness_id })}
                />
                <Input
                  title={t('chat.session-agents-role-label')}
                  aria-label={t('chat.session-agents-role-label')}
                  value={config.role}
                  maxLength={200}
                  onChange={(e) => update({ role: e.target.value })}
                />
                <Textarea
                  variant="outlined"
                  title={t('chat.session-agents-instructions-label')}
                  aria-label={t('chat.session-agents-instructions-label')}
                  value={config.instructions}
                  maxLength={12000}
                  rows={5}
                  onChange={(e) => update({ instructions: e.target.value })}
                />
                <SkillPicker
                  load={api.skills}
                  selected={config.skill_ids}
                  onChange={(skill_ids) => update({ skill_ids })}
                  disabled={busy}
                />
                <ToolPermissions
                  policy={config.tool_policy}
                  onChange={(tool_policy) => update({ tool_policy })}
                  disabled={busy}
                />
              </fieldset>
            )}
          </TabsContent>
        </div>
      </div>
      <div className="card-workshop-footer">
        {error ? (
          <DsText role="base" aria-live="assertive">
            {t('chat.card-save-error')}
          </DsText>
        ) : (
          <DsText role="meta" className="text-ds-ink-muted-default">
            {t('chat.card-template-independent')}
          </DsText>
        )}
      </div>
    </Tabs>
  );
}

export function InstanceCardDesigner({
  api,
  node,
  close,
  onSaved,
}: {
  api: ReturnType<typeof sessionAgentApi>;
  node: SessionAgent;
  close: () => void;
  onSaved: (node: SessionAgent) => void;
}) {
  const { t } = useTranslation();
  const [design, setDesign] = useState(() =>
    defaultCardDesign(node.card_design)
  );
  const [busy, setBusy] = useState(false),
    [uploading, setUploading] = useState(false),
    [error, setError] = useState(false);
  const lock = useRef(false);
  return (
    <div className="card-workshop card-workshop--designer">
      <div className="flex shrink-0 items-center gap-ds-8 border-x-0 border-t-0 border-b border-solid border-ds-hairline-default-default p-ds-16">
        <Button size="sm" variant="ghost" disabled={busy} onClick={close}>
          <DsIcon icon={ArrowLeft} />
          {t('chat.card-back-canvas')}
        </Button>
        <DsText role="title" className="min-w-0 flex-1 truncate">
          {t('chat.card-appearance')} · {node.name}
        </DsText>
        <Button
          size="sm"
          disabled={busy || uploading}
          onClick={async () => {
            if (lock.current || uploading) return;
            lock.current = true;
            setBusy(true);
            setError(false);
            try {
              onSaved(await api.updateCard(node, design));
            } catch {
              setError(true);
            } finally {
              lock.current = false;
              setBusy(false);
            }
          }}
        >
          <DsIcon icon={Check} />
          {t('chat.card-save-appearance')}
        </Button>
      </div>
      <div className="card-workshop-body">
        <div className="card-design-stage scrollbar-always-visible">
          <div className="card-design-preview">
            <CardFace
              design={design}
              name={node.name}
              description={node.role || node.instructions}
              model={node.model.name}
              skills={node.skill_ids.length}
              workforce={!!node.workforce}
            />
          </div>
          <DsText role="meta">{t('chat.card-appearance-independent')}</DsText>
        </div>
        <div className="card-design-properties scrollbar-always-visible">
          <CardAppearanceFields
            onUploadingChange={setUploading}
            value={design}
            onChange={setDesign}
            disabled={busy}
          />
        </div>
      </div>
      {error && (
        <div className="card-workshop-footer" role="alert">
          <DsText role="base">{t('chat.card-instance-save-error')}</DsText>
        </div>
      )}
    </div>
  );
}
