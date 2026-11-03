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

import { proxyFetchDelete } from '@/api/http';
import SearchInput from '@/components/Dashboard/SearchInput';
import CollectionToolbar, {
  COLLECTION_RAIL_CLASS,
  COLLECTION_TOOLBAR_SEARCH_CLASS,
} from '@/components/Layout/CollectionToolbar';
import { useFocusContentHeading } from '@/components/Layout/ContentHeader';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader } from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { DsIcon } from '@/components/ui/ds-icon';
import { DsText } from '@/components/ui/ds-text';
import { Input } from '@/components/ui/input';
import { itemFadeMotion } from '@/components/ui/motion';
import { useConfiguredModels } from '@/hooks/useConfiguredModels';
import {
  configurationHint,
  modelProviders,
  notifyModelConfigurationsChanged,
  providerCategory,
  providerDefinition,
  selectableConfiguredModels,
  setConfiguredProviderDefault,
  type ConfiguredProvider,
} from '@/lib/configuredModels';
import { getProviderValid } from '@/lib/providerStatus';
import {
  getModelImage,
  needsInvertModelImage,
} from '@/shared/modelProviderImages';
import { useAuthStore } from '@/store/authStore';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import {
  Bell,
  Check,
  ChevronDown,
  ChevronRight,
  LoaderCircle,
  MoreHorizontal,
  Plus,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import SettingsContentShell from '../SettingsContentShell';
import { SettingsRow, SettingsRowGroup } from '../SettingsRowGroup';
import SettingsSectionPage from '../SettingsSectionPage';
import {
  CodexConfigurationContent,
  CodexConfigurationDialog,
} from './CodexConfigurationDialog';
import {
  ModelConfigurationContent,
  ModelConfigurationDialog,
} from './ModelConfigurationDialog';

export default function SettingModels() {
  const { user_id, email } = useAuthStore();
  return <ModelsContent key={String(user_id || email || 'local')} />;
}

function ModelsContent() {
  const { t } = useTranslation();
  const headingRef = useFocusContentHeading();
  const inventory = useConfiguredModels();
  const shouldReduceMotion = Boolean(useReducedMotion());
  const auth = useAuthStore();
  const [query, setQuery] = useState('');
  const [providerQuery, setProviderQuery] = useState('');
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<{
    provider: string;
    record?: ConfiguredProvider;
    returnToProviderSelection?: boolean;
  } | null>(null);
  const [deleting, setDeleting] = useState<ConfiguredProvider | null>(null);
  const [collapsed, setCollapsed] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [configurationBusy, setConfigurationBusy] = useState(false);
  const [error, setError] = useState('');
  const [searchParams, setSearchParams] = useSearchParams();
  useEffect(() => {
    const target = searchParams.get('provider');
    if (!target) return;
    if (modelProviders.some((provider) => provider.id === target))
      setEditing({ provider: target });
    const next = new URLSearchParams(searchParams);
    next.delete('provider');
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);
  const isDefault = (record: ConfiguredProvider) =>
    auth.modelType === providerCategory(record.provider_name) &&
    Boolean(record.prefer);
  const groups = [
    ...new Set(inventory.records.map((record) => record.provider_name)),
    ...(inventory.codexConnected ? ['codex-subscription'] : []),
  ];
  const matches = (value: string) =>
    value.toLowerCase().includes(query.trim().toLowerCase());
  const availableProviders = modelProviders.filter((provider) =>
    provider.name.toLowerCase().includes(providerQuery.trim().toLowerCase())
  );
  const matchingRecords = inventory.records.filter((record) =>
    matches(
      `${providerDefinition(record.provider_name).name} ${record.model_type} ${record.id}`
    )
  );
  const visibleRecordCount = matchingRecords.filter(getProviderValid).length;
  const invalidRecordCount = inventory.records.filter(
    (record) => !getProviderValid(record)
  ).length;
  const matchingCodexModels = inventory.codexModels.filter((model) =>
    matches(`Codex ${model.name} ${model.id}`)
  );
  const visibleCodexCount = inventory.codexConnected
    ? matchingCodexModels.length
    : 0;
  const visibleCount = visibleRecordCount + visibleCodexCount;
  const hasMatches = matchingRecords.length + visibleCodexCount > 0;
  const providerIcons = modelProviders.map((provider) => ({
    id: provider.id,
    name: provider.name,
  }));
  const providerRowLength = Math.ceil(providerIcons.length / 2);
  const providerIconRows = [
    providerIcons.slice(0, providerRowLength),
    providerIcons.slice(providerRowLength),
  ].filter((row) => row.length);
  const defaultModelOptions = selectableConfiguredModels({
    ...inventory,
    codexModelType: auth.codex_model_type,
  });
  const preferredRecord = inventory.records.find(
    (record) =>
      record.prefer && providerCategory(record.provider_name) === auth.modelType
  );
  const selectedDefaultId =
    auth.modelType === 'codex_subscription'
      ? `codex:${auth.codex_model_type}`
      : preferredRecord
        ? `provider:${preferredRecord.id}`
        : undefined;
  const selectedDefaultValue = defaultModelOptions.some(
    (option) => option.id === selectedDefaultId
  )
    ? selectedDefaultId
    : undefined;
  const selectedDefaultOption = defaultModelOptions.find(
    (option) => option.id === selectedDefaultValue
  );
  const optionHint = (option: (typeof defaultModelOptions)[number]) =>
    'record' in option
      ? configurationHint(option.record, inventory.records)
      : '';
  const selectedDefaultLabel = selectedDefaultOption
    ? [selectedDefaultOption.name, optionHint(selectedDefaultOption)]
        .filter(Boolean)
        .join(' · ')
    : t('setting.select-default-model');
  const defaultModelGroups = [
    ...new Set(defaultModelOptions.map((option) => option.group)),
  ];
  function logo(provider: string, sizeClass = 'size-ds-24') {
    const id = provider;
    const src = getModelImage(id);
    return src ? (
      <img
        src={src}
        alt=""
        className={`${sizeClass} shrink-0 object-contain ${needsInvertModelImage(id, auth.appearance) ? 'invert' : ''}`}
      />
    ) : null;
  }
  async function makeDefault(record: ConfiguredProvider) {
    setBusy(true);
    setError('');
    try {
      await setConfiguredProviderDefault(record);
    } catch {
      setError(t('setting.save-failed'));
    } finally {
      setBusy(false);
    }
  }
  async function chooseDefault(value: string) {
    if (busy) return;
    if (value.startsWith('codex:')) {
      const model = inventory.codexModels.find(
        (item) => value === `codex:${item.id}`
      );
      if (!model) return;
      auth.setCodexModelType(model.id);
      auth.setModelType('codex_subscription');
      return;
    }
    const record = inventory.records.find(
      (item) => value === `provider:${item.id}`
    );
    if (record) await makeDefault(record);
  }
  function returnToProviderSelection() {
    setConfigurationBusy(false);
    setEditing(null);
  }
  function closeAddModelFlow() {
    setConfigurationBusy(false);
    setEditing(null);
    setAdding(false);
  }
  async function remove() {
    if (!deleting || isDefault(deleting)) return;
    setBusy(true);
    setError('');
    try {
      await proxyFetchDelete(`/api/v1/provider/${deleting.id}`);
      setDeleting(null);
      notifyModelConfigurationsChanged();
    } catch {
      setError(t('setting.reset-failed'));
    } finally {
      setBusy(false);
    }
  }
  function actions(label: string, content: React.ReactNode) {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            buttonContent="icon-only"
            aria-label={t('setting.model-list.actions', { model: label })}
          >
            <DsIcon icon={MoreHorizontal} />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">{content}</DropdownMenuContent>
      </DropdownMenu>
    );
  }
  const badge = (
    <Badge variant="secondary" size="xs">
      {t('setting.default')}
    </Badge>
  );
  const modelStatus = (configured: boolean) => (
    <Badge
      variant="secondary"
      size="xs"
      tone={configured ? 'success' : 'error'}
    >
      {t(configured ? 'setting.configured' : 'setting.not-configured')}
    </Badge>
  );
  const modelRowClass =
    'flex min-h-[var(--ds-row-comfortable-min-height)] items-center gap-ds-12 px-ds-12 py-ds-12';
  const modelNameClass = (configured: boolean) =>
    `min-w-0 flex-1 truncate ${configured ? '' : 'text-ds-text-error-default-default'}`;
  return (
    <>
      <CollectionToolbar
        persistentHeader
        title={t('setting.models')}
        headingLevel={1}
        headingRef={headingRef}
        width="wide"
        aria-label={t('setting.models')}
        count={
          inventory.loading ? (
            <span
              role="status"
              aria-live="polite"
              className="inline-flex items-center text-ds-ink-muted-default"
            >
              <DsIcon
                icon={LoaderCircle}
                className="motion-safe:animate-spin"
              />
              <span className="sr-only">{t('setting.loading')}</span>
            </span>
          ) : (
            <>
              <Badge
                variant="secondary"
                size="xs"
                aria-label={`${visibleCount} ${t('setting.models')}`}
              >
                {visibleCount}
              </Badge>
              {invalidRecordCount > 0 && (
                <Badge
                  variant="secondary"
                  size="xs"
                  tone="error"
                  aria-label={`${invalidRecordCount} ${t('setting.not-configured')}`}
                >
                  <DsIcon icon={Bell} recipe="main-compact" />
                  {invalidRecordCount}
                </Badge>
              )}
            </>
          )
        }
      >
        <div className={COLLECTION_TOOLBAR_SEARCH_CLASS}>
          <SearchInput
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            ariaLabel={t('setting.model-list.search-models')}
            placeholder={t('setting.model-list.search-models')}
            clearOnEscape
          />
        </div>
        <Button
          variant="primary"
          size="sm"
          buttonRadius="full"
          id="add-model-provider"
          onClick={() => {
            setProviderQuery('');
            setAdding(true);
          }}
        >
          {t('setting.model-list.add-model')}
        </Button>
      </CollectionToolbar>
      <SettingsContentShell contentClassName={COLLECTION_RAIL_CLASS.wide}>
        <SettingsSectionPage className="gap-ds-24 py-ds-24">
          {inventory.error && (
            <div
              role="alert"
              className="flex flex-wrap items-center gap-ds-control-gap"
            >
              <DsText>{t('setting.model-list.load-error')}</DsText>
              <Button variant="secondary" size="sm" onClick={inventory.refresh}>
                {t('setting.model-list.retry')}
              </Button>
            </div>
          )}
          {error && !deleting && (
            <div role="alert">
              <DsText className="text-ds-text-error-default-default">
                {error}
              </DsText>
            </div>
          )}
          <div className="flex flex-col gap-ds-24">
            <section
              data-model-provider-banner
              aria-label={t('setting.model-list.all-providers')}
              className="flex min-w-0 flex-col items-center px-ds-card-inset"
            >
              <div
                role="list"
                aria-label={t('setting.model-list.all-providers')}
                className="flex w-full flex-col items-center gap-ds-12"
              >
                {providerIconRows.map((row, rowIndex) => (
                  <div
                    key={rowIndex}
                    data-provider-icon-row
                    role="presentation"
                    className="flex items-center justify-center gap-ds-12"
                  >
                    {row.map((provider) => (
                      <div key={provider.id} role="listitem">
                        <Button
                          variant="ghost"
                          size="xl"
                          buttonContent="icon-only"
                          className="active:scale-100"
                          aria-label={provider.name}
                          title={provider.name}
                          onClick={() => setEditing({ provider: provider.id })}
                        >
                          {logo(provider.id, 'size-ds-32')}
                        </Button>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </section>
            <SettingsRowGroup data-default-model-setting>
              <SettingsRow
                title={t('setting.model-list.default-model')}
                description={t('setting.model-list.default-model-description')}
                actionClassName="ml-auto"
                action={
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={
                          inventory.loading ||
                          busy ||
                          !defaultModelOptions.length
                        }
                        className="max-w-full min-w-0"
                        aria-label={`${t('setting.select-default-model')}: ${selectedDefaultLabel}`}
                        title={selectedDefaultLabel}
                      >
                        <span className="min-w-0 truncate">
                          {selectedDefaultLabel}
                        </span>
                        <DsIcon icon={ChevronDown} />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent
                      align="end"
                      className="min-w-[280px] overflow-hidden"
                    >
                      <div
                        data-default-model-options
                        className="scrollbar-always-visible max-h-80 overflow-y-auto"
                      >
                        {defaultModelGroups.map((group) => {
                          const groupName = providerDefinition(group).name;
                          return (
                            <div key={group}>
                              {group !== defaultModelGroups[0] && (
                                <DropdownMenuSeparator />
                              )}
                              <DropdownMenuGroup aria-label={groupName}>
                                <DropdownMenuLabel className="truncate px-2 py-1.5 font-normal text-ds-ink-muted-default">
                                  <span className="flex items-center gap-ds-6 text-ds-text-meta font-medium">
                                    {logo(group, 'size-ds-16')}
                                    {groupName}
                                  </span>
                                </DropdownMenuLabel>
                                {defaultModelOptions
                                  .filter((option) => option.group === group)
                                  .map((option) => {
                                    const hint = optionHint(option);
                                    return (
                                      <DropdownMenuItem
                                        key={option.id}
                                        role="menuitemradio"
                                        aria-checked={
                                          selectedDefaultValue === option.id
                                        }
                                        className="cursor-pointer"
                                        disabled={busy}
                                        onSelect={() =>
                                          void chooseDefault(option.id)
                                        }
                                      >
                                        <span className="min-w-0 flex-1 truncate">
                                          {option.name}
                                          {hint && (
                                            <span className="text-ds-ink-muted-default">
                                              {` · ${hint}`}
                                            </span>
                                          )}
                                        </span>
                                        {selectedDefaultValue === option.id && (
                                          <DsIcon
                                            icon={Check}
                                            className="text-ds-accent-default-default"
                                          />
                                        )}
                                      </DropdownMenuItem>
                                    );
                                  })}
                              </DropdownMenuGroup>
                            </div>
                          );
                        })}
                      </div>
                    </DropdownMenuContent>
                  </DropdownMenu>
                }
              />
            </SettingsRowGroup>
            {groups.map((group) => {
              const codex = group === 'codex-subscription';
              const name = codex ? 'Codex' : providerDefinition(group).name;
              const providerRecords = inventory.records.filter(
                (record) => record.provider_name === group
              );
              const records = providerRecords.filter((record) =>
                matches(`${name} ${record.model_type} ${record.id}`)
              );
              if (
                query &&
                !(codex ? matchingCodexModels.length : records.length)
              )
                return null;
              const closed = collapsed.includes(group);
              const modelCount = codex
                ? inventory.codexModels.length
                : providerRecords.length;
              return (
                <section
                  key={group}
                  aria-label={name}
                  className="overflow-hidden rounded-2xl bg-ds-neutral-default-default"
                >
                  <header className="flex flex-wrap items-center justify-between gap-ds-control-gap px-ds-card-inset py-ds-12">
                    <div className="flex min-w-0 items-center gap-ds-control-gap">
                      {logo(group)}
                      <div className="flex min-w-0 items-center gap-ds-8">
                        <DsText as="h2" role="body-large" weight="semibold">
                          {name}
                        </DsText>
                        <Badge
                          variant="secondary"
                          size="xs"
                          aria-label={`${modelCount} ${t('setting.models')}`}
                        >
                          {modelCount}
                        </Badge>
                      </div>
                    </div>
                    <div className="flex items-center gap-ds-8">
                      <Button
                        id={`add-model-${group}`}
                        variant="secondary"
                        size="sm"
                        onClick={() => setEditing({ provider: group })}
                      >
                        {!codex && <DsIcon icon={Plus} />}
                        {t(
                          codex
                            ? 'setting.manage'
                            : 'setting.model-list.add-model'
                        )}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        buttonContent="icon-only"
                        aria-label={name}
                        aria-expanded={!closed}
                        aria-controls={`models-${group}`}
                        onClick={() =>
                          setCollapsed((old) =>
                            closed
                              ? old.filter((id) => id !== group)
                              : [...old, group]
                          )
                        }
                      >
                        <DsIcon
                          icon={ChevronRight}
                          className={`transition-transform duration-[160ms] ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none ${closed ? '' : 'rotate-90'}`}
                        />
                      </Button>
                    </div>
                  </header>
                  {!closed && (
                    <div
                      id={`models-${group}`}
                      className="mx-ds-16 flex flex-col divide-y divide-ds-hairline-subtle-disabled border-x-0 border-t border-b-0 border-solid border-ds-hairline-subtle-default"
                    >
                      {codex ? (
                        <>
                          {(inventory.codexModelsLoading ||
                            inventory.codexModelsError ||
                            !inventory.codexModels.length) && (
                            <div className={modelRowClass}>
                              <DsText
                                className="flex-1 text-ds-ink-muted-default"
                                role="base"
                              >
                                {t(
                                  inventory.codexModelsLoading
                                    ? 'setting.loading-models'
                                    : inventory.codexModelsError
                                      ? 'setting.model-list.load-error'
                                      : 'setting.no-models-found'
                                )}
                              </DsText>
                              <Button
                                variant="secondary"
                                size="sm"
                                disabled={inventory.codexModelsLoading}
                                onClick={inventory.refreshCodexModels}
                              >
                                {t('setting.model-list.retry')}
                              </Button>
                            </div>
                          )}
                          {matchingCodexModels.map((model) => (
                            <div key={model.id} className={modelRowClass}>
                              <DsText
                                className="min-w-0 flex-1 truncate"
                                title={model.id}
                              >
                                {model.name}
                              </DsText>
                              {auth.modelType === 'codex_subscription' &&
                                auth.codex_model_type === model.id &&
                                badge}
                              {actions(
                                model.name,
                                <DropdownMenuItem
                                  onSelect={() =>
                                    void chooseDefault(`codex:${model.id}`)
                                  }
                                >
                                  {t('setting.set-as-default')}
                                </DropdownMenuItem>
                              )}
                            </div>
                          ))}
                        </>
                      ) : (
                        records.map((record) => {
                          const configured = getProviderValid(record);
                          const hint = configurationHint(
                            record,
                            inventory.records
                          );
                          return (
                            <div key={record.id} className={modelRowClass}>
                              <DsText
                                weight="medium"
                                className={modelNameClass(configured)}
                              >
                                {record.model_type}
                                {hint && (
                                  <span className="font-normal text-ds-ink-muted-default">
                                    {` · ${hint}`}
                                  </span>
                                )}
                              </DsText>
                              {isDefault(record) && badge}
                              {modelStatus(configured)}
                              {actions(
                                record.model_type,
                                <>
                                  <DropdownMenuItem
                                    disabled={busy}
                                    onSelect={() =>
                                      setEditing({ provider: group, record })
                                    }
                                  >
                                    {t('setting.edit')}
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    disabled={
                                      busy || isDefault(record) || !configured
                                    }
                                    onSelect={() => makeDefault(record)}
                                  >
                                    {t('setting.set-as-default')}
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    disabled={busy || isDefault(record)}
                                    onSelect={() => {
                                      setError('');
                                      setDeleting(record);
                                    }}
                                  >
                                    {t('setting.delete')}
                                  </DropdownMenuItem>
                                </>
                              )}
                            </div>
                          );
                        })
                      )}
                    </div>
                  )}
                </section>
              );
            })}
          </div>
          {query && !hasMatches && !inventory.loading && (
            <DsText className="text-ds-ink-muted-default">
              {t('setting.model-list.no-results')}
            </DsText>
          )}
        </SettingsSectionPage>
      </SettingsContentShell>
      <Dialog
        open={adding}
        onOpenChange={(open) => {
          if (!open && !configurationBusy) closeAddModelFlow();
        }}
      >
        <DialogContent
          size="md"
          overlayVariant="dimmed"
          showCloseButton={!configurationBusy}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            document.getElementById('add-model-provider')?.focus();
          }}
        >
          <AnimatePresence initial={false} mode="wait">
            <motion.div
              key={editing ? `configure-${editing.provider}` : 'providers'}
              className="flex min-h-0 flex-1 flex-col"
              {...itemFadeMotion(shouldReduceMotion)}
            >
              {editing ? (
                providerDefinition(editing.provider).authMode ===
                'oauth_subscription' ? (
                  <CodexConfigurationContent
                    models={inventory.codexModels}
                    modelsLoading={inventory.codexModelsLoading}
                    modelsError={inventory.codexModelsError}
                    onRefreshModels={inventory.refreshCodexModels}
                    connected={inventory.codexConnected}
                    accountLabel={inventory.codexAccountLabel}
                    onClose={closeAddModelFlow}
                    onBack={returnToProviderSelection}
                    onBusyChange={setConfigurationBusy}
                  />
                ) : (
                  <ModelConfigurationContent
                    provider={providerDefinition(editing.provider)}
                    record={editing.record}
                    onClose={closeAddModelFlow}
                    onBack={returnToProviderSelection}
                    onBusyChange={setConfigurationBusy}
                  />
                )
              ) : (
                <>
                  <DialogHeader
                    title={t('setting.model-list.add-provider')}
                    subtitle={t('setting.model-list.provider-hint')}
                  />
                  <div className="scrollbar-always-visible flex min-h-0 flex-col gap-ds-control-gap overflow-y-auto p-ds-panel-inset">
                    <Input
                      autoFocus
                      aria-label={t('setting.model-list.search-providers')}
                      placeholder={t('setting.model-list.search-providers')}
                      value={providerQuery}
                      onChange={(event) => setProviderQuery(event.target.value)}
                    />
                    {availableProviders.map((provider) => (
                      <Button
                        key={provider.id}
                        variant="ghost"
                        size="lg"
                        className="shrink-0 justify-between active:scale-100"
                        onClick={() => {
                          setConfigurationBusy(false);
                          setEditing({
                            provider: provider.id,
                            returnToProviderSelection: true,
                          });
                        }}
                      >
                        <span className="flex items-center gap-ds-control-gap">
                          {logo(provider.id)}
                          {provider.name}
                        </span>
                        <DsIcon icon={Plus} />
                      </Button>
                    ))}
                    {!availableProviders.length && (
                      <DsText className="text-ds-ink-muted-default">
                        {t('setting.model-list.no-results')}
                      </DsText>
                    )}
                  </div>
                </>
              )}
            </motion.div>
          </AnimatePresence>
        </DialogContent>
      </Dialog>
      {editing &&
        !adding &&
        (providerDefinition(editing.provider).authMode ===
        'oauth_subscription' ? (
          <CodexConfigurationDialog
            models={inventory.codexModels}
            modelsLoading={inventory.codexModelsLoading}
            modelsError={inventory.codexModelsError}
            onRefreshModels={inventory.refreshCodexModels}
            connected={inventory.codexConnected}
            accountLabel={inventory.codexAccountLabel}
            onClose={() => setEditing(null)}
            onBack={
              editing.returnToProviderSelection
                ? returnToProviderSelection
                : undefined
            }
          />
        ) : (
          <ModelConfigurationDialog
            key={editing.record?.id ?? editing.provider}
            provider={providerDefinition(editing.provider)}
            record={editing.record}
            onClose={() => setEditing(null)}
            onBack={
              editing.returnToProviderSelection
                ? returnToProviderSelection
                : undefined
            }
          />
        ))}
      <Dialog
        open={Boolean(deleting)}
        onOpenChange={(open) => {
          if (!open && !busy) setDeleting(null);
        }}
      >
        <DialogContent
          size="sm"
          overlayVariant="dimmed"
          showCloseButton={!busy}
        >
          <DialogHeader
            title={t('setting.model-list.remove-model')}
            subtitle={t('setting.model-list.remove-hint', {
              model: deleting?.model_type,
            })}
          />
          <div className="flex flex-col gap-ds-stack-related p-ds-panel-inset">
            {error && (
              <div role="alert">
                <DsText className="text-ds-text-error-default-default">
                  {error}
                </DsText>
              </div>
            )}
            <div className="flex justify-end gap-ds-control-gap">
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() => setDeleting(null)}
              >
                {t('setting.cancel')}
              </Button>
              <Button
                variant="primary"
                tone="error"
                disabled={busy}
                onClick={remove}
              >
                {t('setting.delete')}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
