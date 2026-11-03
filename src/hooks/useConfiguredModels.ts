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

import { createHost } from '@/host/createHost';
import {
  fetchConfiguredProviders,
  MODEL_CONFIGURATIONS_CHANGED,
  type ConfiguredProvider,
} from '@/lib/configuredModels';
import { useAuthStore } from '@/store/authStore';
import type { CloudModel } from '@/store/cloudModelStore';
import { useModelVisibilityStore } from '@/store/modelVisibilityStore';
import type { CodexModel } from '@/types/codex';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';

const EMPTY_IDS: string[] = [];
const EMPTY_CLOUD_MODELS: CloudModel[] = [];
type CodexInventory = {
  key: string;
  connected: boolean;
  accountLabel: string;
  models: CodexModel[];
  loading: boolean;
  error: boolean;
};
// All mounted model surfaces receive the same discovery result, including
// the workspace composer kept mounted while Settings is open.
const codexListeners = new Set<(state: CodexInventory) => void>();
const codexGenerations = new Map<string, number>();
function publishCodex(state: CodexInventory) {
  codexListeners.forEach((listener) => listener(state));
}
type InventoryState = {
  key: string;
  records: ConfiguredProvider[];
  loading: boolean;
  error: boolean;
  loaded: boolean;
};
const emptyInventory: InventoryState = {
  key: '',
  records: [],
  loading: true,
  error: false,
  loaded: false,
};
let inventoryState = emptyInventory;
let generation = 0;
let pending: { key: string; promise: Promise<void> } | null = null;
const listeners = new Set<() => void>();

function setInventory(next: InventoryState) {
  inventoryState = next;
  listeners.forEach((listener) => listener());
}

function loadInventory(key: string, force = false): Promise<void> {
  if (pending?.key === key) return pending.promise;
  if (!force && inventoryState.key === key && inventoryState.loaded)
    return Promise.resolve();
  const request = ++generation;
  const previous = inventoryState.key === key ? inventoryState : emptyInventory;
  setInventory({
    ...previous,
    key,
    loading: !previous.loaded,
    error: false,
  });
  const promise = fetchConfiguredProviders()
    .then((records) => {
      if (request === generation)
        setInventory({
          key,
          records,
          loading: false,
          error: false,
          loaded: true,
        });
    })
    .catch(() => {
      if (request === generation)
        setInventory({
          ...inventoryState,
          loading: false,
          error: true,
          loaded: true,
        });
    })
    .finally(() => {
      if (pending?.promise === promise) pending = null;
    });
  pending = { key, promise };
  return promise;
}

function refreshInventory() {
  if (inventoryState.key) void loadInventory(inventoryState.key, true);
}

function subscribeInventory(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) {
    window.addEventListener(MODEL_CONFIGURATIONS_CHANGED, refreshInventory);
    window.addEventListener('focus', refreshInventory);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      window.removeEventListener(
        MODEL_CONFIGURATIONS_CHANGED,
        refreshInventory
      );
      window.removeEventListener('focus', refreshInventory);
      generation++;
      pending = null;
      inventoryState = emptyInventory;
    }
  };
}

const getInventorySnapshot = () => inventoryState;
export function useConfiguredModels() {
  const { email, token, user_id } = useAuthStore();
  const account = String(user_id || email || 'local');
  const key = `${account}:${email || ''}:${token || ''}`;
  const hidden = useModelVisibilityStore(
    (state) => state.hiddenByAccount[account] ?? EMPTY_IDS
  );
  const setHidden = useModelVisibilityStore((state) => state.setHidden);
  const state = useSyncExternalStore(
    subscribeInventory,
    getInventorySnapshot,
    getInventorySnapshot
  );
  const [codex, setCodex] = useState<CodexInventory>({
    key,
    connected: false,
    accountLabel: '',
    models: [] as CodexModel[],
    loading: false,
    error: false,
  });
  const refresh = useCallback(() => loadInventory(key, true), [key]);
  useEffect(() => {
    void loadInventory(key);
  }, [key]);
  const codexRequest = useRef(0);
  const invalidateCodexRequest = useCallback(() => {
    codexRequest.current++;
  }, []);
  const refreshCodex = useCallback(
    async (force = false) => {
      const request = ++codexRequest.current;
      const generation = (codexGenerations.get(key) ?? 0) + 1;
      codexGenerations.set(key, generation);
      setCodex((previous) => ({
        ...(previous.key === key
          ? previous
          : { key, connected: false, accountLabel: '', models: [] }),
        loading: true,
        error: false,
      }));
      let connected = false;
      let accountLabel = '';
      try {
        const api = createHost().electronAPI;
        const status = email
          ? await api?.codexSubscriptionStatus?.(email)
          : null;
        if (codexGenerations.get(key) !== generation) return;
        connected = Boolean(status?.connected);
        accountLabel = status?.account_label ?? '';
        if (request === codexRequest.current)
          setCodex({
            key,
            connected,
            accountLabel,
            models: [],
            loading: connected,
            error: false,
          });
        const result = connected
          ? await api?.codexSubscriptionModels?.(email, force)
          : null;
        if (codexGenerations.get(key) === generation)
          publishCodex({
            key,
            connected,
            accountLabel,
            models: result?.success ? result.models : [],
            loading: false,
            error: connected && !result?.success,
          });
      } catch {
        if (codexGenerations.get(key) === generation)
          publishCodex({
            key,
            connected,
            accountLabel,
            models: [],
            loading: false,
            error: true,
          });
      }
    },
    [key, email]
  );
  useEffect(() => {
    const receive = (next: CodexInventory) => {
      if (next.key !== key) return;
      invalidateCodexRequest();
      setCodex(next);
    };
    codexListeners.add(receive);
    void refreshCodex();
    const changed = () => {
      void refreshCodex(true);
    };
    const ipc = createHost().ipcRenderer;
    ipc?.on?.('subscription-auth:codex-status-changed', changed);
    window.addEventListener(MODEL_CONFIGURATIONS_CHANGED, changed);
    return () => {
      invalidateCodexRequest();
      codexListeners.delete(receive);
      ipc?.off?.('subscription-auth:codex-status-changed', changed);
      window.removeEventListener(MODEL_CONFIGURATIONS_CHANGED, changed);
    };
  }, [refreshCodex, key, invalidateCodexRequest]);
  return {
    records: state.key === key ? state.records : [],
    loading: state.key !== key || state.loading,
    error: state.key === key && state.error,
    refresh,
    // AgentDeck lists user-connected models, not the upstream hosted catalog.
    // Keep the inventory shape compatible with existing model consumers.
    cloudModels: EMPTY_CLOUD_MODELS,
    hidden,
    cloudAvailable: false,
    setHidden: (id: string, value: boolean) => setHidden(account, id, value),
    codexConnected: codex.key === key && codex.connected,
    codexAccountLabel: codex.key === key ? codex.accountLabel : '',
    codexModels: codex.key === key ? codex.models : [],
    codexModelsLoading: codex.key === key && codex.loading,
    codexModelsError: codex.key === key && codex.error,
    refreshCodexModels: () => refreshCodex(true),
  };
}
