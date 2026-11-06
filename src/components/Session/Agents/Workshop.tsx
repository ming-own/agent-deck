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
import { Dialog, DialogContent, DialogHeader } from '@/components/ui/dialog';
import { DsIcon } from '@/components/ui/ds-icon';
import { DsText } from '@/components/ui/ds-text';
import { Input } from '@/components/ui/input';
import { DS_FOCUS_RING } from '@/components/ui/semanticProps';
import type { ConfiguredModelChoice } from '@/lib/configuredModels';
import type {
  SessionAgent,
  WorkshopTemplate,
  WorkshopTemplateDetail,
  sessionAgentApi,
} from '@/service/sessionAgentApi';
import { modelReference } from '@/service/sessionAgentModels';
import { useSpaceStore } from '@/store/spaceStore';
import { ArrowLeft, Copy, Pencil, Plus } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CardPicker } from './CardAppearanceFields';
import { CardDesigner } from './CardDesigner';
import { CardFace } from './CardFace';
import { LegacyWorkshop } from './LegacyWorkshop';

export function Workshop({
  api,
  choices,
  onClose,
  onInstalled,
  projectId,
  beforeInstall,
  initialNode,
  embedded = false,
  sessions,
  resolveApi,
  createSession,
}: {
  api: ReturnType<typeof sessionAgentApi>;
  choices: ConfiguredModelChoice[];
  onClose: () => void;
  projectId: string;
  beforeInstall: () => Promise<void>;
  onInstalled: (node: SessionAgent, projectId: string) => void;
  initialNode?: SessionAgent;
  embedded?: boolean;
  sessions?: { id: string; name: string }[];
  resolveApi?: (projectId: string) => ReturnType<typeof sessionAgentApi>;
  createSession?: (name: string, id: string) => Promise<string>;
}) {
  const { t } = useTranslation();
  const sessionName = useSpaceStore((s) => s.getProjectMeta(projectId)?.name);
  const destinations = sessions ?? [
    { id: projectId, name: sessionName || projectId },
  ];
  const [templates, setTemplates] = useState<WorkshopTemplate[]>([]),
    [target, setTarget] = useState('');
  const [detail, setDetail] = useState<WorkshopTemplateDetail | null>(null);
  const [loading, setLoading] = useState(true),
    [error, setError] = useState(false),
    [detailError, setDetailError] = useState(false);
  const [busy, setBusy] = useState(false),
    [editorBusy, setEditorBusy] = useState(false),
    [installError, setInstallError] = useState(false),
    [epoch, setEpoch] = useState(0);
  const [draft, setDraft] = useState<{
    template?: WorkshopTemplateDetail;
    node?: SessionAgent;
  } | null>(initialNode ? { node: initialNode } : null);
  const [legacy, setLegacy] = useState(false),
    [query, setQuery] = useState(''),
    [filter, setFilter] = useState('all');
  const [destination, setDestination] = useState(
    destinations.some((s) => s.id === projectId)
      ? projectId
      : destinations[0]?.id || '__new__'
  );
  const [sessionTitle, setSessionTitle] = useState(t('chat.card-new-session'));
  const [model, setModel] = useState(choices[0]?.id || '');
  const lock = useRef(false),
    gesture = useRef<{
      key: string;
      id: string;
      project?: string;
      newProject?: string;
    } | null>(null);
  const selected = templates.find((v) => `${v.family}@${v.version}` === target);
  useEffect(() => {
    let live = true;
    setLoading(true);
    setError(false);
    api
      .templates()
      .then((items) => {
        if (!live) return;
        setTemplates(items);
        setTarget((old) =>
          items.some((i) => `${i.family}@${i.version}` === old)
            ? old
            : items[0]
              ? `${items[0].family}@${items[0].version}`
              : ''
        );
      })
      .catch(() => {
        if (live) setError(true);
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [api, epoch]);
  useEffect(() => {
    let live = true;
    setDetail(null);
    setDetailError(false);
    if (selected)
      api
        .template(selected.family, selected.version)
        .then((d) => {
          if (live) setDetail(d);
        })
        .catch(() => {
          if (live) setDetailError(true);
        });
    return () => {
      live = false;
    };
  }, [api, selected, epoch]);
  const latest = Array.from(
    new Map(
      [...templates]
        .sort((a, b) => a.version - b.version)
        .map((v) => [v.family, v])
    ).values()
  );
  const shown = latest
    .map((v) => (v.family === selected?.family ? selected : v))
    .filter(
      (v) =>
        (filter === 'all' || v.kind === filter) &&
        [v.name, v.appearance?.title]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
          .includes(query.toLowerCase())
    );
  const needsModel = selected?.needs_model ?? !!selected?.builtin;
  const choice = choices.find((c) => c.id === model);
  async function install() {
    if (!selected || lock.current || (needsModel && !choice)) return;
    lock.current = true;
    setBusy(true);
    setInstallError(false);
    const key = JSON.stringify([target, model, destination, sessionTitle]);
    if (gesture.current?.key !== key)
      gesture.current = { key, id: crypto.randomUUID() };
    try {
      await beforeInstall();
      let scope = gesture.current.project;
      if (!scope) {
        if (destination === '__new__') {
          if (!createSession || !sessionTitle.trim())
            throw new Error('Session required');
          gesture.current.newProject ??=
            'project_' + crypto.randomUUID().replaceAll('-', '');
          scope = await createSession(
            sessionTitle.trim(),
            gesture.current.newProject
          );
        } else scope = destination;
        gesture.current.project = scope;
      }
      const installed = await (
        resolveApi ? resolveApi(scope) : api
      ).installTemplate({
        family: selected.family,
        version: selected.version,
        instance_id: gesture.current.id,
        model: needsModel && choice ? modelReference(choice) : null,
      });
      onInstalled(installed, scope);
      onClose();
    } catch {
      setInstallError(true);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  const content = draft ? (
    <CardDesigner
      onBusyChange={setEditorBusy}
      api={api}
      choices={choices}
      template={draft.template}
      sourceNode={draft.node}
      onClose={() => setDraft(null)}
      onSaved={(saved) => {
        setTarget(`${saved.family}@${saved.version}`);
        setDraft(null);
        setQuery('');
        setFilter('all');
        setEpoch((n) => n + 1);
      }}
    />
  ) : (
    <div className="card-workshop">
      <div className="flex shrink-0 flex-wrap items-center gap-ds-8 border-x-0 border-t-0 border-b border-solid border-ds-hairline-default-default p-ds-16">
        <Button
          variant="ghost"
          size="sm"
          buttonContent="icon-only"
          aria-label={t('chat.card-back-canvas')}
          disabled={busy}
          onClick={onClose}
        >
          <DsIcon icon={ArrowLeft} />
        </Button>
        <DsText
          as="h1"
          role="title"
          weight="semibold"
          className="min-w-0 flex-1"
        >
          {t('chat.workshop')}
        </DsText>
        <Button
          variant="ghost"
          size="sm"
          disabled={busy}
          onClick={() => setLegacy(true)}
        >
          <DsIcon icon={Copy} />
          {t('chat.card-from-node')}
        </Button>
        <Button size="sm" disabled={busy} onClick={() => setDraft({})}>
          <DsIcon icon={Plus} />
          {t('chat.card-new')}
        </Button>
      </div>
      <div className="card-workshop-body">
        <div className="card-library-main scrollbar-always-visible">
          <DsText as="h2" role="page" weight="semibold">
            {t('chat.card-library')}
          </DsText>
          <DsText
            as="p"
            role="base"
            className="mt-ds-6 mb-ds-20 text-ds-ink-muted-default"
          >
            {t('chat.card-library-help')}
          </DsText>
          <div className="mb-ds-20 flex flex-wrap items-center gap-ds-8">
            {['all', 'agent', 'workforce'].map((kind) => (
              <Button
                key={kind}
                size="sm"
                variant={filter === kind ? 'secondary' : 'ghost'}
                disabled={busy}
                aria-pressed={filter === kind}
                onClick={() => setFilter(kind)}
              >
                {t('chat.card-filter-' + kind)}
              </Button>
            ))}
            <div className="min-w-0 flex-1">
              <Input
                size="sm"
                aria-label={t('chat.card-search')}
                placeholder={t('chat.card-search')}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
          </div>
          {loading && (
            <DsText role="base">{t('chat.session-agents-loading')}</DsText>
          )}
          {error && (
            <div role="alert">
              <DsText role="base">{t('chat.session-agents-load-error')}</DsText>
              <Button
                size="sm"
                variant="text"
                onClick={() => setEpoch((n) => n + 1)}
              >
                {t('chat.session-agents-retry')}
              </Button>
            </div>
          )}
          {!loading && !error && (
            <div className="card-library-grid">
              {shown.map((v) => (
                <button
                  type="button"
                  key={v.family}
                  disabled={busy}
                  className={'card-library-item ' + DS_FOCUS_RING}
                  aria-label={
                    v.appearance?.title && v.appearance.title !== v.name
                      ? v.appearance.title + ' · ' + v.name
                      : v.name
                  }
                  aria-pressed={v.family === selected?.family}
                  onClick={() => {
                    setTarget(`${v.family}@${v.version}`);
                    setInstallError(false);
                  }}
                >
                  <CardFace
                    design={
                      v.appearance || {
                        artwork: v.kind === 'workforce' ? 'crab' : 'dragon',
                      }
                    }
                    name={v.name}
                    model={v.preview?.model_name}
                    skills={v.preview?.skill_count}
                    description={v.preview?.description}
                    workforce={v.kind === 'workforce'}
                  />
                  <div className="mt-ds-12 flex justify-between gap-ds-8 text-ds-ink-muted-default">
                    <DsText role="meta">
                      {t(
                        v.builtin
                          ? 'chat.workshop-built-in'
                          : 'chat.workshop-custom'
                      )}
                    </DsText>
                    <DsText role="meta">v{v.version}</DsText>
                  </div>
                </button>
              ))}
            </div>
          )}
          {!loading && !error && !shown.length && (
            <DsText role="base">{t('chat.card-no-results')}</DsText>
          )}
        </div>
        {selected && (
          <aside className="card-library-detail scrollbar-always-visible">
            <DsText role="meta" className="text-ds-ink-muted-default">
              {t('chat.card-details')}
            </DsText>
            <DsText as="h2" role="title" weight="semibold">
              {selected.name}
            </DsText>
            <DsText role="meta">
              {t('chat.card-category-agent')} ·{' '}
              {selected.kind === 'workforce' ? 'Workforce' : 'Agent'}
            </DsText>
            <DsText role="base" className="text-ds-ink-muted-default">
              {detail?.appearance?.summary ||
                detail?.config.role ||
                t('chat.card-template-independent')}
            </DsText>
            {detailError && (
              <div role="alert">
                <DsText role="base">
                  {t('chat.session-agents-load-error')}
                </DsText>
                <Button
                  size="sm"
                  variant="text"
                  onClick={() => setEpoch((n) => n + 1)}
                >
                  {t('chat.session-agents-retry')}
                </Button>
              </div>
            )}
            <CardPicker
              label={t('chat.card-version')}
              value={target}
              disabled={busy}
              items={templates
                .filter((v) => v.family === selected.family)
                .map((v) => ({
                  id: `${v.family}@${v.version}`,
                  name: `${v.name} · v${v.version}`,
                }))}
              onChange={setTarget}
            />
            {detail?.config.model && (
              <DsText role="base">
                {t('chat.session-agents-model')} · {detail.config.model.name}
              </DsText>
            )}
            {detail?.kind === 'agent' && (
              <DsText role="meta">
                {t(
                  detail.config.harness_id === 'plan_execute'
                    ? 'chat.node-harness-plan-execute'
                    : 'chat.node-harness-standard'
                )}{' '}
                · {detail.config.skill_ids?.length ?? 0} Skills
              </DsText>
            )}
            <div className="flex-1" />
            <CardPicker
              label={t('chat.card-destination')}
              value={destination}
              disabled={busy}
              items={[
                ...destinations,
                ...(createSession
                  ? [{ id: '__new__', name: t('chat.workspace-add-session') }]
                  : []),
              ]}
              onChange={setDestination}
            />
            {destination === '__new__' && createSession && (
              <Input
                size="sm"
                title={t('chat.workspace-name')}
                aria-label={t('chat.workspace-name')}
                maxLength={80}
                disabled={busy}
                value={sessionTitle}
                onChange={(e) => setSessionTitle(e.target.value)}
              />
            )}
            {needsModel && (
              <CardPicker
                label={t('chat.session-agents-model')}
                value={model}
                disabled={busy}
                items={choices.map((c) => ({
                  id: c.id,
                  name: c.name + ' · ' + c.group,
                }))}
                onChange={setModel}
              />
            )}
            {needsModel && !choices.length && (
              <DsText role="meta">{t('chat.session-agents-no-models')}</DsText>
            )}
            {installError && (
              <DsText role="base" aria-live="assertive">
                {t('chat.card-install-error')}
              </DsText>
            )}
            <Button
              disabled={
                busy ||
                !destination ||
                (needsModel && !choice) ||
                (destination === '__new__' &&
                  (!createSession || !sessionTitle.trim()))
              }
              onClick={() => void install()}
            >
              <DsIcon icon={Plus} />
              {t(busy ? 'chat.card-installing' : 'chat.card-place')}
            </Button>
            <Button
              variant="outline"
              disabled={busy || !detail}
              onClick={() => detail && setDraft({ template: detail })}
            >
              <DsIcon icon={Pencil} />
              {t('chat.card-edit')}
            </Button>
          </aside>
        )}
      </div>
    </div>
  );
  const body = (
    <>
      {content}
      {legacy && (
        <LegacyWorkshop
          api={api}
          choices={choices}
          projectId={projectId}
          beforeInstall={beforeInstall}
          initialNode={initialNode}
          onClose={() => {
            setLegacy(false);
            setEpoch((n) => n + 1);
          }}
          onInstalled={(node) => {
            onInstalled(node, projectId);
            setLegacy(false);
            onClose();
          }}
        />
      )}
    </>
  );
  if (embedded)
    return (
      <section
        className="absolute inset-0 z-40 flex min-h-0 flex-col bg-ds-neutral-subtle-default"
        aria-label={t('chat.workshop')}
      >
        {body}
      </section>
    );
  return (
    <Dialog
      open
      onOpenChange={(v) => {
        if (!v && !busy && !editorBusy) onClose();
      }}
    >
      <DialogContent
        size="workbench"
        showCloseButton={false}
        aria-describedby={undefined}
      >
        <DialogHeader title={t('chat.workshop')} className="sr-only" />
        {body}
      </DialogContent>
    </Dialog>
  );
}
