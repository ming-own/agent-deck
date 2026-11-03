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
import { createHost } from '@/host/createHost';
import { notifyModelConfigurationsChanged } from '@/lib/configuredModels';
import { useAuthStore } from '@/store/authStore';
import type { CodexModel } from '@/types/codex';
import { ArrowLeft } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

type Props = {
  models: CodexModel[];
  modelsLoading: boolean;
  modelsError: boolean;
  onRefreshModels: () => void;
  connected: boolean;
  accountLabel: string;
  onClose: () => void;
  onBack?: () => void;
};

type ContentProps = Props & {
  onBusyChange?: (busy: boolean) => void;
};

export function CodexConfigurationContent({
  models,
  modelsLoading,
  modelsError,
  onRefreshModels,
  connected,
  accountLabel,
  onClose,
  onBack,
  onBusyChange,
}: ContentProps) {
  const { t } = useTranslation();
  const { email, modelType } = useAuthStore();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    onBusyChange?.(busy);
  }, [busy, onBusyChange]);
  async function authenticate(disconnect: boolean) {
    setBusy(true);
    setError('');
    try {
      if (!email) throw new Error(t('setting.login-required'));
      const api = createHost().electronAPI;
      const result = disconnect
        ? await api?.codexSubscriptionDisconnect?.(email)
        : await api?.codexSubscriptionLogin?.(email);
      if (!result?.success) {
        const errors: Record<string, string> = {
          oauth_callback_port_in_use: 'codex-port-in-use',
          oauth_callback_unavailable: 'codex-callback-unavailable',
          oauth_open_browser_failed: 'codex-open-browser-failed',
          oauth_state_expired: 'codex-state-expired',
          oauth_state_mismatch: 'codex-state-mismatch',
          access_denied: 'codex-access-denied',
        };
        throw new Error(
          t(
            `setting.${errors[result?.error_code ?? ''] ?? 'codex-login-failed'}`
          )
        );
      }
      notifyModelConfigurationsChanged();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : t('setting.save-failed')
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <DialogHeader title="Codex" subtitle={t('setting.manage-account')} />
      <div className="flex flex-col gap-ds-stack-section p-ds-panel-inset">
        <div className="flex flex-wrap items-center justify-between gap-ds-control-gap">
          <DsText>
            {connected
              ? accountLabel || t('connectors.connected')
              : t('setting.not-configured')}
          </DsText>
          <Button
            variant="secondary"
            disabled={busy || (connected && modelType === 'codex_subscription')}
            onClick={() => authenticate(connected)}
          >
            {t(connected ? 'setting.disconnect' : 'layout.login')}
          </Button>
        </div>
        {connected && modelType === 'codex_subscription' && (
          <DsText role="meta" className="text-ds-ink-muted-default">
            {t('setting.model-list.default-guard')}
          </DsText>
        )}
        {connected && (
          <div className="flex items-center justify-between gap-ds-control-gap">
            <DsText role="base" className="text-ds-ink-muted-default">
              {modelsLoading
                ? t('setting.loading-models')
                : modelsError
                  ? t('setting.model-list.load-error')
                  : `${t('setting.models')} · ${models.length}`}
            </DsText>
            <Button
              variant="secondary"
              disabled={busy || modelsLoading}
              onClick={onRefreshModels}
            >
              {t('setting.refresh')}
            </Button>
          </div>
        )}
        {error && (
          <div role="alert">
            <DsText className="text-ds-text-error-default-default">
              {error}
            </DsText>
          </div>
        )}
        <div className="flex items-center justify-between gap-ds-control-gap">
          {onBack && (
            <Button variant="ghost" disabled={busy} onClick={onBack}>
              <DsIcon icon={ArrowLeft} />
              {t('layout.back')}
            </Button>
          )}
          <div className="ml-auto flex items-center gap-ds-control-gap">
            <Button variant="primary" disabled={busy} onClick={onClose}>
              {t('setting.close')}
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}

export function CodexConfigurationDialog(props: Props) {
  const [busy, setBusy] = useState(false);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) props.onClose();
      }}
    >
      <DialogContent size="md" overlayVariant="dimmed" showCloseButton={!busy}>
        <CodexConfigurationContent {...props} onBusyChange={setBusy} />
      </DialogContent>
    </Dialog>
  );
}
