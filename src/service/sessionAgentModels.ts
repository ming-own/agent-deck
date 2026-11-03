import type { ConfiguredModelChoice } from '@/lib/configuredModels';
import { buildAgentModelConfigFromProvider } from '@/lib/modelConfig';

export interface AgentModelReference {
  id: string;
  name: string;
  model_platform: string;
  model_type: string;
}

export function modelReference(
  choice: ConfiguredModelChoice
): AgentModelReference {
  if ('codexModelType' in choice)
    return {
      id: choice.id,
      name: choice.name,
      model_platform: 'openai',
      model_type: choice.codexModelType,
    };
  if ('record' in choice) {
    const config = buildAgentModelConfigFromProvider(choice.record);
    return {
      id: choice.id,
      name: choice.name,
      model_platform: config.model_platform!,
      model_type: config.model_type!,
    };
  }
  throw new Error('Only connected models can be assigned to an Agent.');
}

export function resolveAgentConnection(
  reference: AgentModelReference,
  choices: ConfiguredModelChoice[]
) {
  const choice = choices.find((item) => item.id === reference.id);
  if (!choice) throw new Error('Agent model is unavailable.');
  const current = modelReference(choice);
  if (
    current.model_platform !== reference.model_platform ||
    current.model_type !== reference.model_type
  )
    throw new Error(
      'Agent model configuration changed. Select the model again.'
    );
  if ('codexModelType' in choice)
    return {
      model_platform: 'openai',
      model_type: choice.codexModelType,
      api_key: '',
      auth_source: 'codex_subscription' as const,
      api_url: null,
      model_config_dict: {},
      extra_params: {},
    };
  if ('record' in choice) {
    const config = buildAgentModelConfigFromProvider(choice.record);
    return { ...config, api_key: config.api_key ?? '', auth_source: null };
  }
  throw new Error('Agent model is unavailable.');
}
