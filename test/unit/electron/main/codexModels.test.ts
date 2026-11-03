import { beforeEach, describe, expect, it, vi } from 'vitest';
import { listCodexModels } from '../../../../electron/main/subscriptionAuth/modelCatalog';
const mocks = vi.hoisted(() => ({
  load: vi.fn(),
  refresh: vi.fn(),
  expired: vi.fn(),
}));
vi.mock('../../../../electron/main/subscriptionAuth/credentialStore', () => ({
  loadCodexCredential: mocks.load,
}));
vi.mock('../../../../electron/main/subscriptionAuth/resolverServer', () => ({
  refreshCodexCredential: mocks.refresh,
  isExpired: mocks.expired,
}));
const credential = {
  access_token: 'test-token',
  external_account_id: 'account-1',
  status: 'connected',
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.load.mockReturnValue(credential);
  mocks.expired.mockReturnValue(false);
});
describe('Codex account model catalog', () => {
  it('returns all visible models in server order without token material', async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          models: [
            {
              slug: 'model-b',
              display_name: 'Model B',
              visibility: 'list',
              access_token: 'must-not-expose',
            },
            { slug: 'hidden', visibility: 'hide' },
            { slug: 'model-a', display_name: 'Model A', visibility: 'list' },
            { slug: 'model-b', visibility: 'list' },
          ],
        })
      )
    );
    const result = await listCodexModels('models@example.test', true, fetcher);
    expect(result).toEqual({
      success: true,
      models: [
        { id: 'model-b', name: 'Model B' },
        { id: 'model-a', name: 'Model A' },
      ],
    });
    expect(fetcher.mock.calls[0][0]).toContain(
      '/backend-api/codex/models?client_version='
    );
    expect(fetcher.mock.calls[0][1].headers).toMatchObject({
      Authorization: 'Bearer test-token',
      'ChatGPT-Account-ID': 'account-1',
    });
  });
  it('does not request models without a connected account', async () => {
    mocks.load.mockReturnValue(null);
    const fetcher = vi.fn();
    expect(
      await listCodexModels('missing@example.test', true, fetcher)
    ).toEqual({ success: false, models: [], error_code: 'not_connected' });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('refreshes once after an expired authorization response', async () => {
    const renewed = { ...credential, access_token: 'new-test-token' };
    mocks.refresh.mockImplementation(async () => {
      mocks.load.mockReturnValue(renewed);
      return renewed;
    });
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response('', { status: 401 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ models: [] })));
    expect(
      (await listCodexModels('refresh@example.test', true, fetcher)).success
    ).toBe(true);
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('discards results if the account disconnected during discovery', async () => {
    const fetcher = vi.fn().mockImplementation(async () => {
      mocks.load.mockReturnValue(null);
      return new Response(
        JSON.stringify({ models: [{ slug: 'old', visibility: 'list' }] })
      );
    });
    expect(
      (await listCodexModels('changed@example.test', true, fetcher)).success
    ).toBe(false);
  });
  it('returns a safe error instead of remote bodies or cached made-up models', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        new Response('private upstream error', { status: 403 })
      );
    expect(await listCodexModels('denied@example.test', true, fetcher)).toEqual(
      { success: false, models: [], error_code: 'models_unavailable' }
    );
  });
});
