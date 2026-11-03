import type { ConfiguredModelChoice } from '@/lib/configuredModels';
import { describe, expect, it } from 'vitest';
import { modelReference, resolveAgentConnection } from './sessionAgentModels';

const provider: ConfiguredModelChoice = {
  id: 'provider:4',
  group: 'openai',
  name: 'model-a',
  record: {
    id: 4,
    provider_name: 'openai',
    model_type: 'model-a',
    api_key: 'secret-key',
    endpoint_url: 'https://example.com/v1',
    is_valid: true,
  },
};
const codex: ConfiguredModelChoice = {
  id: 'codex:model-b',
  group: 'codex-subscription',
  name: 'Model B',
  codexModelType: 'model-b',
};

describe('Session Agent model binding', () => {
  it('persists an explicit reference without credentials', () => {
    const reference = modelReference(provider);
    expect(reference.model_type).toBe('model-a');
    expect(JSON.stringify(reference)).not.toContain('secret-key');
    expect(resolveAgentConnection(reference, [provider, codex]).api_key).toBe(
      'secret-key'
    );
  });
  it('resolves the exact Codex model without a global preference', () => {
    expect(
      resolveAgentConnection(modelReference(codex), [codex])
    ).toMatchObject({
      model_type: 'model-b',
      model_platform: 'openai',
      auth_source: 'codex_subscription',
      api_key: '',
    });
  });
  it('rejects missing or replaced providers instead of falling back', () => {
    const reference = modelReference(provider);
    expect(() => resolveAgentConnection(reference, [codex])).toThrow();
    const changed = {
      ...provider,
      record: { ...provider.record, model_type: 'changed' },
    };
    expect(() => resolveAgentConnection(reference, [changed])).toThrow();
  });
});
