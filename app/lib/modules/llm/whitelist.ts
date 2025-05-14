import type { ModelInfo } from './types';

/**
 * 화이트리스트 항목 인터페이스
 * label: 사용자에게 표시될 이름
 * providerName: 실제 프로바이더 이름
 * modelName: 실제 모델 이름
 */
export interface WhitelistItem {
  label: string;
  providerName: string;
  modelName: string;
}

/**
 * 화이트리스트 목록
 * 사용자에게 제공할 프로바이더와 모델 조합을 정의합니다.
 */
export const MODEL_WHITELIST: WhitelistItem[] = [
  {
    label: 'Claude 3.7 Sonnet (OpenRouter)',
    providerName: 'OpenRouter',
    modelName: 'anthropic/claude-3.7-sonnet',
  },
  {
    label: 'Claude 3.7 Sonnet (Anthropic)',
    providerName: 'Anthropic',
    modelName: 'claude-3-7-sonnet-20250219',
  },
  {
    label: 'GPT-4.1',
    providerName: 'OpenRouter',
    modelName: 'openai/gpt-4.1',
  },
  {
    label: 'GPT-o4-mini',
    providerName: 'OpenRouter',
    modelName: 'openai/o4-mini',
  },
  {
    label: 'Gemini 2.5 Pro Preview',
    providerName: 'OpenRouter',
    modelName: 'google/gemini-2.5-pro-preview',
  },
  {
    label: 'Gemini 2.5 Pro (Google)',
    providerName: 'Google',
    modelName: 'gemini-2.5-pro-preview-05-06',
  },
  {
    label: 'Gemini 2.0 Flash',
    providerName: 'OpenRouter',
    modelName: 'google/gemini-2.0-flash-001',
  },
  {
    label: 'Gemini 2.5 Flash',
    providerName: 'OpenRouter',
    modelName: 'google/gemini-2.5-flash-preview',
  },
  {
    label: 'Grok3 Beta',
    providerName: 'OpenRouter',
    modelName: 'x-ai/grok-3-beta',
  },
];

/**
 * 화이트리스트에 프로바이더가 포함되어 있는지 확인합니다.
 */
export function isProviderWhitelisted(providerName: string): boolean {
  return MODEL_WHITELIST.some((item) => item.providerName === providerName);
}

/**
 * 화이트리스트에 모델이 포함되어 있는지 확인합니다.
 */
export function isModelWhitelisted(providerName: string, modelName: string): boolean {
  return MODEL_WHITELIST.some((item) => item.providerName === providerName && item.modelName === modelName);
}

/**
 * 화이트리스트에서 모델 정보를 찾습니다.
 */
export function findWhitelistItem(providerName: string, modelName: string): WhitelistItem | undefined {
  return MODEL_WHITELIST.find((item) => item.providerName === providerName && item.modelName === modelName);
}

/**
 * 모델 정보에서 화이트리스트 항목만 필터링합니다.
 */
export function filterWhitelistedModels(models: ModelInfo[]): ModelInfo[] {
  return models.filter((model) =>
    MODEL_WHITELIST.some((item) => item.providerName === model.provider && item.modelName === model.name),
  );
}
