import { PROVIDER_NAMES } from './provider-names';
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
  userSelectable?: boolean;
}

/**
 * 화이트리스트 목록
 * 사용자에게 제공할 프로바이더와 모델 조합을 정의합니다.
 */
export const MODEL_WHITELIST: WhitelistItem[] = [
  {
    label: 'Claude 4 Sonnet',
    providerName: PROVIDER_NAMES.ANTHROPIC,
    modelName: 'claude-sonnet-4-20250514',
  },
  {
    label: 'Claude 4.5 Sonnet',
    providerName: PROVIDER_NAMES.OPEN_ROUTER,
    modelName: 'anthropic/claude-sonnet-4.5',
    userSelectable: true,
  },
  {
    label: 'Claude 3.7 Sonnet',
    providerName: PROVIDER_NAMES.ANTHROPIC,
    modelName: 'claude-3-7-sonnet-20250219',
  },
  {
    label: 'GPT-5',
    providerName: PROVIDER_NAMES.OPEN_ROUTER,
    modelName: 'openai/gpt-5',
    userSelectable: true,
  },
  {
    label: 'GPT-o4-mini',
    providerName: PROVIDER_NAMES.OPEN_ROUTER,
    modelName: 'openai/o4-mini',
  },
  {
    label: 'Gemini 2.5 Pro',
    providerName: PROVIDER_NAMES.OPEN_ROUTER,
    modelName: 'google/gemini-2.5-pro',
  },
  {
    label: 'Gemini 2.5 Flash',
    providerName: PROVIDER_NAMES.OPEN_ROUTER,
    modelName: 'google/gemini-2.5-flash',
  },
  {
    label: 'Gemini 2.5 Pro',
    providerName: PROVIDER_NAMES.GOOGLE_VERTEX_AI,
    modelName: 'gemini-2.5-pro',
    userSelectable: true,
  },
  {
    label: 'Gemini 2.5 Pro',
    providerName: PROVIDER_NAMES.GOOGLE,
    modelName: 'gemini-2.5-pro',
  },
  {
    label: 'Grok4',
    providerName: PROVIDER_NAMES.X_AI,
    modelName: 'grok-4-0709',
  },
  {
    label: 'Grok4',
    providerName: PROVIDER_NAMES.OPEN_ROUTER,
    modelName: 'x-ai/grok-4',
    userSelectable: true,
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
