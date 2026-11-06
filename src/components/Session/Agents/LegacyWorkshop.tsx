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
import {
  Dialog,
  DialogContent,
  DialogContentSection,
  DialogHeader,
} from '@/components/ui/dialog';
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
import type { ConfiguredModelChoice } from '@/lib/configuredModels';
import type {
  BatchReceipt,
  SessionAgent,
  WorkshopTemplate,
  sessionAgentApi,
} from '@/service/sessionAgentApi';
import { modelReference } from '@/service/sessionAgentModels';
import { useSpaceStore } from '@/store/spaceStore';
import { Bot, Check, Workflow } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

function Picker({
  label,
  value,
  change,
  items,
}: {
  label: string;
  value: string;
  change: (v: string) => void;
  items: { id: string; name: string }[];
}) {
  return (
    <Select value={value} onValueChange={change}>
      <SelectTrigger
        title={label}
        aria-label={label}
        wrapperClassName="min-w-0"
        className="w-full"
        size="sm"
      >
        <SelectValue placeholder={label} />
      </SelectTrigger>
      <SelectContent fitTrigger>
        {items.map((i) => (
          <SelectItem key={i.id} value={i.id}>
            {i.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function LegacyWorkshop({
  api,
  choices,
  onClose,
  onInstalled,
  projectId,
  beforeInstall,
  initialNode,
}: {
  api: ReturnType<typeof sessionAgentApi>;
  choices: ConfiguredModelChoice[];
  onClose: () => void;
  projectId: string;
  beforeInstall: () => Promise<void>;
  onInstalled: (node: SessionAgent) => void;
  initialNode?: SessionAgent;
}) {
  const { t } = useTranslation();
  const sessionName = useSpaceStore((s) => s.getProjectMeta(projectId)?.name);
  const [tab, setTab] = useState(initialNode ? 'save' : 'library');
  const [templates, setTemplates] = useState<WorkshopTemplate[]>([]),
    [nodes, setNodes] = useState<SessionAgent[]>([]),
    [batches, setBatches] = useState<BatchReceipt[]>([]);
  const [target, setTarget] = useState(''),
    [model, setModel] = useState(choices[0]?.id ?? ''),
    [source, setSource] = useState(initialNode?.id ?? ''),
    [name, setName] = useState(initialNode?.name ?? ''),
    [mode, setMode] = useState('fork');
  const [loaded, setLoaded] = useState(false),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [epoch, setEpoch] = useState(0);
  const gesture = useRef<{ key: string; id: string } | null>(null),
    lock = useRef(false);
  useEffect(() => {
    let live = true;
    setLoaded(false);
    Promise.all([api.templates(), api.list(), api.batches()])
      .then(([items, ns, bs]) => {
        if (!live) return;
        setTemplates(items);
        setNodes(ns);
        setBatches(bs);
        setTarget((old) => old || items[0]?.family + '@' + items[0]?.version);
        setLoaded(true);
        setError('');
      })
      .catch(() => {
        if (live) setError('chat.session-agents-load-error');
      });
    return () => {
      live = false;
    };
  }, [api, epoch]);
  const selected = templates.find((v) => v.family + '@' + v.version === target),
    node = nodes.find((n) => n.id === source);
  const batch = batches.find((b) => 'batch:' + b.event_id === source);
  const modelChoice = choices.find((c) => c.id === model);
  const needsModel = selected?.needs_model ?? !!selected?.builtin;
  const sources = [
    ...nodes.map((n) => ({ id: n.id, name: n.name })),
    ...batches.map((b) => ({
      id: 'batch:' + b.event_id,
      name: t('chat.route-node') + ' · ' + b.spec.message.slice(0, 70),
    })),
  ];
  const canVersion =
    node?.template_family && !node.template_family.startsWith('builtin-');
  async function submit() {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      if (tab === 'library' && selected) {
        const key = JSON.stringify([target, model]);
        if (gesture.current?.key !== key)
          gesture.current = { key, id: crypto.randomUUID() };
        await beforeInstall();
        const installed = await api.installTemplate({
          family: selected.family,
          version: selected.version,
          instance_id: gesture.current.id,
          model: needsModel && modelChoice ? modelReference(modelChoice) : null,
        });
        onInstalled(installed);
        onClose();
      } else if (tab === 'save' && (node || batch)) {
        const key = JSON.stringify(['save', source, name, mode]);
        if (gesture.current?.key !== key)
          gesture.current = { key, id: crypto.randomUUID() };
        const saved = await api.saveTemplate({
          request_id: gesture.current.id,
          name: name.trim(),
          ...(batch
            ? {
                route: {
                  branches: batch.spec.branches,
                  summary: batch.spec.summary,
                  join: batch.spec.join,
                },
              }
            : { node_id: node!.id }),
          new_version: !!canVersion && mode === 'version',
        });
        gesture.current = null;
        setTarget(saved.family + '@' + saved.version);
        setTab('library');
        setEpoch((n) => n + 1);
      }
    } catch {
      setError('chat.session-agents-save-error');
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  const base = templates.find(
    (v) =>
      v.family === selected?.base_family && v.version === selected.base_version
  );
  return (
    <Dialog
      open
      onOpenChange={(v) => {
        if (!v && !busy) onClose();
      }}
    >
      <DialogContent
        size="md"
        overlayVariant="dimmed"
        aria-describedby={undefined}
        showCloseButton={!busy}
      >
        <DialogHeader title={t('chat.workshop')} subtitle={sessionName} />
        <DialogContentSection className="scrollbar-always-visible pt-0">
          <div className="flex min-w-0 flex-col gap-ds-stack-related">
            <Tabs
              value={tab}
              onValueChange={(v) => {
                setTab(v);
                setError('');
              }}
            >
              <TabsList appearance="border" aria-label={t('chat.workshop')}>
                <TabsTrigger value="library" disabled={busy}>
                  {t('chat.workshop-library')}
                </TabsTrigger>
                <TabsTrigger value="save" disabled={busy}>
                  {t('chat.workshop-save')}
                </TabsTrigger>
              </TabsList>
              <TabsContent value={tab} className="pt-ds-8">
                {!loaded && !error && (
                  <DsText role="base">
                    {t('chat.session-agents-loading')}
                  </DsText>
                )}
                {loaded && (
                  <fieldset
                    disabled={busy}
                    className="m-0 flex min-w-0 flex-col gap-ds-control-gap border-x-0 border-y-0 p-0"
                  >
                    {tab === 'library' ? (
                      <>
                        <div
                          role="group"
                          aria-label={t('chat.workshop-library')}
                          className="flex flex-col gap-ds-4"
                        >
                          {templates.map((v) => {
                            const id = v.family + '@' + v.version;
                            const active = target === id;
                            return (
                              <Button
                                key={id}
                                size="md"
                                variant={active ? 'secondary' : 'ghost'}
                                className="w-full justify-start"
                                aria-pressed={active}
                                onClick={() => setTarget(id)}
                              >
                                <DsIcon
                                  icon={v.kind === 'workforce' ? Workflow : Bot}
                                />
                                <span
                                  className="min-w-0 flex-1 truncate text-left"
                                  title={v.name}
                                >
                                  {v.name}
                                </span>
                                <DsText
                                  role="meta"
                                  className="text-ds-ink-muted-default"
                                >
                                  v{v.version}
                                </DsText>
                                {active && <DsIcon icon={Check} />}
                              </Button>
                            );
                          })}
                        </div>
                        {selected && (
                          <DsText
                            role="meta"
                            className="text-ds-ink-muted-default"
                          >
                            {selected.kind === 'workforce'
                              ? 'Workforce'
                              : 'Agent'}{' '}
                            ·{' '}
                            {t(
                              selected.builtin
                                ? 'chat.workshop-built-in'
                                : 'chat.workshop-custom'
                            )}
                            {base &&
                              ' · ' +
                                t('chat.workshop-from') +
                                ' ' +
                                base.name +
                                ' v' +
                                base.version}
                          </DsText>
                        )}
                        {needsModel && (
                          <Picker
                            label={t('chat.session-agents-model')}
                            value={model}
                            change={setModel}
                            items={choices}
                          />
                        )}
                      </>
                    ) : (
                      <>
                        <Picker
                          label={t('chat.workshop-source')}
                          value={source}
                          change={(v) => {
                            setSource(v);
                            setName(nodes.find((n) => n.id === v)?.name ?? '');
                            setMode('fork');
                          }}
                          items={sources}
                        />
                        <Input
                          title={t('chat.workshop-name')}
                          aria-label={t('chat.workshop-name')}
                          placeholder={t('chat.workshop-name')}
                          maxLength={100}
                          value={name}
                          onChange={(e) => setName(e.target.value)}
                        />
                        {canVersion && (
                          <Picker
                            label={t('chat.workshop-save')}
                            value={mode}
                            change={setMode}
                            items={[
                              { id: 'fork', name: t('chat.workshop-fork') },
                              {
                                id: 'version',
                                name: t('chat.workshop-version'),
                              },
                            ]}
                          />
                        )}
                        {(node?.workforce || batch) && (
                          <DsText
                            role="meta"
                            className="text-ds-ink-muted-default"
                          >
                            {(node?.workforce ?? batch!.spec).branches
                              .map((b) => b.name)
                              .join(' / ')}{' '}
                            → {(node?.workforce ?? batch!.spec).summary.name}
                          </DsText>
                        )}
                      </>
                    )}
                    <div className="flex justify-end">
                      <Button
                        size="sm"
                        disabled={
                          busy ||
                          (tab === 'library'
                            ? !selected || (needsModel && !modelChoice)
                            : !name.trim() || (!node && !batch))
                        }
                        onClick={() => void submit()}
                      >
                        {t(
                          tab === 'library'
                            ? 'chat.workshop-install'
                            : 'chat.workshop-save'
                        )}
                      </Button>
                    </div>
                  </fieldset>
                )}
                {error && (
                  <div role="alert">
                    <DsText role="base">{t(error)}</DsText>
                    {!loaded && (
                      <Button
                        size="xs"
                        variant="text"
                        onClick={() => setEpoch((n) => n + 1)}
                      >
                        {t('chat.session-agents-retry')}
                      </Button>
                    )}
                  </div>
                )}
              </TabsContent>
            </Tabs>
          </div>
        </DialogContentSection>
      </DialogContent>
    </Dialog>
  );
}
