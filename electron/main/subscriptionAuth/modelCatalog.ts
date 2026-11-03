import { version } from '../../../package.json';
import type { CodexModelsResult } from '../../../src/types/codex';
import { loadCodexCredential } from './credentialStore';
import { isExpired, refreshCodexCredential } from './resolverServer';

const CATALOG_URL = `https://chatgpt.com/backend-api/codex/models?client_version=${encodeURIComponent(version)}`;
const CACHE_MS = 5 * 60_000;
const cache = new Map<
  string,
  { token: string; expires: number; result: CodexModelsResult }
>();
const pending = new Map<
  string,
  { token: string; request: Promise<CodexModelsResult> }
>();
const failure = (error_code: string): CodexModelsResult => ({
  success: false,
  models: [],
  error_code,
});

/** Credentials stay in the main process. Only model identifiers and names reach the renderer. */
export async function listCodexModels(
  email: string,
  force = false,
  fetcher: typeof fetch = fetch
): Promise<CodexModelsResult> {
  try {
    let credential = loadCodexCredential(email);
    if (!credential?.access_token) return failure('not_connected');
    const cached = cache.get(email);
    if (
      !force &&
      cached?.token === credential.access_token &&
      cached.expires > Date.now()
    )
      return cached.result;
    const active = pending.get(email);
    if (active?.token === credential.access_token) return active.request;
    if (force) cache.delete(email);
    const token = credential.access_token;
    const request = (async (): Promise<CodexModelsResult> => {
      if (isExpired(credential!.expires_at)) {
        credential = await refreshCodexCredential(email, credential!);
      }
      if (!credential?.access_token) return failure('token_expired');
      const send = () =>
        fetcher(CATALOG_URL, {
          headers: {
            Authorization: `Bearer ${credential!.access_token}`,
            Accept: 'application/json',
            originator: 'codex_cli_rs',
            'User-Agent': `AgentDeck/${version}`,
            ...(credential!.external_account_id
              ? { 'ChatGPT-Account-ID': credential!.external_account_id }
              : {}),
          },
          redirect: 'error',
          signal: AbortSignal.timeout(20_000),
        });
      let response = await send();
      if (response.status === 401) {
        credential = await refreshCodexCredential(email, credential);
        if (!credential?.access_token) return failure('token_expired');
        response = await send();
      }
      if (!response.ok) return failure('models_unavailable');
      const body: unknown = await response.json();
      if (
        !body ||
        typeof body !== 'object' ||
        !('models' in body) ||
        !Array.isArray(body.models)
      )
        return failure('invalid_catalog');
      const models: CodexModelsResult['models'] = [];
      const ids = new Set<string>();
      for (const item of body.models) {
        if (
          !item ||
          typeof item !== 'object' ||
          item.visibility !== 'list' ||
          typeof item.slug !== 'string' ||
          !item.slug.trim() ||
          ids.has(item.slug)
        )
          continue;
        ids.add(item.slug);
        models.push({
          id: item.slug,
          name:
            typeof item.display_name === 'string' && item.display_name.trim()
              ? item.display_name
              : item.slug,
        });
      }
      if (loadCodexCredential(email)?.access_token !== credential.access_token)
        return failure('account_changed');
      const result: CodexModelsResult = { success: true, models };
      cache.set(email, {
        token: credential.access_token,
        expires: Date.now() + CACHE_MS,
        result,
      });
      return result;
    })().catch(() => failure('models_unavailable'));
    pending.set(email, { token, request });
    try {
      return await request;
    } finally {
      if (pending.get(email)?.request === request) pending.delete(email);
    }
  } catch {
    return failure('credential_unavailable');
  }
}
