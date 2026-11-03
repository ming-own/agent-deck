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

import { useConfiguredModels } from '@/hooks/useConfiguredModels';
import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  status: vi.fn(),
  catalog: vi.fn(),
  get: vi.fn(),
  fetchCloudModels: vi.fn().mockResolvedValue([]),
  auth: { user_id: 1, email: '', token: 'first' },
}));
vi.mock('@/api/http', () => ({ proxyFetchGet: mocks.get }));
vi.mock('@/store/authStore', () => ({
  useAuthStore: () => mocks.auth,
  getAuthStore: () => mocks.auth,
}));
vi.mock('@/store/cloudModelStore', () => ({
  useCloudModelStore: (selector: (state: unknown) => unknown) =>
    selector({ models: [], fetchCloudModels: mocks.fetchCloudModels }),
}));
vi.mock('@/host/createHost', () => ({
  createHost: () => ({
    electronAPI: {
      codexSubscriptionStatus: mocks.status,
      codexSubscriptionModels: mocks.catalog,
    },
  }),
}));

function Reader({ id }: { id: string }) {
  const inventory = useConfiguredModels();
  return (
    <div data-testid={id}>
      {inventory.loading
        ? 'loading'
        : inventory.records.map((r) => r.id).join(',')}
      {inventory.error ? ' error' : ''}
    </div>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.user_id = 1;
  mocks.auth.email = '';
  mocks.status.mockResolvedValue({ connected: false });
  mocks.catalog.mockResolvedValue({ success: true, models: [] });
  mocks.get.mockResolvedValue({ items: [{ id: 11 }] });
});

describe('configured model inventory', () => {
  it('does not let an older discovery error cancel a newer refresh in another surface', async () => {
    mocks.auth.email = 'test@example.test';
    mocks.status.mockResolvedValue({ connected: true });
    let resolveOld!: (value: unknown) => void;
    let resolveNew!: (value: unknown) => void;
    mocks.catalog
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveOld = resolve;
          })
      )
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveNew = resolve;
          })
      );
    const view = renderHook(() => [
      useConfiguredModels(),
      useConfiguredModels(),
    ]);
    await waitFor(() => expect(resolveOld).toBeDefined());
    let refreshing!: Promise<void>;
    act(() => {
      refreshing = view.result.current[0].refreshCodexModels();
    });
    await waitFor(() => expect(resolveNew).toBeDefined());
    await act(async () =>
      resolveOld({ success: false, models: [], error_code: 'account_changed' })
    );
    await act(async () => {
      resolveNew({ success: true, models: [{ id: 'new', name: 'New' }] });
      await refreshing;
    });
    expect(
      view.result.current.every(
        (item) => item.codexModels[0]?.id === 'new' && !item.codexModelsError
      )
    ).toBe(true);
  });

  it('updates a still-mounted session picker after Settings retries discovery', async () => {
    mocks.auth.email = 'test@example.test';
    mocks.status.mockResolvedValue({ connected: true });
    mocks.catalog.mockResolvedValue({ success: false, models: [] });
    const view = renderHook(() => [
      useConfiguredModels(),
      useConfiguredModels(),
    ]);
    await waitFor(() =>
      expect(view.result.current.every((item) => item.codexModelsError)).toBe(
        true
      )
    );
    mocks.catalog.mockResolvedValue({
      success: true,
      models: [{ id: 'recovered', name: 'Recovered' }],
    });
    await act(async () => {
      await view.result.current[0].refreshCodexModels();
    });
    expect(view.result.current[1].codexModels).toEqual([
      { id: 'recovered', name: 'Recovered' },
    ]);
    expect(view.result.current[1].codexModelsError).toBe(false);
  });

  it('discards a catalog response after switching accounts with the same local user id', async () => {
    mocks.auth.email = 'first@example.test';
    mocks.status.mockResolvedValue({ connected: true });
    let resolveOld!: (value: unknown) => void;
    mocks.catalog.mockImplementation((email: string) =>
      email === 'first@example.test'
        ? new Promise((resolve) => {
            resolveOld = resolve;
          })
        : Promise.resolve({
            success: true,
            models: [{ id: 'second-model', name: 'Second' }],
          })
    );
    const view = renderHook(() => useConfiguredModels());
    await waitFor(() =>
      expect(mocks.catalog).toHaveBeenCalledWith('first@example.test', false)
    );
    mocks.auth.email = 'second@example.test';
    view.rerender();
    expect(view.result.current.codexModels).toEqual([]);
    await waitFor(() =>
      expect(view.result.current.codexModels).toEqual([
        { id: 'second-model', name: 'Second' },
      ])
    );
    await act(async () =>
      resolveOld({ success: true, models: [{ id: 'old-model', name: 'Old' }] })
    );
    expect(view.result.current.codexModels).toEqual([
      { id: 'second-model', name: 'Second' },
    ]);
  });
  it('clears unavailable models on a failed refresh and lets the user retry', async () => {
    mocks.auth.email = 'test@example.test';
    mocks.status.mockResolvedValue({ connected: true });
    mocks.catalog.mockResolvedValue({
      success: true,
      models: [
        { id: 'a', name: 'A' },
        { id: 'b', name: 'B' },
      ],
    });
    const view = renderHook(() => useConfiguredModels());
    await waitFor(() =>
      expect(view.result.current.codexModels).toHaveLength(2)
    );
    mocks.catalog.mockResolvedValueOnce({
      success: false,
      models: [],
      error_code: 'models_unavailable',
    });
    await act(async () => {
      await view.result.current.refreshCodexModels();
    });
    expect(view.result.current.codexModels).toEqual([]);
    expect(view.result.current.codexModelsError).toBe(true);
    await act(async () => {
      await view.result.current.refreshCodexModels();
    });
    expect(view.result.current.codexModels).toHaveLength(2);
  });

  it('shares a request across screens and keeps records during focus refresh failure', async () => {
    render(
      <>
        <Reader id="settings" />
        <Reader id="picker" />
      </>
    );
    await waitFor(() =>
      expect(screen.getByTestId('settings')).toHaveTextContent('11')
    );
    expect(screen.getByTestId('picker')).toHaveTextContent('11');
    expect(mocks.get).toHaveBeenCalledTimes(1);

    mocks.get.mockRejectedValueOnce(new Error('offline'));
    fireEvent.focus(window);
    expect(screen.getByTestId('settings')).toHaveTextContent('11');
    await waitFor(() =>
      expect(screen.getByTestId('settings')).toHaveTextContent('11 error')
    );
    expect(mocks.get).toHaveBeenCalledTimes(2);
  });
  it("does not show one account's records while another account loads", async () => {
    const view = render(<Reader id="settings" />);
    await waitFor(() =>
      expect(screen.getByTestId('settings')).toHaveTextContent('11')
    );
    mocks.auth.user_id = 2;
    mocks.get.mockReturnValue(new Promise(() => undefined));
    view.rerender(<Reader id="settings" />);
    expect(screen.getByTestId('settings')).toHaveTextContent('loading');
    expect(screen.getByTestId('settings')).not.toHaveTextContent('11');
  });
});
